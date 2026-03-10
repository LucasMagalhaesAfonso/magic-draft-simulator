// ai-brain.ts — Neural network AI that learns from playing against the human
// Architecture: 40 inputs → Dense(64) → Dropout(0.3) → Dense(32) → Dense(1, sigmoid)
//
// Improvements over v1:
//   1. Soft labels (0.8/0.2 instead of 1.0/0.0) — prevents collapse
//   2. Dropout regularization — prevents overfitting on early games
//   3. REINFORCE baseline — subtracts mean recent reward to reduce variance
//   4. Temporal discounting — later decisions get higher reward weight
//   5. Experience replay buffer — prevents catastrophic forgetting

import * as tf from '@tensorflow/tfjs';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_KEY       = 'indexeddb://magic-draft-ai-brain-v3';
const STATS_KEY       = 'magic_draft_ai_stats_v3';
const REPLAY_KEY      = 'magic_draft_ai_replay_v2';
const EPSILON_DECAY   = 0.005;
const MIN_EPSILON     = 0.05;
const INITIAL_EPSILON = 0.30;
const LEARNING_RATE   = 0.001;
const INPUT_SIZE      = 45;           // 35 board + 10 action
const DISCOUNT        = 0.97;         // temporal discount factor
const REPLAY_MAX      = 300;          // max entries in replay buffer
const REPLAY_SAMPLE   = 40;           // how many replay entries to mix in per training
const BASELINE_WINDOW = 20;           // recent games used for baseline

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionType = 'play' | 'attack' | 'block' | 'target' | 'instant';

export interface AiBrainStats {
  gamesPlayed: number;
  wins: number;
  epsilon: number;
  lastTrained: string | null;
  recentRewards: number[];           // last BASELINE_WINDOW soft rewards
}

interface DecisionRecord {
  boardFeatures: number[];
  actionFeatures: number[];
}

interface ReplayEntry {
  input: number[];   // boardFeatures + actionFeatures (40 values)
  target: number;    // the reward label [0.05, 0.95]
}

// ─── AiBrain class ────────────────────────────────────────────────────────────

