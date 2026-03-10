// self-play.ts — Headless AI vs AI game runner
//
// Runs full games using the real engine with both players set to AI.
// After each game, trains the aiBrain to improve gameplay decisions.
// Runs in the browser's main thread using chunked setTimeout to avoid blocking UI.

import { aiBrain } from './ai-brain';
import { buildDeck } from '../draft/bot-ai';
import { getSetList, getCardsBySet } from '../lib/database';
import type { Card } from '../lib/types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SelfPlayStats {
  gamesCompleted: number;
  p0Wins: number;
  p1Wins: number;
  draws: number;
  avgTurns: number;
  running: boolean;
  currentGame: number;
  targetGames: number;
  setCode: string; // 'all' | 'tdm' | 'ltr' | etc.
  phase: number;
  phaseGames: number;
  phaseWinRate: number;  // win rate last 100 in current phase
  phaseJustAdvanced: boolean; // true for one update after phase advance
}

export interface SelfPlayCallbacks {
  onProgress?: (stats: SelfPlayStats) => void;
  onDone?: (stats: SelfPlayStats) => void;
}

// ── State ──────────────────────────────────────────────────────────────────────

let _running = false;
let _stopRequested = false;
const _stats: SelfPlayStats = {
  gamesCompleted: 0,
  p0Wins: 0,
  p1Wins: 0,
  draws: 0,
  avgTurns: 0,
  running: false,
  currentGame: 0,
  targetGames: 0,
  setCode: 'all',
  phase: 0,
  phaseGames: 0,
  phaseWinRate: 0,
  phaseJustAdvanced: false,
};

export function isRunning(): boolean { return _running; }
export function getStats(): SelfPlayStats { return { ..._stats }; }
export function stop(): void { _stopRequested = true; }

// ── Card conversion (mirrors useGameEngine.ts logic) ──────────────────────────

function toGameCard(card: Card, uid: string): any {
  const gc: any = {
    ...card,
    _uid: uid,
    _tapped: false,
    _attacking: false,
    _blocking: null,
    _powerMod: 0,
    _toughnessMod: 0,
    _counters: {},
    _damage: 0,
    _summoningSick: true,
    _tempKeywords: [],
    _triggers: [],
  };
  // Adventure/omen layout normalization
  const backFaceType = (card as any).back_face?.type_line || '';
  const backFaceIsSpell = /sorcery|instant/i.test(backFaceType);
  const isAdventure = card.layout === 'adventure' ||
    (card.layout === 'reversible_card' && backFaceIsSpell) ||
    ((card as any).back_face?.name && backFaceIsSpell);
  if (isAdventure && (card as any).back_face?.name) {
    gc.adventure = (card as any).back_face;
    gc.layout = 'adventure';
  }
  if (gc.mana_cost?.includes('//')) gc.mana_cost = gc.mana_cost.split('//')[0].trim();
  if (typeof gc.keywords === 'string') { try { gc.keywords = JSON.parse(gc.keywords); } catch { gc.keywords = []; } }
  if (!Array.isArray(gc.keywords)) gc.keywords = [];
  if (typeof gc.colors === 'string') { try { gc.colors = JSON.parse(gc.colors); } catch { gc.colors = []; } }
  if (typeof gc.color_identity === 'string') { try { gc.color_identity = JSON.parse(gc.color_identity); } catch { gc.color_identity = []; } }
  return gc;
}

// ── Auto-resolve stuck waitingForInput states ──────────────────────────────────

