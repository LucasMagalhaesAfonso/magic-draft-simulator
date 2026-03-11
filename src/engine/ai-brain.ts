// ai-brain.ts — Neural network AI that learns from playing against the human
// Architecture (v7): AlphaZero-style combined functional model with shared body + residual blocks.
//
// Improvements over v6:
//   1. Shared body: policy + value heads share a common board-processing trunk
//   2. Residual block: skip connection in shared body for better gradient flow
//   3. Joint training: gradients from both losses improve shared representations simultaneously
//   4. valueSubModel: shares weights with combined model for efficient board-only inference

import * as tf from '@tensorflow/tfjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compile a multi-output model with lossWeights.
 * The bundled @tensorflow/tfjs typings (4.x) omit `lossWeights` from
 * ModelCompileArgs, so we widen via `as any` in one centralised place.
 */
function compileMultiHead(model: tf.LayersModel): void {
  (model as any).compile({
    optimizer: tf.train.adam(LEARNING_RATE),
    loss: ['binaryCrossentropy', 'meanSquaredError'],
    lossWeights: [1.0, 0.5],
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_KEY           = 'indexeddb://magic-draft-ai-brain-v6'; // v6: value network TD
const FROZEN_KEY          = 'indexeddb://magic-draft-ai-frozen-v6';
const FROZEN_KEY_PHASE    = (p: number) => `indexeddb://magic-draft-ai-frozen-v6-p${p}`;
const BEST_MODEL_KEY      = 'indexeddb://magic-draft-ai-best-v6';  // checkpoint do melhor modelo
const VALUE_MODEL_KEY     = 'indexeddb://magic-draft-ai-value-v6'; // kept for cleanup only
const STATS_KEY           = 'magic_draft_ai_stats_v6';
const REPLAY_KEY          = 'magic_draft_ai_replay_v4';
// Tamanho do vetor de board features (sem as action features)
const BOARD_FEAT_SIZE     = 35;
const ACTION_FEAT_SIZE    = 10;
// Boltzmann temperature exploration (replaces epsilon-greedy)
const TEMP_INITIAL        = 1.5;      // slightly lower start — less random early
const TEMP_MIN            = 0.6;      // never too deterministic — keeps exploring
const TEMP_DECAY          = 0.002;    // slower decay — reaches TEMP_MIN in ~450 games
const LEARNING_RATE       = 0.0006;  // reduzido 0.001→0.0006: atualizações mais lentas, menos esquecimento catastrófico
const DISCOUNT            = 0.97;
const REPLAY_MAX          = 2000;     // aumentado 1000→2000: buffer maior dilui padrões ruins recentes
const REPLAY_SAMPLE       = 64;       // larger batch from replay
const REPLAY_ALPHA        = 0.6;      // priority exponent for prioritized replay
const REPLAY_EPS_P        = 0.01;     // small constant to avoid zero priority
const BASELINE_WINDOW     = 20;
const PHASE_WIN_THRESHOLD = 0.63;
const PHASE_SAMPLE        = 100;
// Checkpoint: salva modelo quando bate recorde, restaura se cair demais
const CHECKPOINT_SAMPLE   = 50;   // janela de 50 jogos para detectar colapso (mais reativo que 100)
const CHECKPOINT_MIN_GAMES = 120; // só começa a fazer checkpoint após 120 jogos (imitação sólida)
const CHECKPOINT_SAVE_MARGIN = 0.0;   // salva checkpoint em qualquer melhora no recorde
const CHECKPOINT_RESTORE_DROP = 0.10; // restaura se cair 10% abaixo do recorde (mais reativo)
// Melhoria 1 — Confidence threshold: só sobrescreve heurística quando confiante
// 0.15: após treino por imitação, scores ficam comprimidos em [0.4-0.7]. 0.08 era agressivo demais.
const CONFIDENCE_THRESHOLD = 0.05;   // reduzido 0.15→0.05: NN testa suas escolhas com mais frequência
// Melhoria 2 — Imitation learning blend: começa alto (aprende professor), decai com experiência
const IMITATION_BLEND_START = 0.65;  // levemente maior: ancora mais forte no início
const IMITATION_BLEND_MIN   = 0.35;  // aumentado 0.20→0.35: mantém âncora na heurística por mais tempo
const IMITATION_BLEND_DECAY = 0.0002;// reduzido 0.0005→0.0002: atinge mínimo em ~1500 jogos (não em 800)
// Warmup: primeiros N jogos a NN só observa, sem sobrescrever a heurística
// 80 jogos: garante base sólida de imitação antes de começar a sobrescrever
const WARMUP_GAMES         = 80;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionType = 'play' | 'attack' | 'block' | 'target' | 'instant';

export interface AiBrainStats {
  gamesPlayed: number;
  wins: number;
  temperature: number;               // Boltzmann exploration temperature (replaces epsilon)
  lastTrained: string | null;
  recentRewards: number[];
  cloudGamesCount: number;
  // Phase progression
  phase: number;
  phaseGames: number;
  phaseRecentWins: boolean[];
  // Checkpoint
  bestWinRate: number;               // melhor win rate (últimos 50 jogos) já atingida
  checkpointRestorations: number;    // quantas vezes restaurou do checkpoint
}

interface DecisionRecord {
  boardFeatures: number[];
  actionFeatures: number[];
  boardEval: number;           // board score at decision time (for intermediate rewards)
  wasHeuristicChoice: boolean; // true = NN concordou com heurística; false = desviou
}

interface ReplayEntry {
  board:        number[];
  action:       number[];
  policyTarget: number;
  valueTarget:  number;
  priority: number;  // |policyTarget - 0.5| + REPLAY_EPS_P — for prioritized sampling
}

// ─── AiBrain class ────────────────────────────────────────────────────────────

class AiBrain {
  private model: tf.LayersModel | null = null;          // combined functional model
  private frozenModel: tf.LayersModel | null = null;    // frozen copy (same architecture)
  private valueSubModel: tf.LayersModel | null = null;  // board-only inference (shared weights)
  private bestModel: tf.LayersModel | null = null;      // checkpoint do melhor modelo
  private decisions: DecisionRecord[] = [];
  private stats: AiBrainStats;
  private _initialized = false;
  private _initializing = false;
  private _checkpointPending = false;   // evita saves simultâneos
  private _lastRestorationGame = -999; // cooldown: não restaura mais de 1x a cada 60 jogos

  constructor() {
    this.stats = this._loadStats();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private _loadStats(): AiBrainStats {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (!s.recentRewards) s.recentRewards = [];
        if (s.phase === undefined) s.phase = 0;
        if (!s.phaseGames) s.phaseGames = 0;
        if (!s.phaseRecentWins) s.phaseRecentWins = [];
        // Migrate epsilon → temperature
        if (s.temperature === undefined) s.temperature = TEMP_INITIAL;
        // Migrate checkpoint fields
        if (s.bestWinRate === undefined) s.bestWinRate = 0;
        if (s.checkpointRestorations === undefined) s.checkpointRestorations = 0;
        return s;
      }
    } catch {}
    return { gamesPlayed: 0, wins: 0, temperature: TEMP_INITIAL, lastTrained: null, recentRewards: [], cloudGamesCount: 0, phase: 0, phaseGames: 0, phaseRecentWins: [], bestWinRate: 0, checkpointRestorations: 0 };
  }

  private _saveStats(): void {
    try {
      // Keep recentRewards bounded
      if (this.stats.recentRewards.length > BASELINE_WINDOW) {
        this.stats.recentRewards = this.stats.recentRewards.slice(-BASELINE_WINDOW);
      }
      localStorage.setItem(STATS_KEY, JSON.stringify(this.stats));
    } catch {}
  }

  // ── Replay buffer ──────────────────────────────────────────────────────────

  private _loadReplayBuffer(): ReplayEntry[] {
    try {
      const raw = localStorage.getItem(REPLAY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Migrate old format (entries with `input`/`target`) to new format
        return (parsed as any[]).map((e: any): ReplayEntry => {
          if (e.board !== undefined) return e as ReplayEntry;
          // Old format: { input: number[], target: number, priority: number }
          const board   = (e.input as number[]).slice(0, BOARD_FEAT_SIZE);
          const action  = (e.input as number[]).slice(BOARD_FEAT_SIZE);
          return {
            board,
            action,
            policyTarget: e.target,
            valueTarget:  e.target,  // best guess for old entries
            priority: e.priority,
          };
        });
      }
    } catch {}
    return [];
  }

  private _saveReplayBuffer(buffer: ReplayEntry[], newEntries: ReplayEntry[]): void {
    try {
      const combined = [...buffer, ...newEntries];
      const trimmed = combined.slice(-REPLAY_MAX);
      localStorage.setItem(REPLAY_KEY, JSON.stringify(trimmed));
    } catch {}
  }

  private _sampleReplay(buffer: ReplayEntry[], count: number): ReplayEntry[] {
    if (buffer.length <= count) return [...buffer];

    // Prioritized sampling: P(i) ∝ priority^REPLAY_ALPHA
    const prios = buffer.map(e => Math.pow((e.priority || REPLAY_EPS_P), REPLAY_ALPHA));
    const total = prios.reduce((s, p) => s + p, 0);
    const probs = prios.map(p => p / total);

    const result: ReplayEntry[] = [];
    const used = new Set<number>();
    let attempts = 0;
    while (result.length < count && attempts < count * 15) {
      attempts++;
      let r = Math.random();
      for (let i = 0; i < probs.length; i++) {
        r -= probs[i];
        if (r <= 0 && !used.has(i)) { used.add(i); result.push(buffer[i]); break; }
      }
    }
    // Fill any gaps with uniform random
    while (result.length < count) {
      const idx = Math.floor(Math.random() * buffer.length);
      if (!used.has(idx)) { used.add(idx); result.push(buffer[idx]); }
    }
    return result;
  }

  // ── Model construction ─────────────────────────────────────────────────────

  /**
   * Build the combined AlphaZero-style functional model.
   *
   * Architecture:
   *   boardInput(35) → Dense(128,relu) → Dropout(0.25)
   *                         │
   *                   [Residual block]
   *                   Dense(64,relu) → Dense(64) → Add(+skip Dense(64)) → relu
   *                         │
   *              ┌──────────┴──────────────┐
   *              │ VALUE HEAD              │ POLICY HEAD
   *              Dense(32,relu)     Concat([sharedBody, actionInput(10)])
   *              Dense(1,sigmoid)   Dense(32,relu) → Dense(1,sigmoid)
   *
   * Returns both the combined model (policy + value outputs) and a
   * valueSubModel that shares the same weights but only needs boardInput.
   */
  private _buildCombinedModel(): { combined: tf.LayersModel; valueSubModel: tf.LayersModel } {
    const boardInput  = tf.input({ shape: [BOARD_FEAT_SIZE], name: 'board' });
    const actionInput = tf.input({ shape: [ACTION_FEAT_SIZE], name: 'action' });

    // ── Shared body ──────────────────────────────────────────────────────────
    let x = tf.layers.dense({ units: 128, activation: 'relu', name: 'shared1' })
      .apply(boardInput) as tf.SymbolicTensor;
    x = tf.layers.dropout({ rate: 0.25, name: 'shared_drop' })
      .apply(x) as tf.SymbolicTensor;

    // ── Residual block ───────────────────────────────────────────────────────
    const r1   = tf.layers.dense({ units: 64, activation: 'relu', name: 'res_h1' })
      .apply(x) as tf.SymbolicTensor;
    const r2   = tf.layers.dense({ units: 64, name: 'res_h2' })
      .apply(r1) as tf.SymbolicTensor;
    const skip = tf.layers.dense({ units: 64, name: 'res_skip' })
      .apply(x) as tf.SymbolicTensor;
    const sharedBody = tf.layers.activation({ activation: 'relu', name: 'res_out' })
      .apply(
        tf.layers.add({ name: 'res_add' }).apply([r2, skip])
      ) as tf.SymbolicTensor;

    // ── Value head ───────────────────────────────────────────────────────────
    const v1 = tf.layers.dense({ units: 32, activation: 'relu', name: 'val_dense' })
      .apply(sharedBody) as tf.SymbolicTensor;
    const valueOutput = tf.layers.dense({ units: 1, activation: 'sigmoid', name: 'val_out' })
      .apply(v1) as tf.SymbolicTensor;

    // ── Policy head ──────────────────────────────────────────────────────────
    const concat = tf.layers.concatenate({ name: 'pol_concat' })
      .apply([sharedBody, actionInput]) as tf.SymbolicTensor;
    const p1 = tf.layers.dense({ units: 32, activation: 'relu', name: 'pol_dense' })
      .apply(concat) as tf.SymbolicTensor;
    const policyOutput = tf.layers.dense({ units: 1, activation: 'sigmoid', name: 'pol_out' })
      .apply(p1) as tf.SymbolicTensor;

    // ── Combined model: inputs=[board,action], outputs=[policy,value] ────────
    const combined = tf.model({
      inputs: [boardInput, actionInput],
      outputs: [policyOutput, valueOutput],
    });
    compileMultiHead(combined);

    // ── valueSubModel: board → value (shared weights, inference-only) ────────
    // We reconstruct a model from the same nodes — no duplicate weights.
    const valueSubModel = tf.model({ inputs: boardInput, outputs: valueOutput });
    // No separate compile needed; weights are shared with `combined`.

    return { combined, valueSubModel };
  }

  /** Estima P(vitória) para um conjunto de estados de tabuleiro (sync via dataSync). */
  private _estimateValuesBatch(boardStates: number[][]): number[] {
    if (!this.valueSubModel || boardStates.length === 0) return boardStates.map(() => 0.5);
    try {
      return tf.tidy(() => {
        const inp  = tf.tensor2d(boardStates.map(s => s.slice(0, BOARD_FEAT_SIZE)));
        const pred = this.valueSubModel!.predict(inp) as tf.Tensor;
        return Array.from(pred.dataSync());
      });
    } catch { return boardStates.map(() => 0.5); }
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._initialized || this._initializing) return;
    this._initializing = true;
    try {
      // Disable WebGL timer queries — causa GL_INVALID_OPERATION: glGetQueryObjectuivEXT
      // durante self-play intenso (TF.js tenta medir tempo de ops na GPU mas perde referências)
      try { tf.env().set('WEBGL_DISJOINT_QUERY_TIMER_EXTENSION_RELIABLE', false); } catch {}
      try { tf.env().set('WEBGL_DISJOINT_QUERY_TIMER_EXTENSION_VERSION', 0); } catch {}
      // Try to load combined model from IndexedDB
      try {
        this.model = await tf.loadLayersModel(MODEL_KEY);
        compileMultiHead(this.model);
        // Reconstruct valueSubModel from loaded model's nodes (shared weights)
        const boardIn = this.model.inputs.find(i => i.name.startsWith('board')) ?? this.model.inputs[0];
        const valOut  = this.model.outputs[1]; // [policyOutput, valueOutput]
        this.valueSubModel = tf.model({ inputs: boardIn, outputs: valOut });
        console.log('[AiBrain] Loaded combined model from IndexedDB');
      } catch {
        // No local model — try bundled prebuilt first, then build fresh
        const loaded = await this._tryLoadPrebuilt();
        if (!loaded) {
          const { combined, valueSubModel } = this._buildCombinedModel();
          this.model = combined;
          this.valueSubModel = valueSubModel;
          console.log('[AiBrain] Created fresh combined model');
        }
      }

      // Warmup: pre-compile WebGL shaders to avoid first-call freeze
      if (this.model) {
        try {
          tf.tidy(() => {
            const dBoard  = tf.zeros([1, BOARD_FEAT_SIZE]);
            const dAction = tf.zeros([1, ACTION_FEAT_SIZE]);
            (this.model!.predict([dBoard, dAction]) as tf.Tensor[]).forEach(t => t.dataSync());
          });
          console.log('[AiBrain] Warmup pass complete — shaders compiled');
        } catch { /* non-fatal */ }
      }

      // Load frozen opponent model (phase 1+ self-play), non-fatal
      try {
        this.frozenModel = await tf.loadLayersModel(FROZEN_KEY);
        compileMultiHead(this.frozenModel);
        console.log('[AiBrain] Frozen model loaded for phase', this.stats.phase);
      } catch { /* No frozen model yet — phase 0 */ }

      // Load best checkpoint model, non-fatal
      try {
        this.bestModel = await tf.loadLayersModel(BEST_MODEL_KEY);
        compileMultiHead(this.bestModel);
        console.log(`[AiBrain] Best checkpoint loaded (best win rate: ${((this.stats.bestWinRate || 0) * 100).toFixed(0)}%)`);
      } catch { /* No checkpoint yet */ }

      // Warmup valueSubModel
      if (this.valueSubModel) {
        try {
          tf.tidy(() => {
            const dummy = tf.zeros([1, BOARD_FEAT_SIZE]);
            (this.valueSubModel!.predict(dummy) as tf.Tensor).dataSync();
          });
        } catch { /* non-fatal */ }
      }

      // Sync from cloud (non-blocking, non-fatal)
      this.syncFromCloud().catch(() => {});

      this._initialized = true;
    } catch (e) {
      console.warn('[AiBrain] Failed to initialize:', e);
      this.model = null;
    }
    this._initializing = false;
  }

  /**
   * Try loading the bundled prebuilt model from /data/ai-brain-prebuilt.json.
   * Returns false early if the format has changed (architecture mismatch).
   */
  private async _tryLoadPrebuilt(): Promise<boolean> {
    // Prebuilt format changed with combined model — skip to avoid shape mismatches
    return false;
  }

  isReady(): boolean {
    return this._initialized && this.model !== null;
  }

  getStats(): AiBrainStats {
    return { ...this.stats, recentRewards: [...this.stats.recentRewards] };
  }

  // ── Feature extraction ────────────────────────────────────────────────────

  /** Extract 35 board features normalized to ~[0,1] */
  extractBoardFeatures(state: any, playerId: number): number[] {
    const oppId = playerId === 0 ? 1 : 0;
    const me = state.players[playerId];
    const opp = state.players[oppId];

    const myBfCards: any[] = me.zones.battlefield?.cards || [];
    const oppBfCards: any[] = opp.zones.battlefield?.cards || [];

    const myCreatures  = myBfCards.filter((c: any) => (c.type_line || '').toLowerCase().includes('creature'));
    const oppCreatures = oppBfCards.filter((c: any) => (c.type_line || '').toLowerCase().includes('creature'));
    const myLands      = myBfCards.filter((c: any) => (c.type_line || '').toLowerCase().includes('land'));
    const oppLands     = oppBfCards.filter((c: any) => (c.type_line || '').toLowerCase().includes('land'));

    function getPow(c: any): number  { return (parseInt(c.power) || 0) + (c._powerMod || 0); }
    function getTough(c: any): number { return (parseInt(c.toughness) || 0) + (c._toughnessMod || 0); }
    function hasKw(c: any, kw: string): boolean {
      const kwL = kw.toLowerCase();
      return !!(
        (c._tempKeywords || []).some((k: any) => typeof k === 'string' && k.toLowerCase() === kwL) ||
        (c.keywords || []).some((k: any) => typeof k === 'string' && k.toLowerCase() === kwL) ||
        (c.oracle_text || '').toLowerCase().includes(kwL)
      );
    }

    const myPower  = myCreatures.reduce((s: number, c: any) => s + getPow(c), 0);
    const oppPower = oppCreatures.reduce((s: number, c: any) => s + getPow(c), 0);
    const myTough  = myCreatures.reduce((s: number, c: any) => s + getTough(c), 0);
    const oppTough = oppCreatures.reduce((s: number, c: any) => s + getTough(c), 0);

    const myLife  = me.life;
    const oppLife = opp.life;
    const turn    = Math.min(state.turn || 1, 20);

    let myHandCards: any[] = [];
    try { myHandCards = me.zones.hand?.getAll?.() || []; } catch {}
    const myHand = myHandCards.length;
    let oppHand = 0;
    try { oppHand = opp.zones.hand?.count?.() || opp.zones.hand?.cards?.length || 0; } catch {}

    let myGy = 0;
    try { myGy = me.zones.graveyard?.count?.() || me.zones.graveyard?.cards?.length || 0; } catch {}
    let oppGy = 0;
    try { oppGy = opp.zones.graveyard?.count?.() || opp.zones.graveyard?.cards?.length || 0; } catch {}

    const myMana    = myLands.filter((c: any) => !c._tapped).length;
    const avgHandCmc = myHandCards.length > 0
      ? myHandCards.reduce((s: number, c: any) => s + (c.cmc || 0), 0) / myHandCards.length
      : 0;
    const manaToCostRatio = avgHandCmc > 0 ? Math.min(myMana / avgHandCmc, 2) / 2 : 0.5;

    const totalPower = myPower + oppPower;
    const boardAdv   = totalPower > 0 ? (myPower - oppPower) / (totalPower + 1) : 0;

    // Clamp all values to [0, 1] to prevent outlier inputs
    const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

    return [
      clamp(myLife / 20),                // 0
      clamp(oppLife / 20),               // 1
      clamp(myCreatures.length / 10),    // 2
      clamp(oppCreatures.length / 10),   // 3
      clamp(myPower / 20),               // 4
      clamp(oppPower / 20),              // 5
      clamp(myTough / 20),               // 6
      clamp(oppTough / 20),              // 7
      clamp(myCreatures.filter((c: any) => hasKw(c, 'flying')).length / 5),      // 8
      clamp(oppCreatures.filter((c: any) => hasKw(c, 'flying')).length / 5),     // 9
      clamp(myCreatures.filter((c: any) => hasKw(c, 'deathtouch')).length / 5),  // 10
      clamp(oppCreatures.filter((c: any) => hasKw(c, 'deathtouch')).length / 5), // 11
      clamp(myCreatures.filter((c: any) => hasKw(c, 'lifelink')).length / 5),    // 12
      clamp(oppCreatures.filter((c: any) => hasKw(c, 'lifelink')).length / 5),   // 13
      clamp(myHand / 7),                 // 14
      clamp(oppHand / 7),                // 15
      clamp(myLands.length / 10),        // 16
      clamp(oppLands.length / 10),       // 17
      clamp(turn / 20),                  // 18
      clamp(boardAdv, -1, 1),            // 19 — allowed negative
      clamp(myGy / 10),                  // 20
      clamp(oppGy / 10),                 // 21
      clamp(manaToCostRatio),            // 22
      myLife <= 8 ? 1 : 0,               // 23
      oppLife <= 8 ? 1 : 0,              // 24
      myCreatures.length >= 4 ? 1 : 0,   // 25
      oppCreatures.length >= 4 ? 1 : 0,  // 26
      clamp(myMana / 10),                // 27
      clamp((myLife - oppLife) / 20, -1, 1), // 28
      clamp((myCreatures.length - oppCreatures.length) / 10, -1, 1), // 29

      // ── 5 new features (30-34) ────────────────────────────────────────
      // 30: removal spells in hand (destroy/exile/damage instant/sorcery)
      clamp(myHandCards.filter((c: any) => {
        const tl = (c.type_line || '').toLowerCase();
        if (!(tl.includes('instant') || tl.includes('sorcery'))) return false;
        const oracle = (c.oracle_text || '').toLowerCase();
        return oracle.includes('destroy') || oracle.includes('exile') || oracle.includes('damage');
      }).length / 3),                                                    // 30

      // 31: opponent average creature CMC (higher = slower deck)
      clamp(oppCreatures.length > 0
        ? oppCreatures.reduce((s: number, c: any) => s + (c.cmc || 0), 0) / oppCreatures.length / 6
        : 0),                                                            // 31

      // 32: my creatures with +1/+1 counters (board quality signal)
      clamp(myCreatures.filter((c: any) => (c._counters || 0) > 0).length / 5), // 32

      // 33: lethal threat — opponent can kill me in ≤2 turns even if I block everything
      (() => {
        const oppAtks = oppBfCards.filter((c: any) =>
          (c.type_line || '').toLowerCase().includes('creature') && !c._tapped
        );
        const oppTotalPower = oppAtks.reduce((s: number, c: any) =>
          s + Math.max(0, (parseInt(c.power) || 0) + (c._powerMod || 0)), 0
        );
        return oppTotalPower * 2 >= myLife ? 1 : 0;
      })(),                                                              // 33

      // 34: game phase — 0=early (t1-4), 0.5=mid (t5-8), 1.0=late (t9+)
      (() => {
        const t = state.turn || 1;
        return t <= 4 ? 0 : t <= 8 ? 0.5 : 1.0;
      })(),                                                              // 34
    ];
  }

  /** Extract 10 action features for a given card */
  extractActionFeatures(card: any, actionType: ActionType): number[] {
    const cmc    = Math.min(card?.cmc || 0, 8) / 8;
    const tl     = (card?.type_line || '').toLowerCase();
    const oracle = (card?.oracle_text || '').toLowerCase();

    const isCreature    = tl.includes('creature') ? 1 : 0;
    const isSorcery     = tl.includes('sorcery') ? 1 : 0;
    const isInstant     = tl.includes('instant') ? 1 : 0;
    const isLand        = tl.includes('land') ? 1 : 0;
    const isRemoval     = (oracle.includes('destroy') || oracle.includes('exile') || oracle.includes('damage')) ? 1 : 0;
    const isDraw        = oracle.includes('draw a card') ? 1 : 0;
    const isRamp        = (oracle.includes('search your library') && oracle.includes('land')) || oracle.includes('add {') ? 1 : 0;
    const createsToken  = oracle.includes('create') && oracle.includes('token') ? 1 : 0;

    const actionEnc: Record<ActionType, number> = {
      play: 0.0, attack: 0.25, block: 0.5, target: 0.75, instant: 1.0,
    };

    return [cmc, isCreature, isSorcery, isInstant, isLand, isRemoval, isDraw, isRamp, createsToken, actionEnc[actionType] ?? 0];
  }

  // ── Scoring ───────────────────────────────────────────────────────────────

  /**
   * Re-rank candidate cards using the neural network (synchronous via dataSync).
   * Returns candidate indices sorted best-first.
   * Boltzmann exploration: softmax over raw scores scaled by temperature.
   */
  scoreActionsSync(
    boardFeatures: number[],
    candidateCards: any[],
    actionType: ActionType,
  ): number[] {
    if (candidateCards.length <= 1) return candidateCards.map((_, i) => i);
    if (!this.model) return candidateCards.map((_, i) => i);

    try {
      const rawScores = tf.tidy(() => {
        const boardInputs  = candidateCards.map(() => boardFeatures.slice(0, BOARD_FEAT_SIZE));
        const actionInputs = candidateCards.map(card => this.extractActionFeatures(card, actionType));
        const bTensor = tf.tensor2d(boardInputs);
        const aTensor = tf.tensor2d(actionInputs);
        const [policyPred] = this.model!.predict([bTensor, aTensor]) as tf.Tensor[];
        return Array.from(policyPred.dataSync());
      });

      // ── Warmup: primeiros WARMUP_GAMES jogos só observa, sem sobrescrever ──
      if (this.stats.gamesPlayed < WARMUP_GAMES) {
        return candidateCards.map((_, i) => i);
      }

      // ── Confidence threshold ──────────────────────────────────────────────
      const sortedRaw = [...rawScores].sort((a, b) => b - a);
      const confidence = rawScores.length >= 2 ? sortedRaw[0] - sortedRaw[1] : 1;
      if (confidence < CONFIDENCE_THRESHOLD) {
        return candidateCards.map((_, i) => i);
      }

      // ── Boltzmann (softmax temperature) exploration ───────────────────────
      const T = Math.max(this.stats.temperature, 0.01);
      const scaled = rawScores.map(s => s / T);
      const maxS = Math.max(...scaled);
      const exps = scaled.map(s => Math.exp(s - maxS));
      const sumExp = exps.reduce((a, b) => a + b, 0);
      const probs = exps.map(p => p / sumExp);

      let r = Math.random();
      let sampledIdx = rawScores.length - 1;
      for (let i = 0; i < probs.length; i++) {
        r -= probs[i];
        if (r <= 0) { sampledIdx = i; break; }
      }

      const sortedIndices = rawScores
        .map((s, i) => ({ s, i }))
        .sort((a, b) => b.s - a.s)
        .map(x => x.i);

      return [sampledIdx, ...sortedIndices.filter(i => i !== sampledIdx)];
    } catch (e) {
      console.warn('[AiBrain] scoreActionsSync failed:', e);
      return candidateCards.map((_, i) => i);
    }
  }

  // ── Decision recording ────────────────────────────────────────────────────

  recordDecision(boardFeatures: number[], actionFeatures: number[], wasHeuristicChoice = true): void {
    if (this.decisions.length < 200) {
      const myKwQuality  = boardFeatures[8] * 1.5
                         + boardFeatures[10] * 2.0
                         + boardFeatures[12] * 1.0;
      const oppKwQuality = boardFeatures[9] * 1.5
                         + boardFeatures[11] * 2.0
                         + boardFeatures[13] * 1.0;

      const myResources  = boardFeatures[14] * 1.0 + boardFeatures[16] * 0.4;
      const oppResources = boardFeatures[15] * 1.0 + boardFeatures[17] * 0.4;

      const threatBonus   = boardFeatures[24] ? 1.0 : 0;
      const dangerPenalty = boardFeatures[23] ? -1.0 : 0;

      const boardEval =
        (boardFeatures[0] - boardFeatures[1]) * 3.5 +
        (boardFeatures[2] - boardFeatures[3]) * 1.2 +
        (boardFeatures[4] - boardFeatures[5]) * 1.8 +
        (boardFeatures[6] - boardFeatures[7]) * 0.6 +
        (myKwQuality - oppKwQuality) * 2.0 +
        (myResources - oppResources) * 1.2 +
        threatBonus + dangerPenalty;

      this.decisions.push({
        boardFeatures: [...boardFeatures],
        actionFeatures: [...actionFeatures],
        boardEval,
        wasHeuristicChoice,
      });
    }
  }

  // ── Mana variance detection ───────────────────────────────────────────────

  /**
   * Detects mana screw / flood from the recorded decision history.
   * Returns a weight in [0, 1]:
   *   1.0 = clean game (train normally)
   *   0.4 = mild screw/flood (train with reduced signal)
   *   0.0 = severe screw/flood (skip training — outcome is pure luck)
   */
  private _detectManaVarianceWeight(decisions: DecisionRecord[]): number {
    if (decisions.length < 4) return 1.0;

    const early = decisions.slice(0, Math.min(8, decisions.length));
    const mid   = decisions.slice(Math.floor(decisions.length / 3));

    // Screw: early turns with very few lands relative to turn number
    let screwHits = 0;
    for (const d of early) {
      const lands = d.boardFeatures[16] * 10;  // actual land count
      const turn  = d.boardFeatures[18] * 20;  // actual turn
      if (turn >= 4 && lands < 2) screwHits += 2;
      else if (turn >= 5 && lands < 3) screwHits++;
    }
    const severeScrew = screwHits >= 4;
    const mildScrew   = screwHits >= 2;

    // Flood: mid-game with high mana ratio but few creatures (can't cast spells)
    let floodHits = 0;
    for (const d of mid) {
      const manaRatio  = d.boardFeatures[22];        // 0=no mana, 1=flooded
      const creatures  = d.boardFeatures[2] * 10;   // creature count
      if (manaRatio > 0.88 && creatures < 2) floodHits++;
    }
    const floodThreshold = Math.max(2, Math.floor(mid.length * 0.45));
    const severeFlood = floodHits >= floodThreshold;
    const mildFlood   = floodHits >= Math.max(1, Math.floor(floodThreshold * 0.5));

    if (severeScrew || severeFlood) return 0.0;  // skip — pure luck game
    if (mildScrew   || mildFlood)   return 0.4;  // partial — discount signal
    return 1.0;
  }

  // ── Training ──────────────────────────────────────────────────────────────

  /**
   * Called at game end. Trains the combined model with:
   *   - Policy head: REINFORCE + imitation + TD dense rewards
   *   - Value head: TD(λ) targets (V(s_terminal) = outcome, V(s_t) = γ·V(s_{t+1}))
   *   - Experience replay: mix past decisions for both heads jointly
   */
  async trainOnGame(won: boolean): Promise<void> {
    // Soft reward: combina win/loss com vantagem de board final
    // Mais estável do que binário puro — reduz variância de deck luck
    const n0 = this.decisions.length;
    const lastBoardEval = n0 > 0 ? this.decisions[n0 - 1].boardEval : 0;
    const boardReward = Math.max(0.05, Math.min(0.95, 0.5 + lastBoardEval / 18));
    // Win ancora em [0.55, 0.90], Loss ancora em [0.10, 0.45]
    const softReward = won
      ? Math.max(0.55, Math.min(0.90, boardReward))
      : Math.min(0.45, Math.max(0.10, boardReward));

    // ── REINFORCE baseline ─────────────────────────────────────────────────
    const recent = this.stats.recentRewards;
    const baseline = recent.length >= 3
      ? recent.reduce((a, b) => a + b, 0) / recent.length
      : 0.5;
    const advantage = softReward - baseline;

    if (!this.model || this.decisions.length === 0) {
      this._updateStatsAfterGame(won, softReward);
      this.decisions = [];
      return;
    }

    // ── Mana variance filter ───────────────────────────────────────────────
    const manaWeight = this._detectManaVarianceWeight(this.decisions);
    if (manaWeight === 0.0) {
      // Severe screw/flood — outcome is pure luck, skip training to avoid corrupting model
      console.log(`[AiBrain] Skipping training — mana issue detected (screw/flood). Won=${won}`);
      this._updateStatsAfterGame(won, softReward);
      this.decisions = [];
      return;
    }

    const n = this.decisions.length;
    const boardStates  = this.decisions.map(d => d.boardFeatures.slice(0, BOARD_FEAT_SIZE));
    const actionStates = this.decisions.map(d => d.actionFeatures);

    // ── Step 1: Compute TD targets (backwards pass) ────────────────────────
    const tdTargets = new Array(n).fill(0);
    tdTargets[n - 1] = won ? 1.0 : 0.0;
    for (let t = n - 2; t >= 0; t--) {
      tdTargets[t] = DISCOUNT * tdTargets[t + 1];
    }

    // ── Step 2: Estimate board values for TD error dense rewards ──────────
    // After the fit call below the weights will have moved, so we grab
    // value estimates BEFORE training (prior model's view).
    const valueTrust = Math.min(this.stats.gamesPlayed / 40, 1.0);
    let valueEstimates: number[] = boardStates.map(() => 0.5);
    if (this.valueSubModel && valueTrust > 0.05) {
      valueEstimates = this._estimateValuesBatch(boardStates);
    }

    // ── Step 3: Policy targets ─────────────────────────────────────────────
    const currentTargets = this.decisions.map((d, i) => {
      const decay = Math.pow(DISCOUNT, n - 1 - i);
      // manaWeight < 1.0: jogo com mild screw/flood — reduz contribuição do win/loss
      const reinforceTarget = 0.5 + advantage * manaWeight * decay * 0.5;

      // Imitation blend dinâmico: começa em 0.60, decai para 0.20 ao longo de ~1000 jogos
      // Fase inicial: aprende o professor (heurística). Fase tardia: REINFORCE domina.
      const imitBlend = Math.max(
        IMITATION_BLEND_MIN,
        IMITATION_BLEND_START - this.stats.gamesPlayed * IMITATION_BLEND_DECAY
      );

      // Imitation target depende do resultado — não punir desvios que levaram a vitórias
      // Concordou + ganhou → muito bom (0.85) — heurística era correta
      // Concordou + perdeu → levemente positivo (0.55) — FIX: era 0.65 (recompensava perda),
      //                                                   era 0.50 (neutro demais → NN perde base).
      //                                                   0.55 = sinal fraco de "heurística ainda é ok"
      //                                                   sem inflar decisões perdedoras artificialmente.
      // Desviou  + ganhou → bom (0.75)        — descobriu algo melhor, recompensar
      // Desviou  + perdeu → levemente ruim (0.20) — FIX: era 0.10 (punição forte demais
      //                                              → NN colapsa em desvios → fica no heurístico)
      const imitationTarget = d.wasHeuristicChoice
        ? (won ? 0.85 : 0.55)
        : (won ? 0.75 : 0.20);
      let target = imitBlend * imitationTarget + (1 - imitBlend) * reinforceTarget;

      if (i < n - 1) {
        let tdDelta: number;
        if (valueTrust > 0.1) {
          const vDelta = valueEstimates[i + 1] - valueEstimates[i];
          tdDelta = valueTrust * Math.tanh(vDelta * 3) + (1 - valueTrust) * Math.tanh((this.decisions[i + 1].boardEval - d.boardEval) * 0.35);
        } else {
          tdDelta = Math.tanh((this.decisions[i + 1].boardEval - d.boardEval) * 0.35);
        }
        // Aumentado 0.22→0.42: sinal de melhora de board turno-a-turno é mais confiável que win/loss
        target += tdDelta * 0.42;
      }

      return Math.max(0.05, Math.min(0.95, target));
    });

    // ── Step 4: Experience replay ──────────────────────────────────────────
    const buffer  = this._loadReplayBuffer();
    const sampled = this._sampleReplay(buffer, REPLAY_SAMPLE);

    const allBoards  = [...boardStates,   ...sampled.map(e => e.board)];
    const allActions = [...actionStates,  ...sampled.map(e => e.action)];
    const allPolicy  = [...currentTargets, ...sampled.map(e => e.policyTarget)];
    const allValue   = [...tdTargets,      ...sampled.map(e => e.valueTarget)];

    // ── Step 5: Train combined model (both heads jointly) ─────────────────
    try {
      const bTensor = tf.tensor2d(allBoards);
      const aTensor = tf.tensor2d(allActions);
      const pTensor = tf.tensor2d(allPolicy.map(t => [t]));
      const vTensor = tf.tensor2d(allValue.map(t => [t]));

      await this.model.fit([bTensor, aTensor], [pTensor, vTensor], {
        epochs: 1,   // 1 epoch por jogo — menos risco de catastrophic forgetting
        batchSize: Math.min(32, allBoards.length),
        verbose: 0,
      });

      bTensor.dispose();
      aTensor.dispose();
      pTensor.dispose();
      vTensor.dispose();

      await this.model.save(MODEL_KEY);
      console.log(`[AiBrain] Trained on ${allBoards.length} samples (${boardStates.length} new + ${sampled.length} replay). Won=${won}, advantage=${advantage.toFixed(2)}`);
      if (this.valueSubModel) {
        const v0 = this._estimateValuesBatch([boardStates[0]])[0];
        const vT = this._estimateValuesBatch([boardStates[n - 1]])[0];
        console.log(`[ValueHead] V(s0)=${v0.toFixed(2)} V(sT)=${vT.toFixed(2)}`);
      }
    } catch (e) {
      console.warn('[AiBrain] Training failed:', e);
    }

    // ── Save new decisions to replay buffer ────────────────────────────────
    const newReplayEntries: ReplayEntry[] = boardStates.map((board, i) => ({
      board,
      action:       actionStates[i],
      policyTarget: currentTargets[i],
      valueTarget:  tdTargets[i],
      priority:     Math.abs(currentTargets[i] - 0.5) + REPLAY_EPS_P,
    }));
    this._saveReplayBuffer(buffer, newReplayEntries);

    this._updateStatsAfterGame(won, softReward);
    this.decisions = [];

    // Upload to cloud (non-blocking, non-fatal)
    this.syncToCloud().catch(() => {});
  }

  private _updateStatsAfterGame(won: boolean, softReward: number): void {
    this.stats.gamesPlayed++;
    if (won) this.stats.wins++;
    this.stats.temperature = Math.max(TEMP_MIN, this.stats.temperature - TEMP_DECAY);
    this.stats.lastTrained = new Date().toISOString();
    this.stats.recentRewards = [...(this.stats.recentRewards || []), softReward];
    // Phase tracking
    this.stats.phaseGames++;
    this.stats.phaseRecentWins = [...(this.stats.phaseRecentWins || []), won];
    if (this.stats.phaseRecentWins.length > PHASE_SAMPLE * 2) {
      this.stats.phaseRecentWins = this.stats.phaseRecentWins.slice(-PHASE_SAMPLE);
    }
    this._saveStats();
    // Auto-advance phase check (non-blocking)
    this._checkPhaseAdvance().catch(() => {});
    // Checkpoint: save best / restore on collapse (non-blocking)
    this._manageCheckpoint().catch(() => {});
  }

  /** Compute win rate over last N games from phaseRecentWins */
  private _recentWinRate(n: number): number {
    const h = this.stats.phaseRecentWins || [];
    if (h.length === 0) return 0;
    const slice = h.slice(-n);
    return slice.filter(w => w).length / slice.length;
  }

  /**
   * Checkpoint manager — called after each game.
   * Saves the model when a new win-rate record is set.
   * Restores from checkpoint when a catastrophic drop is detected.
   */
  private async _manageCheckpoint(): Promise<void> {
    if (!this.model) return;
    if (this.stats.gamesPlayed < CHECKPOINT_MIN_GAMES) return;
    if (this._checkpointPending) return;

    const winRate50 = this._recentWinRate(CHECKPOINT_SAMPLE);
    const best = this.stats.bestWinRate || 0;

    // ── Save checkpoint if new record ────────────────────────────────────────
    if (winRate50 > best + CHECKPOINT_SAVE_MARGIN && winRate50 > 0.44) {
      this._checkpointPending = true;
      try {
        const weights = this.model.getWeights();
        try {
          if (!this.bestModel) {
            const { combined } = this._buildCombinedModel();
            this.bestModel = combined;
          }
          this.bestModel.setWeights(weights.map(w => w.clone()));
          await this.bestModel.save(BEST_MODEL_KEY);
          this.stats.bestWinRate = winRate50;
          this._saveStats();
          console.log(`[AiBrain] ✅ Checkpoint saved! Win rate ${(winRate50 * 100).toFixed(0)}% (prev best: ${(best * 100).toFixed(0)}%)`);
        } finally {
          // Dispose getWeights() refs — cada chamada cria novas referências que acumulam na GPU
          weights.forEach(w => w.dispose());
        }
      } catch (e) {
        console.warn('[AiBrain] Checkpoint save failed:', e);
      } finally {
        this._checkpointPending = false;
      }
      return;
    }

    // ── Restore checkpoint on catastrophic drop ───────────────────────────
    const gamesSinceRestore = this.stats.gamesPlayed - this._lastRestorationGame;
    if (best > 0.44 && winRate50 < best - CHECKPOINT_RESTORE_DROP && gamesSinceRestore >= 60) {
      this._checkpointPending = true;
      try {
        let restored = this.bestModel;
        if (!restored) {
          try {
            restored = await tf.loadLayersModel(BEST_MODEL_KEY);
            compileMultiHead(restored);
            this.bestModel = restored;
          } catch { /* no checkpoint saved yet */ }
        }
        if (restored) {
          // Copy weights directly into existing this.model — no new model creation needed
          const weights = restored.getWeights();
          this.model.setWeights(weights.map(w => w.clone()));
          weights.forEach(w => w.dispose());

          // Rebuild valueSubModel from this.model's own nodes (shared weights, no duplication)
          const boardIn = this.model.inputs.find(i => i.name.startsWith('board')) ?? this.model.inputs[0];
          const valOut  = this.model.outputs[1];
          this.valueSubModel = tf.model({ inputs: boardIn, outputs: valOut });

          // Reset temperature to explore more after restore
          this.stats.temperature = Math.min(TEMP_INITIAL, this.stats.temperature + 0.3);
          this.stats.checkpointRestorations = (this.stats.checkpointRestorations || 0) + 1;
          this._lastRestorationGame = this.stats.gamesPlayed;
          this._saveStats();
          await this.model.save(MODEL_KEY);
          console.log(`[AiBrain] 🔄 Checkpoint restored! Win rate was ${(winRate50 * 100).toFixed(0)}%, best was ${(best * 100).toFixed(0)}%. Restoration #${this.stats.checkpointRestorations}`);
        }
      } catch (e) {
        console.warn('[AiBrain] Checkpoint restore failed:', e);
      } finally {
        this._checkpointPending = false;
      }
    }
  }

  private async _checkPhaseAdvance(): Promise<void> {
    const history = this.stats.phaseRecentWins;
    if (history.length < PHASE_SAMPLE) return;

    const recent = history.slice(-PHASE_SAMPLE);
    const winRate = recent.filter(w => w).length / PHASE_SAMPLE;
    if (winRate < PHASE_WIN_THRESHOLD) return;

    console.log(`[AiBrain] Phase ${this.stats.phase} complete! Win rate ${(winRate * 100).toFixed(0)}% — advancing to phase ${this.stats.phase + 1}`);
    await this.saveFrozenModel();
    this.stats.phase++;
    this.stats.phaseGames = 0;
    this.stats.phaseRecentWins = [];
    this.stats.temperature = TEMP_INITIAL;
    this._saveStats();
  }

  // ── Phase / Frozen model ──────────────────────────────────────────────────

  getPhase(): { phase: number; phaseGames: number; winRateLast100: number; threshold: number; temperature: number } {
    const history = this.stats.phaseRecentWins || [];
    const recent = history.slice(-PHASE_SAMPLE);
    const winRate = recent.length > 0 ? recent.filter(w => w).length / recent.length : 0;
    return {
      phase: this.stats.phase || 0,
      phaseGames: this.stats.phaseGames || 0,
      winRateLast100: winRate,
      threshold: PHASE_WIN_THRESHOLD,
      temperature: this.stats.temperature ?? TEMP_INITIAL,
    };
  }

  hasFrozenModel(): boolean {
    return this.frozenModel !== null;
  }

  async saveFrozenModel(): Promise<void> {
    if (!this.model) return;
    try {
      const weights = this.model.getWeights();
      if (!this.frozenModel) {
        const { combined } = this._buildCombinedModel();
        this.frozenModel = combined;
      }
      this.frozenModel.setWeights(weights.map(w => w.clone()));
      await this.frozenModel.save(FROZEN_KEY);
      await this.frozenModel.save(FROZEN_KEY_PHASE(this.stats.phase));
      console.log(`[AiBrain] Frozen model saved (phase ${this.stats.phase})`);
    } catch (e) {
      console.warn('[AiBrain] Failed to save frozen model:', e);
    }
  }

  /** Load a random frozen model from the pool (phases 1..currentPhase). Used by self-play. */
  async loadRandomFrozenModel(): Promise<void> {
    const phase = this.stats.phase;
    if (phase === 0) return;

    const targetPhase = Math.floor(Math.random() * phase) + 1;
    try {
      const m = await tf.loadLayersModel(FROZEN_KEY_PHASE(targetPhase));
      compileMultiHead(m);
      this.frozenModel = m;
      console.log(`[AiBrain] Pool: loaded frozen model from phase ${targetPhase}/${phase}`);
    } catch {
      try {
        const m = await tf.loadLayersModel(FROZEN_KEY);
        compileMultiHead(m);
        this.frozenModel = m;
      } catch { /* ignore */ }
    }
  }

  /** Score actions using the frozen model — for the opponent in phase 1+ self-play. Always exploits (no epsilon). */
  scoreFrozenActionsSync(
    boardFeatures: number[],
    candidateCards: any[],
    actionType: ActionType,
  ): number[] {
    if (candidateCards.length <= 1) return candidateCards.map((_, i) => i);
    if (!this.frozenModel) return candidateCards.map((_, i) => i);

    try {
      const scores = tf.tidy(() => {
        const boardInputs  = candidateCards.map(() => boardFeatures.slice(0, BOARD_FEAT_SIZE));
        const actionInputs = candidateCards.map(card => this.extractActionFeatures(card, actionType));
        const bTensor = tf.tensor2d(boardInputs);
        const aTensor = tf.tensor2d(actionInputs);
        const [policyPred] = this.frozenModel!.predict([bTensor, aTensor]) as tf.Tensor[];
        return Array.from(policyPred.dataSync());
      });
      return scores
        .map((score, i) => ({ score, i }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.i);
    } catch {
      return candidateCards.map((_, i) => i);
    }
  }

  // ── Cloud sync (federated learning) ──────────────────────────────────────

  private _lastCloudSync = 0;
  private static CLOUD_SYNC_COOLDOWN_MS = 60_000;

  /**
   * Upload local weights to Firestore (FedAvg merge).
   * Called after trainOnGame. Throttled to once per minute.
   */
  async syncToCloud(): Promise<void> {
    if (!this.model) return;
    const now = Date.now();
    if (now - this._lastCloudSync < AiBrain.CLOUD_SYNC_COOLDOWN_MS) return;
    this._lastCloudSync = now;
    try {
      const { uploadBrainContribution } = await import('../lib/firebase');
      const tfWeights = this.model.getWeights();
      const weights = tfWeights.map((w) => Array.from(w.dataSync()));
      const shapes  = tfWeights.map((w) => [...w.shape] as number[]);
      await uploadBrainContribution(weights, shapes);
      console.log('[AiBrain] Weights uploaded to cloud');
    } catch (e) {
      console.warn('[AiBrain] Cloud upload failed (non-fatal):', e);
    }
  }

  /**
   * Download global model from Firestore and blend with local model.
   * Called on initialize(). Non-fatal if offline or no global model yet.
   */
  async syncFromCloud(): Promise<void> {
    if (!this.model) return;
    try {
      const { downloadGlobalBrain } = await import('../lib/firebase');
      const data = await downloadGlobalBrain();
      if (!data?.weights?.length) return;

      const currentWeights = this.model.getWeights();
      const localCount  = Math.max(this.stats.gamesPlayed, 1);
      const globalCount = data.gamesCount || 1;

      const globalBlend = Math.min(globalCount / (globalCount + localCount), 0.9);

      const newWeights = data.weights.map((globalW, i) => {
        const shape  = [...currentWeights[i].shape] as number[];
        const localW = Array.from(currentWeights[i].dataSync());
        const blended = globalW.map((gw, j) =>
          gw * globalBlend + (localW[j] ?? 0) * (1 - globalBlend)
        );
        return tf.tensor(blended, shape);
      });

      this.model.setWeights(newWeights);
      newWeights.forEach((w) => w.dispose());

      await this.model.save(MODEL_KEY);
      this.stats.cloudGamesCount = globalCount;
      this._saveStats();
      console.log(`[AiBrain] Synced from cloud (${globalCount} global games, blend=${(globalBlend*100).toFixed(0)}%)`);
    } catch (e) {
      console.warn('[AiBrain] Cloud download failed (non-fatal):', e);
    }
  }

  // ── Export for bundling ───────────────────────────────────────────────────

  /**
   * Serialize current combined model weights to JSON for bundling.
   * Save to public/data/ai-brain-prebuilt.json and commit.
   */
  async exportForBundling(): Promise<string> {
    if (!this.model) throw new Error('Model not initialized');
    const tfWeights = this.model.getWeights();
    const weights = tfWeights.map(w => ({
      shape: [...w.shape] as number[],
      data: Array.from(w.dataSync()),
    }));
    return JSON.stringify({
      version: 4,  // bumped for combined model format
      gamesPlayed: this.stats.gamesPlayed,
      cloudGamesCount: this.stats.cloudGamesCount,
      exportedAt: new Date().toISOString(),
      weights,
    }, null, 2);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  async reset(): Promise<void> {
    try { await tf.io.removeModel(MODEL_KEY); } catch {}

    const { combined, valueSubModel } = this._buildCombinedModel();
    this.model = combined;
    this.valueSubModel = valueSubModel;
    this.frozenModel = null;

    try { await tf.io.removeModel(FROZEN_KEY); } catch {}
    for (let p = 1; p <= 20; p++) { try { await tf.io.removeModel(FROZEN_KEY_PHASE(p)); } catch {} }
    // Clean up old separate value model key and best checkpoint
    try { await tf.io.removeModel(VALUE_MODEL_KEY); } catch {}
    try { await tf.io.removeModel(BEST_MODEL_KEY); } catch {}
    this.bestModel = null;

    this.stats = { gamesPlayed: 0, wins: 0, temperature: TEMP_INITIAL, lastTrained: null, recentRewards: [], cloudGamesCount: 0, phase: 0, phaseGames: 0, phaseRecentWins: [], bestWinRate: 0, checkpointRestorations: 0 };
    this._saveStats();
    this.decisions = [];

    try {
      localStorage.removeItem(REPLAY_KEY);
      await this.model.save(MODEL_KEY);
    } catch {}

    console.log('[AiBrain] Brain reset');
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const aiBrain = new AiBrain();

// Auto-initialize in background (non-blocking)
aiBrain.initialize().catch((e) => console.warn('[AiBrain] Background init failed:', e));