class AiBrain {
  private model: tf.LayersModel | null = null;
  private decisions: DecisionRecord[] = [];
  private stats: AiBrainStats;
  private _initialized = false;
  private _initializing = false;

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
        return s;
      }
    } catch {}
    return { gamesPlayed: 0, wins: 0, epsilon: INITIAL_EPSILON, lastTrained: null, recentRewards: [] };
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
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  }

  private _saveReplayBuffer(buffer: ReplayEntry[], newEntries: ReplayEntry[]): void {
    try {
      // Keep balanced: alternate adding to avoid bias
      const combined = [...buffer, ...newEntries];
      // Trim to REPLAY_MAX — keep most recent
      const trimmed = combined.slice(-REPLAY_MAX);
      localStorage.setItem(REPLAY_KEY, JSON.stringify(trimmed));
    } catch {}
  }

  private _sampleReplay(buffer: ReplayEntry[], count: number): ReplayEntry[] {
    if (buffer.length <= count) return [...buffer];
    const result: ReplayEntry[] = [];
    const used = new Set<number>();
    while (result.length < count) {
      const idx = Math.floor(Math.random() * buffer.length);
      if (!used.has(idx)) { used.add(idx); result.push(buffer[idx]); }
    }
    return result;
  }

  // ── Model construction ─────────────────────────────────────────────────────

  private _buildModel(): tf.LayersModel {
    const model = tf.sequential();
    // Input → Dense(64, relu)
    model.add(tf.layers.dense({ inputShape: [INPUT_SIZE], units: 64, activation: 'relu' }));
    // Dropout 30% — prevents overfitting when data is sparse (early games)
    model.add(tf.layers.dropout({ rate: 0.3 }));
    // Dense(32, relu)
    model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    // Output: Q-value [0,1]
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
    model.compile({
      optimizer: tf.train.adam(LEARNING_RATE),
      loss: 'binaryCrossentropy',
    });
    return model;
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._initialized || this._initializing) return;
    this._initializing = true;
    try {
      try {
        this.model = await tf.loadLayersModel(MODEL_KEY);
        this.model.compile({
          optimizer: tf.train.adam(LEARNING_RATE),
          loss: 'binaryCrossentropy',
        });
        console.log('[AiBrain] Loaded model from IndexedDB');
      } catch {
        this.model = this._buildModel();
        console.log('[AiBrain] Created fresh model');
      }
      // Warmup: run one forward pass to pre-compile WebGL shaders.
      // Without this, the FIRST call to scoreActionsSync blocks the main thread
      // for ~500ms while TF.js compiles GPU programs — freezing the UI mid-game.
      if (this.model) {
        try {
          tf.tidy(() => {
            const dummy = tf.zeros([1, INPUT_SIZE]);
            (this.model!.predict(dummy) as tf.Tensor).dataSync();
          });
          console.log('[AiBrain] Warmup pass complete — shaders compiled');
        } catch { /* non-fatal */ }
      }

      this._initialized = true;
    } catch (e) {
      console.warn('[AiBrain] Failed to initialize:', e);
      this.model = null;
    }
    this._initializing = false;
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
        // Rough lethal estimate: opp power per turn vs my life (ignoring blocks for conservatism)
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
   * Epsilon-greedy: with probability epsilon returns random order for exploration.
   */
  scoreActionsSync(
    boardFeatures: number[],
    candidateCards: any[],
    actionType: ActionType,
  ): number[] {
    if (candidateCards.length <= 1) return candidateCards.map((_, i) => i);

    // Epsilon-greedy exploration
    if (Math.random() < this.stats.epsilon) {
      const indices = candidateCards.map((_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      return indices;
    }

    if (!this.model) return candidateCards.map((_, i) => i);

    try {
      const scores = tf.tidy(() => {
        const inputs = candidateCards.map((card) => [
          ...boardFeatures,
          ...this.extractActionFeatures(card, actionType),
        ]);
        const inputTensor = tf.tensor2d(inputs);
        const predictions = this.model!.predict(inputTensor) as tf.Tensor;
        return Array.from(predictions.dataSync());
      });

      return scores
        .map((score, i) => ({ score, i }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.i);
    } catch (e) {
      console.warn('[AiBrain] scoreActionsSync failed:', e);
      return candidateCards.map((_, i) => i);
    }
  }

  // ── Decision recording ────────────────────────────────────────────────────

  recordDecision(boardFeatures: number[], actionFeatures: number[]): void {
    if (this.decisions.length < 200) {
      this.decisions.push({ boardFeatures: [...boardFeatures], actionFeatures: [...actionFeatures] });
    }
  }

  // ── Training ──────────────────────────────────────────────────────────────

  /**
   * Called at game end. Trains with:
   *   - Soft labels (won → 0.8, lost → 0.2)
   *   - REINFORCE baseline (subtract mean recent reward)
   *   - Temporal discounting (later decisions matter more)
   *   - Experience replay (mix in 40 past decisions)
   */
  async trainOnGame(won: boolean): Promise<void> {
    const softReward = won ? 0.8 : 0.2;

    // ── REINFORCE baseline ─────────────────────────────────────────────────
    const recent = this.stats.recentRewards;
    const baseline = recent.length >= 3
      ? recent.reduce((a, b) => a + b, 0) / recent.length
      : 0.5;
    const advantage = softReward - baseline;  // positive = better than expected

    if (!this.model || this.decisions.length === 0) {
      this._updateStatsAfterGame(won, softReward);
      this.decisions = [];
      return;
    }

    // ── Temporal discounting ───────────────────────────────────────────────
    const n = this.decisions.length;
    const currentInputs  = this.decisions.map((d) => [...d.boardFeatures, ...d.actionFeatures]);
    const currentTargets = this.decisions.map((_d, i) => {
      // Later decisions (closer to game end) carry more weight
      const decay  = Math.pow(DISCOUNT, n - 1 - i);
      const target = 0.5 + advantage * decay * 0.5;
      return Math.max(0.05, Math.min(0.95, target));
    });

    // ── Experience replay ──────────────────────────────────────────────────
    const buffer  = this._loadReplayBuffer();
    const sampled = this._sampleReplay(buffer, REPLAY_SAMPLE);

    const allInputs  = [...currentInputs,  ...sampled.map((e) => e.input)];
    const allTargets = [...currentTargets, ...sampled.map((e) => e.target)];

    try {
      const inputTensor  = tf.tensor2d(allInputs);
      const targetTensor = tf.tensor2d(allTargets.map((t) => [t]));

      await this.model.fit(inputTensor, targetTensor, {
        epochs: 3,
        batchSize: Math.min(32, allInputs.length),
        verbose: 0,
      });

      inputTensor.dispose();
      targetTensor.dispose();

      await this.model.save(MODEL_KEY);
      console.log(`[AiBrain] Trained on ${allInputs.length} samples (${currentInputs.length} new + ${sampled.length} replay). Won=${won}, advantage=${advantage.toFixed(2)}`);
    } catch (e) {
      console.warn('[AiBrain] Training failed:', e);
    }

    // ── Save new decisions to replay buffer ────────────────────────────────
    const newReplayEntries: ReplayEntry[] = currentInputs.map((inp, i) => ({
      input: inp,
      target: currentTargets[i],
    }));
    this._saveReplayBuffer(buffer, newReplayEntries);

    this._updateStatsAfterGame(won, softReward);
    this.decisions = [];
  }

  private _updateStatsAfterGame(won: boolean, softReward: number): void {
    this.stats.gamesPlayed++;
    if (won) this.stats.wins++;
    this.stats.epsilon     = Math.max(MIN_EPSILON, this.stats.epsilon - EPSILON_DECAY);
    this.stats.lastTrained = new Date().toISOString();
    this.stats.recentRewards = [...(this.stats.recentRewards || []), softReward];
    this._saveStats();
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  async reset(): Promise<void> {
    try { await tf.io.removeModel(MODEL_KEY); } catch {}

    this.model = this._buildModel();
    this.stats = { gamesPlayed: 0, wins: 0, epsilon: INITIAL_EPSILON, lastTrained: null, recentRewards: [] };
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