function _autoResolveWFI(state: any, GS: any, AI: any): boolean {
  const wfi = state.waitingForInput;
  if (!wfi) return false;

  const pid = wfi.playerId ?? 0;

  switch (wfi.type) {
    case 'stack_priority':
    case 'instant_priority':
    case 'trigger_priority': {
      // AI decides whether to cast instants
      try { AI.playInstantPhase(state, pid); } catch { /* ignore */ }
      if (state.waitingForInput?.type === wfi.type) {
        // Still stuck — force pass
        state.waitingForInput = null;
        if (state._pendingCastOnStack) {
          // Re-cast the pending spell
          const pending = state._pendingCastOnStack;
          delete state._pendingCastOnStack;
          state.players[pending.playerId]?.zones?.hand?.add?.(pending.card);
          try {
            GS.castSpell(state, pending.playerId, pending.card._uid, pending.targets || [], pending.isAdventure || false);
          } catch { /* ignore */ }
        }
      }
      return true;
    }

    case 'mulligan':
      // Auto-keep for self-play
      try { GS.keepHand(state, pid, []); } catch { /* ignore */ }
      state.waitingForInput = null;
      return true;

    case 'scry':
    case 'surveil':
      // Put all on top
      try {
        const cards = state._scryCards || state._surveilCards || [];
        GS.resolveScry?.(state, cards.map((_: any, i: number) => 'top' as const));
      } catch { /* ignore */ }
      state.waitingForInput = null;
      return true;

    case 'search_library':
    case 'search_library_gy': {
      // AI picks best card or passes
      const lib: any[] = state.players[pid]?.zones?.library?.getAll?.() || [];
      const pool: any[] = state._searchPool || lib;
      // Pick highest CMC non-land, or a land if no spells
      const lands = pool.filter((c: any) => (c.type_line || '').toLowerCase().includes('land'));
      const spells = pool.filter((c: any) => !(c.type_line || '').toLowerCase().includes('land'));
      const target = spells.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0))[0]
        || lands[0]
        || pool[0];
      try { GS.resolveSearchLibrary?.(state, target?._uid ?? null); } catch { /* ignore */ }
      if (state.waitingForInput?.type === wfi.type) state.waitingForInput = null;
      return true;
    }

    case 'discard':
    case 'mandatory_discard': {
      // Discard worst card (lowest cmc non-land)
      const hand: any[] = state.players[pid]?.zones?.hand?.getAll?.() || [];
      const sorted = [...hand].sort((a: any, b: any) => (a.cmc || 0) - (b.cmc || 0));
      const count = wfi.count || 1;
      const toDiscard = sorted.slice(0, count).map((c: any) => c._uid);
      try { GS.resolveDiscard?.(state, toDiscard); } catch { /* ignore */ }
      if (state.waitingForInput?.type === wfi.type) state.waitingForInput = null;
      return true;
    }

    case 'loot_discard': {
      const hand: any[] = state.players[pid]?.zones?.hand?.getAll?.() || [];
      const worst = [...hand].sort((a: any, b: any) => (a.cmc || 0) - (b.cmc || 0))[0];
      try { GS.resolveLootDiscard?.(state, worst?._uid ?? null); } catch { /* ignore */ }
      if (state.waitingForInput?.type === wfi.type) state.waitingForInput = null;
      return true;
    }

    case 'choose_modal':
    case 'modal': {
      // Pick first mode
      try { GS.resolveModal?.(state, [0]); } catch { /* ignore */ }
      if (state.waitingForInput?.type === wfi.type) state.waitingForInput = null;
      return true;
    }

    case 'choose_target':
    case 'choose_target_single': {
      // Pick first available target
      const targets: any[] = state._validTargets || [];
      const first = targets[0]?.uid || targets[0] || null;
      try { GS.resolveChooseTarget?.(state, first ? [first] : []); } catch { /* ignore */ }
      if (state.waitingForInput?.type === wfi.type) state.waitingForInput = null;
      return true;
    }

    case 'legendary_choice_pre_cast': {
      // In self-play player 0 is AI — auto-confirm cast with skip flag
      const pending = state._pendingLegendaryChoice;
      state.waitingForInput = null;
      delete state._pendingLegendaryChoice;
      if (pending) {
        state._skipLegendaryCheck = true;
        try {
          GS.castSpell(
            state,
            pending.playerId,
            pending.cardUid,
            pending.targets || [],
            pending.castingAdventure || false,
            pending.castingEvoke || false,
            false,
            pending.useCost,
            pending.useCmc,
            pending.fromExile || false
          );
        } catch { /* ignore */ }
        state._skipLegendaryCheck = false;
      }
      return true;
    }

    case 'legend_rule_sacrifice': {
      // AI always keeps the newest copy
      const candidates: any[] = state._pendingLegendRuleSacrifice?.candidates || [];
      const newCopy = candidates.find((c: any) => c.isNew);
      const keep = newCopy || candidates[0];
      if (keep) {
        const sacrifice = candidates.filter((c: any) => c.uid !== keep.uid);
        for (const s of sacrifice) {
          try {
            const bf = state.players[state._pendingLegendRuleSacrifice.controllerId].zones.battlefield;
            const card = bf.get(s.uid);
            if (card) GS.creatureDies?.(state, card, state._pendingLegendRuleSacrifice.controllerId);
            bf.remove(s.uid);
          } catch { /* ignore */ }
        }
      }
      delete state._pendingLegendRuleSacrifice;
      state.waitingForInput = null;
      // Fire deferred ETB if any
      if (state._deferredETB) {
        const { card, playerId } = state._deferredETB;
        delete state._deferredETB;
        try { GS._fireETB?.(state, card, playerId); } catch { /* ignore */ }
      }
      return true;
    }

    default:
      // Unknown WFI — force clear to prevent infinite loop
      state.waitingForInput = null;
      return true;
  }
}

