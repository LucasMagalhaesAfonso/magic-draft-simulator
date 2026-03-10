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

const MODEL_KEY           = 'indexeddb://magic-draft-ai-brain-v4'; // v4: new arch
const FROZEN_KEY          = 'indexeddb://magic-draft-ai-frozen-v4';
const FROZEN_KEY_PHASE    = (p: number) => `indexeddb://magic-draft-ai-frozen-v4-p${p}`;
const STATS_KEY           = 'magic_draft_ai_stats_v4';
const REPLAY_KEY          = 'magic_draft_ai_replay_v3';
// Boltzmann temperature exploration (replaces epsilon-greedy)
const TEMP_INITIAL        = 2.0;      // high = explore freely
const TEMP_MIN            = 0.3;      // low = mostly exploit (but not hard argmax)
const TEMP_DECAY          = 0.004;    // reaches TEMP_MIN in ~425 games
const LEARNING_RATE       = 0.001;
const INPUT_SIZE          = 45;
const DISCOUNT            = 0.97;
const REPLAY_MAX          = 1000;     // bigger buffer = less forgetting
const REPLAY_SAMPLE       = 64;       // larger batch from replay
const REPLAY_ALPHA        = 0.6;      // priority exponent for prioritized replay
const REPLAY_EPS_P        = 0.01;     // small constant to avoid zero priority
const BASELINE_WINDOW     = 20;
const PHASE_WIN_THRESHOLD = 0.63;
const PHASE_SAMPLE        = 100;

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
}

interface DecisionRecord {
  boardFeatures: number[];
  actionFeatures: number[];
  boardEval: number;   // board score at decision time (for intermediate rewards)
}

interface ReplayEntry {
  input: number[];
  target: number;
  priority: number;  // |target - 0.5| + REPLAY_EPS_P — for prioritized sampling
}

// ─── AiBrain class ────────────────────────────────────────────────────────────