// ── Basic land stubs ──────────────────────────────────────────────────────────

const BASIC_LAND_DATA: Record<string, { name: string; color: string; text: string }> = {
  W: { name: 'Plains',   color: 'W', text: '{T}: Add {W}.' },
  U: { name: 'Island',   color: 'U', text: '{T}: Add {U}.' },
  B: { name: 'Swamp',    color: 'B', text: '{T}: Add {B}.' },
  R: { name: 'Mountain', color: 'R', text: '{T}: Add {R}.' },
  G: { name: 'Forest',   color: 'G', text: '{T}: Add {G}.' },
};

function _makeLandCards(landsMap: Record<string, number>, prefix: string): Card[] {
  const result: Card[] = [];
  let idx = 0;
  for (const [color, count] of Object.entries(landsMap)) {
    const data = BASIC_LAND_DATA[color];
    if (!data || count <= 0) continue;
    for (let i = 0; i < count; i++) {
      result.push({
        id: `${prefix}-land-${color}-${idx++}`,
        name: data.name,
        type_line: `Basic Land — ${data.name}`,
        mana_cost: '',
        cmc: 0,
        oracle_text: data.text,
        colors: [data.color],
        color_identity: [data.color],
        keywords: [],
        rarity: 'common',
        set: 'basic',
        layout: 'normal',
      } as any as Card);
    }
  }
  return result;
}

// ── Run a single game ──────────────────────────────────────────────────────────

const MAX_TURNS = 80;
const MAX_ITERS_PER_TICK = 30;

async function _runOneGame(
  pool: Card[],
  GS: any,
  AI: any,
): Promise<{ winner: number; turns: number }> {
  // Build two random decks from the pool
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const sampleSize = Math.min(90, shuffled.length);
  const sample0 = shuffled.slice(0, sampleSize);
  const sample1 = shuffled.slice(Math.max(0, shuffled.length - sampleSize));

  const result0 = buildDeck(sample0);
  const result1 = buildDeck(sample1);

  const lands0 = _makeLandCards(result0.lands, 'sp0');
  const lands1 = _makeLandCards(result1.lands, 'sp1');
  const deck0: any[] = [...result0.deck, ...lands0].map((c, i) => toGameCard(c, `sp0-${i}-${c.id || i}`));
  const deck1: any[] = [...result1.deck, ...lands1].map((c, i) => toGameCard(c, `sp1-${i}-${c.id || i}`));

  if (deck0.length < 20 || deck1.length < 20) {
    return { winner: -1, turns: 0 };
  }

  // Create game state
  const state: any = GS.create(deck0, deck1);

  // Make BOTH players AI
  state.players[0].isHuman = false;

  // Self-play mode: player 0 trains, player 1 is the opponent (heuristic or frozen)
  const _phase = aiBrain.getPhase().phase;
  state._selfPlayMode = { trainingPlayer: 0, phase: _phase };

  // AI mulligan for player 0 (player 1 already done in create())
  GS._aiMulliganDecision(state, 0);

  // Clear mulligan WFI and start game
  state.waitingForInput = null;
  GS.startGame(state);

  let stuckCount = 0;
  let lastWFIType = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (_stopRequested) break;

    // Process up to MAX_ITERS_PER_TICK steps synchronously
    for (let iter = 0; iter < MAX_ITERS_PER_TICK; iter++) {
      if (state.winner !== null) break;

      // Auto-resolve waitingForInput states
      if (state.waitingForInput) {
        const wfiType = state.waitingForInput.type;
        if (wfiType === lastWFIType) {
          stuckCount++;
          if (stuckCount > 5) {
            // Truly stuck — force clear
            state.waitingForInput = null;
            stuckCount = 0;
          }
        } else {
          stuckCount = 0;
          lastWFIType = wfiType;
        }
        _autoResolveWFI(state, GS, AI);
        continue;
      }

      lastWFIType = '';
      stuckCount = 0;

      try {
        GS.reprocessCurrentPhase(state);
      } catch (e) {
        console.warn('[SelfPlay] reprocessCurrentPhase error:', e);
        break;
      }
    }

    if (state.winner !== null) break;

    // Yield to UI thread between turns
    await new Promise(r => setTimeout(r, 0));
  }

  // Force-end if no winner after MAX_TURNS
  if (state.winner === null) {
    // Player with more life wins
    const p0Life = state.players[0]?.life ?? 0;
    const p1Life = state.players[1]?.life ?? 0;
    state.winner = p0Life >= p1Life ? 0 : 1;
  }

  const winner = state.winner as number;
  const turns = state.turn || 1;

  // Train AI brain — from player 0's perspective (player 0 is the training player)
  const aiWon = winner === 0;
  try {
    await aiBrain.trainOnGame(aiWon);
  } catch { /* ignore */ }

  return { winner, turns };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** @param setCode - 'all' to use all sets, or a specific set code like 'tdm' or 'ltr' */