class AiBrain {
  private model: tf.LayersModel | null = null;
  private frozenModel: tf.LayersModel | null = null;
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
        if (s.phase === undefined) s.phase = 0;
        if (!s.phaseGames) s.phaseGames = 0;
        if (!s.phaseRecentWins) s.phaseRecentWins = [];
        // Migrate epsilon → temperature
        if (s.temperature === undefined) s.temperature = TEMP_INITIAL;
        return s;
      }
    } catch {}
    return { gamesPlayed: 0, wins: 0, temperature: TEMP_INITIAL, lastTrained: null, recentRewards: [], cloudGamesCount: 0, phase: 0, phaseGames: 0, phaseRecentWins: [] };
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

  private _buildModel(): tf.LayersModel {
    const model = tf.sequential();
    // Input → Dense(128, relu) — larger first layer for richer representations
    model.add(tf.layers.dense({ inputShape: [INPUT_SIZE], units: 128, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.3 }));
    // Dense(64, relu)
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
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
        // No local model — try bundled prebuilt first, then fresh
        const loaded = await this._tryLoadPrebuilt();
        if (!loaded) {
          this.model = this._buildModel();
          console.log('[AiBrain] Created fresh model');
        }
        if (this.model) {
          this.model.compile({
            optimizer: tf.train.adam(LEARNING_RATE),
            loss: 'binaryCrossentropy',
          });
        }
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

      // Load frozen opponent model (phase 1+ self-play), non-fatal
      try {
        this.frozenModel = await tf.loadLayersModel(FROZEN_KEY);
        this.frozenModel.compile({ optimizer: tf.train.adam(LEARNING_RATE), loss: 'binaryCrossentropy' });
        console.log('[AiBrain] Frozen model loaded for phase', this.stats.phase);
      } catch { /* No frozen model yet — phase 0 */ }

      // Sync from cloud (non-blocking, non-fatal)
      this.syncFromCloud().catch(() => {});

      this._initialized = true;
    } catch (e) {
      console.warn('[AiBrain] Failed to initialize:', e);
      this.model = null;
    }
    this._initializing = false;
  }

  /** Try loading the bundled prebuilt model from /data/ai-brain-prebuilt.json */
  private async _tryLoadPrebuilt(): Promise<boolean> {
    try {
      const res = await fetch('/data/ai-brain-prebuilt.json');
      if (!res.ok) return false;
      const data = await res.json();
      if (!data?.weights?.length) return false;

      const model = this._buildModel();
      const tensors = (data.weights as { shape: number[]; data: number[] }[])
        .map(w => tf.tensor(w.data, w.shape));
      model.setWeights(tensors);
      tensors.forEach(t => t.dispose());

      this.model = model;
      await this.model.save(MODEL_KEY); // persist to IndexedDB for next session
      console.log(`[AiBrain] Loaded prebuilt model (${data.gamesPlayed || 0} games bundled)`);
      return true;
    } catch {
      return false;
    }
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
    if (!this.model) return candidateCards.map((_, i) => i);

    try {
      const rawScores = tf.tidy(() => {
        const inputs = candidateCards.map((card) => [
          ...boardFeatures,
          ...this.extractActionFeatures(card, actionType),
        ]);
        const inputTensor = tf.tensor2d(inputs);
        const predictions = this.model!.predict(inputTensor) as tf.Tensor;
        return Array.from(predictions.dataSync());
      });

      // ── Boltzmann (softmax temperature) exploration ──────────────────────
      // High temperature → explore (soft distribution)
      // Low temperature  → exploit (near-deterministic argmax)
      const T = Math.max(this.stats.temperature, 0.01);
      const scaled = rawScores.map(s => s / T);
      const maxS = Math.max(...scaled);
      const exps = scaled.map(s => Math.exp(s - maxS)); // numerically stable
      const sumExp = exps.reduce((a, b) => a + b, 0);
      const probs = exps.map(p => p / sumExp);

      // Sample one action from the Boltzmann distribution
      let r = Math.random();
      let sampledIdx = rawScores.length - 1;
      for (let i = 0; i < probs.length; i++) {
        r -= probs[i];
        if (r <= 0) { sampledIdx = i; break; }
      }

      // Return: sampled first, rest sorted by raw score descending
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

  recordDecision(boardFeatures: number[], actionFeatures: number[]): void {
    if (this.decisions.length < 200) {
      // Compute board evaluation from features for intermediate reward calculation
      // f[0]=myLife/20, f[1]=oppLife/20, f[2]=myCreatures/10, f[3]=oppCreatures/10
      // f[4]=myPower/20, f[5]=oppPower/20, f[14]=myHand/7, f[15]=oppHand/7
      const boardEval =
        (boardFeatures[0] - boardFeatures[1]) * 3.0 +   // life diff
        (boardFeatures[2] - boardFeatures[3]) * 1.0 +   // creature count
        (boardFeatures[4] - boardFeatures[5]) * 1.5 +   // power diff
        (boardFeatures[6] - boardFeatures[7]) * 0.5 +   // toughness
        (boardFeatures[14] - boardFeatures[15]) * 0.5;  // hand size
      this.decisions.push({ boardFeatures: [...boardFeatures], actionFeatures: [...actionFeatures], boardEval });
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

    // ── Temporal discounting + Intermediate rewards ────────────────────────
    const n = this.decisions.length;
    const currentInputs = this.decisions.map((d) => [...d.boardFeatures, ...d.actionFeatures]);
    const currentTargets = this.decisions.map((d, i) => {
      const decay = Math.pow(DISCOUNT, n - 1 - i);
      let target  = 0.5 + advantage * decay * 0.5;

      // Intermediate reward: did the board improve after this decision?
      if (i < this.decisions.length - 1) {
        const nextEval = this.decisions[i + 1].boardEval;
        const delta = nextEval - d.boardEval;
        const normDelta = Math.tanh(delta * 0.4); // clamp to [-1, 1]
        target += normDelta * 0.15;               // small but meaningful signal
      }

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

    // ── Save new decisions to replay buffer (with priority) ───────────────
    const newReplayEntries: ReplayEntry[] = currentInputs.map((inp, i) => ({
      input: inp,
      target: currentTargets[i],
      priority: Math.abs(currentTargets[i] - 0.5) + REPLAY_EPS_P,
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
  }

  private async _checkPhaseAdvance(): Promise<void> {
    const history = this.stats.phaseRecentWins;
    if (history.length < PHASE_SAMPLE) return; // not enough data yet

    const recent = history.slice(-PHASE_SAMPLE);
    const winRate = recent.filter(w => w).length / PHASE_SAMPLE;
    if (winRate < PHASE_WIN_THRESHOLD) return;

    // Phase complete! Freeze current model and advance
    console.log(`[AiBrain] Phase ${this.stats.phase} complete! Win rate ${(winRate * 100).toFixed(0)}% — advancing to phase ${this.stats.phase + 1}`);
    await this.saveFrozenModel();
    this.stats.phase++;
    this.stats.phaseGames = 0;
    this.stats.phaseRecentWins = [];
    this.stats.temperature = TEMP_INITIAL; // Reset exploration for new phase
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
        this.frozenModel = this._buildModel();
        this.frozenModel.compile({ optimizer: tf.train.adam(LEARNING_RATE), loss: 'binaryCrossentropy' });
      }
      this.frozenModel.setWeights(weights.map(w => w.clone()));
      // Save to main FROZEN_KEY (current opponent) and phase-specific key (pool archive)
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
    if (phase === 0) return; // No frozen models yet

    // Pick a random phase from 1..phase
    const targetPhase = Math.floor(Math.random() * phase) + 1;
    try {
      const m = await tf.loadLayersModel(FROZEN_KEY_PHASE(targetPhase));
      m.compile({ optimizer: tf.train.adam(LEARNING_RATE), loss: 'binaryCrossentropy' });
      this.frozenModel = m;
      console.log(`[AiBrain] Pool: loaded frozen model from phase ${targetPhase}/${phase}`);
    } catch {
      // Fall back to main frozen key
      try {
        const m = await tf.loadLayersModel(FROZEN_KEY);
        m.compile({ optimizer: tf.train.adam(LEARNING_RATE), loss: 'binaryCrossentropy' });
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
        const inputs = candidateCards.map((card) => [
          ...boardFeatures,
          ...this.extractActionFeatures(card, actionType),
        ]);
        const inputTensor = tf.tensor2d(inputs);
        const predictions = this.frozenModel!.predict(inputTensor) as tf.Tensor;
        return Array.from(predictions.dataSync());
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
  private static CLOUD_SYNC_COOLDOWN_MS = 60_000; // max 1 upload per minute

  /**
   * Upload local weights to Firestore (FedAvg merge).
   * Called after trainOnGame. Throttled to once per minute to avoid
   * concurrent transaction conflicts during rapid self-play sessions.
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
      // NOTE: do NOT dispose tfWeights — getWeights() returns the model's own
      // LayerVariable tensors; disposing them destroys the model parameters.
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

      // Blend: more weight to whichever has more games
      const globalBlend = Math.min(globalCount / (globalCount + localCount), 0.9);

      const newWeights = data.weights.map((globalW, i) => {
        const shape  = [...currentWeights[i].shape] as number[];
        const localW = Array.from(currentWeights[i].dataSync());
        const blended = globalW.map((gw, j) =>
          gw * globalBlend + (localW[j] ?? 0) * (1 - globalBlend)
        );
        return tf.tensor(blended, shape);
      });

      // currentWeights are the model's own LayerVariables — do NOT dispose them.
      this.model.setWeights(newWeights);
      // newWeights are temporary tensors we created above — safe to dispose.
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
   * Serialize current model weights to a JSON string suitable for bundling.
   * Save the result to public/data/ai-brain-prebuilt.json and commit it.
   * New users will automatically load this model on first launch.
   *
   * Call syncFromCloud() first to include other players' training data.
   */
  async exportForBundling(): Promise<string> {
    if (!this.model) throw new Error('Model not initialized');
    const tfWeights = this.model.getWeights();
    const weights = tfWeights.map(w => ({
      shape: [...w.shape] as number[],
      data: Array.from(w.dataSync()),
    }));
    // tfWeights are the model's own LayerVariables — do NOT dispose them.
    return JSON.stringify({
      version: 3,
      gamesPlayed: this.stats.gamesPlayed,
      cloudGamesCount: this.stats.cloudGamesCount,
      exportedAt: new Date().toISOString(),
      weights,
    }, null, 2);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  async reset(): Promise<void> {
    try { await tf.io.removeModel(MODEL_KEY); } catch {}

    this.model = this._buildModel();
    this.frozenModel = null;
    try { await tf.io.removeModel(FROZEN_KEY); } catch {}
    // Clean up per-phase frozen models (up to phase 20)
    for (let p = 1; p <= 20; p++) { try { await tf.io.removeModel(FROZEN_KEY_PHASE(p)); } catch {} }
    this.stats = { gamesPlayed: 0, wins: 0, temperature: TEMP_INITIAL, lastTrained: null, recentRewards: [], cloudGamesCount: 0, phase: 0, phaseGames: 0, phaseRecentWins: [] };
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