export async function run(targetGames: number, cbs?: SelfPlayCallbacks, setCode = 'all'): Promise<void> {
  if (_running) return;
  _running = true;
  _stopRequested = false;

  _stats.gamesCompleted = 0;
  _stats.p0Wins = 0;
  _stats.p1Wins = 0;
  _stats.draws = 0;
  _stats.avgTurns = 0;
  _stats.running = true;
  _stats.currentGame = 0;
  _stats.targetGames = targetGames;
  _stats.setCode = setCode;
  _stats.phaseJustAdvanced = false;

  try {
    // Load card pool — filtered by set if specified
    const setList = await getSetList();
    if (setList.length === 0) {
      console.warn('[SelfPlay] No sets in database');
      return;
    }

    const setsToUse = setCode === 'all'
      ? setList
      : setList.filter(s => s.set_code.toLowerCase() === setCode.toLowerCase());

    if (setsToUse.length === 0) {
      console.warn(`[SelfPlay] Set "${setCode}" not found in database`);
      return;
    }

    const allCards: Card[] = [];
    for (const s of setsToUse) {
      const cards = await getCardsBySet(s.set_code);
      allCards.push(...cards);
    }

    if (allCards.length < 40) {
      console.warn('[SelfPlay] Not enough cards in database');
      return;
    }

    // Load engine modules
    const [GS, AI] = await Promise.all([
      import('./game-state'),
      import('./game-ai'),
    ]);

    // Opponent pool: load a random frozen model from available phases
    if (aiBrain.getPhase().phase > 0) {
      await aiBrain.loadRandomFrozenModel();
      console.log(`[SelfPlay] Phase ${aiBrain.getPhase().phase} — loaded random opponent from pool`);
    }

    console.log(`[SelfPlay] Starting ${targetGames} games with ${allCards.length} cards`);

    for (let i = 0; i < targetGames && !_stopRequested; i++) {
      _stats.currentGame = i + 1;
      cbs?.onProgress?.({ ..._stats });

      const { winner, turns } = await _runOneGame(allCards, GS, AI);

      if (winner === 0) _stats.p0Wins++;
      else if (winner === 1) _stats.p1Wins++;
      else _stats.draws++;

      _stats.gamesCompleted++;
      _stats.avgTurns = (_stats.avgTurns * (_stats.gamesCompleted - 1) + turns) / _stats.gamesCompleted;

      // Sync phase info from aiBrain
      const _phaseInfo = aiBrain.getPhase();
      const _prevPhase = _stats.phase;
      _stats.phase = _phaseInfo.phase;
      _stats.phaseGames = _phaseInfo.phaseGames;
      _stats.phaseWinRate = _phaseInfo.winRateLast100;
      _stats.phaseJustAdvanced = _phaseInfo.phase > _prevPhase;

      cbs?.onProgress?.({ ..._stats });
    }

  } finally {
    _running = false;
    _stats.running = false;
    cbs?.onDone?.({ ..._stats });
    console.log(`[SelfPlay] Done: ${_stats.gamesCompleted} games, P0: ${_stats.p0Wins}W, P1: ${_stats.p1Wins}W, avg ${Math.round(_stats.avgTurns)} turns`);
  }
}
