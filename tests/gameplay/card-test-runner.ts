// @ts-nocheck
// card-test-runner.ts — Headless game runner that simulates human gameplay
// Creates a game, plays as human (P0), AI is opponent (P1), validates card effects

import * as GameState from '../../src/engine/game-state';
import * as Cards from '../../src/engine/cards';
import { CardEffectsDB } from '../../src/engine/card-effects';
import { respondToInput, type HumanAction, type SimHumanOptions } from './simulated-human';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export interface StateSnapshot {
  p0Life: number;
  p1Life: number;
  p0Hand: number;
  p1Hand: number;
  p0Creatures: number;
  p1Creatures: number;
  p0Lands: number;
  p0Tokens: number;
  p1Tokens: number;
  p0GraveyardSize: number;
  p1GraveyardSize: number;
  p0ExileSize: number;
  p1ExileSize: number;
  p0CountersTotal: number; // Sum of all +1/+1 on all our creatures
  turn: number;
  phase: string;
}

export interface CardTestResult {
  cardName: string;
  passed: boolean;
  assertions: AssertionResult[];
  actions: HumanAction[];
  turns: number;
  winner: number | null;
  error: string | null;
  log: string[];
  cardLog: string[];       // Log lines mentioning the card
  inputsHandled: string[]; // All waitingForInput types we responded to
  gs: any;                 // Final game state (for custom assertions)
  snapshotBeforePlay: StateSnapshot | null;  // State right before target card was cast
  snapshotAfterPlay: StateSnapshot | null;   // State right after target card effects resolved
  cardOnBattlefield: boolean;  // Is the card currently on battlefield?
  cardInGraveyard: boolean;    // Did it die?
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface CardTestScenario {
  /** Card name to test */
  cardName: string;
  /** Scryfall set code for card lookup */
  setCode?: string;
  /** How many copies of the card in deck */
  copies?: number;
  /** SimulatedHuman options */
  humanOptions?: SimHumanOptions;
  /** Max turns before stopping */
  maxTurns?: number;
  /** Max phases before stopping */
  maxPhases?: number;
  /** Assertions to check after game */
  assertions?: CardAssertion[];
  /** Put specific cards in opponent's deck */
  opponentCards?: string[];
  /** Additional cards in our deck */
  extraCards?: string[];
}

export interface CardAssertion {
  name: string;
  check: (result: CardTestResult, gs: any) => { passed: boolean; expected: string; actual: string };
}

// ═══════════════════════════════════════════════════════════════════════
// Card helpers (reused from test-card-ai.ts pattern)
// ═══════════════════════════════════════════════════════════════════════

function makeCard(base: any, uid: string): any {
  return {
    ...base, _uid: uid, _tapped: false, _attacking: false, _blocking: null,
    _powerMod: 0, _toughnessMod: 0, _counters: { '+1/+1': 0, '-1/-1': 0 },
    _damage: 0, _summoningSick: true, _tempKeywords: [], _tempPowerMod: 0, _tempToughnessMod: 0,
    _triggers: [],
  };
}

function makeLand(color: string, uid: string): any {
  const names: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  return makeCard({
    id: uid, oracle_id: `land-${uid}`, name: names[color], mana_cost: '', cmc: 0,
    type_line: `Basic Land — ${names[color]}`, oracle_text: '', colors: [], color_identity: [color],
    keywords: [], set_code: 'LND', set_name: '', collector_number: uid, rarity: 'common',
    image_small: '', image_normal: '', image_art_crop: '', layout: 'normal',
  }, uid);
}

function makeVanilla(idx: number, color: string, cmc: number, power: number, toughness: number, extra?: Partial<any>): any {
  const uid = `vanilla-${idx}`;
  return makeCard({
    id: uid, oracle_id: uid, name: `TestCreature_${idx}`, mana_cost: cmc <= 1 ? `{${color}}` : `{${cmc - 1}}{${color}}`,
    cmc, type_line: 'Creature — Human Warrior', oracle_text: '',
    power: String(power), toughness: String(toughness),
    colors: [color], color_identity: [color], keywords: [],
    set_code: 'TST', set_name: '', collector_number: String(idx), rarity: 'common',
    image_small: '', image_normal: '', image_art_crop: '', layout: 'normal',
    ...extra,
  }, uid);
}

function parseCMC(manaCost: string): number {
  if (!manaCost) return 0;
  let cmc = 0;
  const generic = manaCost.match(/\{(\d+)\}/g);
  if (generic) generic.forEach(m => { cmc += parseInt(m.replace(/[{}]/g, '')); });
  const colored = manaCost.match(/\{[WUBRGC]\}/g);
  if (colored) cmc += colored.length;
  const hybrid = manaCost.match(/\{[A-Z]\/[A-Z]\}/g);
  if (hybrid) cmc += hybrid.length;
  return cmc;
}

function parseColorsFromManaCost(manaCost: string): string[] {
  if (!manaCost) return ['W'];
  const found = new Set<string>();
  const matches = manaCost.match(/\{([WUBRG])(?:\/[WUBRG2])?\}/g) || [];
  for (const m of matches) {
    const inner = m.replace(/[{}]/g, '');
    for (const ch of inner.split('/')) {
      if ('WUBRG'.includes(ch)) found.add(ch);
    }
  }
  return found.size > 0 ? [...found] : ['W'];
}

// ═══════════════════════════════════════════════════════════════════════
// Scryfall loader
// ═══════════════════════════════════════════════════════════════════════

let _scryfallCache: Record<string, any[]> = {};

function loadScryfallCards(setCode: string): any[] {
  if (_scryfallCache[setCode]) return _scryfallCache[setCode];

  const basePath = path.resolve(process.cwd(), `legacy-pure-js/js/data/scryfall-${setCode.toLowerCase()}.json`);
  if (!fs.existsSync(basePath)) return [];

  const raw = fs.readFileSync(basePath, 'utf8');
  const jsonStart = raw.indexOf('{');
  if (jsonStart === -1) return [];
  const data = JSON.parse(raw.slice(jsonStart));
  _scryfallCache[setCode] = data.cards || [];
  return _scryfallCache[setCode];
}

export function findScryfallCard(name: string, setCode = 'ltr'): any | null {
  const cards = loadScryfallCards(setCode);
  const lower = name.toLowerCase();
  return cards.find((c: any) => c.name.toLowerCase() === lower) || null;
}

function scryfallToEngineCard(sc: any, uid: string): any {
  const entry = CardEffectsDB[sc.name.toLowerCase()] || {};
  const kw = (entry.static || [])
    .filter((s: any) => s.type === 'has_keyword')
    .flatMap((s: any) => s.keywords || [])
    .map((k: string) => k.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
  const allKw = [...(sc.keywords || []), ...kw].filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
  const computedCmc = sc.cmc || parseCMC(sc.mana_cost || '');
  return makeCard({
    id: uid, oracle_id: sc.oracle_id || uid, name: sc.name,
    mana_cost: sc.mana_cost || '', cmc: computedCmc,
    type_line: sc.type_line || '', oracle_text: sc.oracle_text || '',
    power: sc.power, toughness: sc.toughness,
    colors: sc.colors || [], color_identity: sc.color_identity || [],
    keywords: allKw, rarity: sc.rarity || 'common',
    set_code: sc.set_code || 'LTR', set_name: '', collector_number: sc.collector_number || uid,
    image_small: '', image_normal: '', image_art_crop: '',
    layout: sc.card_faces ? 'adventure' : (sc.layout || 'normal'),
    card_faces: sc.card_faces,
  }, uid);
}

// ═══════════════════════════════════════════════════════════════════════
// Deck builder
// ═══════════════════════════════════════════════════════════════════════

function buildPlayerDeck(scryfallCard: any, copies = 3, setCode = 'ltr'): any[] {
  const colors = scryfallCard.colors?.length > 0 ? scryfallCard.colors : parseColorsFromManaCost(scryfallCard.mana_cost || '');
  const cmc = scryfallCard.cmc || parseCMC(scryfallCard.mana_cost || '') || 3;
  const landCount = Math.min(22, Math.max(15, cmc + 10));
  const cards: any[] = [];

  // Copies of target card
  for (let i = 0; i < copies; i++) {
    cards.push(scryfallToEngineCard(scryfallCard, `target-${i}`));
  }

  // Lands
  const landsPerColor = Math.ceil(landCount / colors.length);
  for (const color of colors) {
    for (let i = 0; i < landsPerColor && cards.filter(c => c.type_line?.includes('Land')).length < landCount; i++) {
      cards.push(makeLand(color, `land-p0-${color}-${i}`));
    }
  }
  while (cards.filter(c => c.type_line?.includes('Land')).length < landCount) {
    cards.push(makeLand('W', `land-fill-${cards.length}`));
  }

  // Fill to 40 with vanilla creatures
  let idx = 0;
  while (cards.length < 40) {
    const color = colors[idx % colors.length];
    const c = 2 + (idx % 3); // cmc 2-4
    const p = 2 + (idx % 3); // power 2-4
    const t = 2 + (idx % 3); // toughness 2-4
    cards.push(makeVanilla(idx, color, c, p, t));
    idx++;
  }

  // Shuffle but keep target cards near top
  const nonTargets = cards.filter(c => !c.id?.startsWith('target-'));
  const targets = cards.filter(c => c.id?.startsWith('target-'));

  // Shuffle non-targets
  for (let i = nonTargets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nonTargets[i], nonTargets[j]] = [nonTargets[j], nonTargets[i]];
  }

  return [...targets, ...nonTargets];
}

function buildOpponentDeck(withLegendary = false): any[] {
  const cards: any[] = [];
  const colors = ['R', 'G'];
  for (let i = 0; i < 18; i++) cards.push(makeLand(colors[i % 2], `land-opp-${i}`));
  for (let i = 0; i < 22; i++) {
    const c = 2 + (i % 3);
    const p = 2 + (i % 3);
    const t = 2 + (i % 3);
    const extra: any = {};
    if (withLegendary && i === 0) {
      extra.type_line = 'Legendary Creature — Human Warrior';
      extra.name = `LegendaryWarrior_${i}`;
    }
    cards.push(makeVanilla(200 + i, colors[i % 2], c, p, t, extra));
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// ═══════════════════════════════════════════════════════════════════════
// State snapshot
// ═══════════════════════════════════════════════════════════════════════

function takeSnapshot(gs: any): StateSnapshot {
  const p0bf = gs.players[0].zones.battlefield.cards;
  const p1bf = gs.players[1].zones.battlefield.cards;
  return {
    p0Life: gs.players[0].life,
    p1Life: gs.players[1].life,
    p0Hand: gs.players[0].zones.hand.getAll().length,
    p1Hand: gs.players[1].zones.hand.getAll().length,
    p0Creatures: p0bf.filter((c: any) => c.type_line?.includes('Creature')).length,
    p1Creatures: p1bf.filter((c: any) => c.type_line?.includes('Creature')).length,
    p0Lands: p0bf.filter((c: any) => c.type_line?.includes('Land')).length,
    p0Tokens: p0bf.filter((c: any) => c._isToken).length,
    p1Tokens: p1bf.filter((c: any) => c._isToken).length,
    p0GraveyardSize: gs.players[0].zones.graveyard?.getAll?.()?.length || gs.players[0].zones.graveyard?.cards?.length || 0,
    p1GraveyardSize: gs.players[1].zones.graveyard?.getAll?.()?.length || gs.players[1].zones.graveyard?.cards?.length || 0,
    p0ExileSize: gs.players[0].zones.exile?.getAll?.()?.length || gs.players[0].zones.exile?.cards?.length || 0,
    p1ExileSize: gs.players[1].zones.exile?.getAll?.()?.length || gs.players[1].zones.exile?.cards?.length || 0,
    p0CountersTotal: p0bf.filter((c: any) => c.type_line?.includes('Creature'))
      .reduce((sum: number, c: any) => sum + (c._counters?.['+1/+1'] || 0), 0),
    turn: gs.turn,
    phase: gs.phase,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Game runner
// ═══════════════════════════════════════════════════════════════════════

export function runCardTest(scenario: CardTestScenario): CardTestResult {
  const {
    cardName,
    setCode = 'ltr',
    copies = 3,
    humanOptions = {},
    maxTurns = 30,
    maxPhases = 1500,
    assertions = [],
  } = scenario;

  const result: CardTestResult = {
    cardName,
    passed: true,
    assertions: [],
    actions: [],
    turns: 0,
    winner: null,
    error: null,
    log: [],
    cardLog: [],
    inputsHandled: [],
    gs: null,
    snapshotBeforePlay: null,
    snapshotAfterPlay: null,
    cardOnBattlefield: false,
    cardInGraveyard: false,
  };

  try {
    // Find the card
    const scCard = findScryfallCard(cardName, setCode);
    if (!scCard) {
      result.error = `Card "${cardName}" not found in scryfall-${setCode}.json`;
      result.passed = false;
      return result;
    }

    // Build decks
    const playerDeck = buildPlayerDeck(scCard, copies, setCode);
    const oppDeck = buildOpponentDeck();

    // Create game
    const gs = GameState.create(playerDeck, oppDeck);
    gs.players[0].isHuman = true;   // SimulatedHuman
    gs.players[1].isHuman = false;  // AI opponent

    // Set target card name for SimulatedHuman
    const opts: SimHumanOptions = {
      targetCardName: cardName,
      ...humanOptions,
    };

    // Mulligan phase
    GameState.keepHand(gs, 0, []);
    GameState.keepHand(gs, 1, []);
    GameState.startGame(gs);

    // Main game loop
    let phases = 0;
    let stuckCount = 0;
    let lastKey = '';
    const nameLC = cardName.toLowerCase();
    const startTime = Date.now();
    let cardJustCast = false;
    let phasesAfterCast = 0;

    while (!gs.winner && gs.turn <= maxTurns && phases < maxPhases) {
      // Timeout check (30s)
      if (Date.now() - startTime > 30000) {
        result.error = 'TIMEOUT (30s)';
        break;
      }

      // Handle waitingForInput
      if (gs.waitingForInput) {
        const wiType = gs.waitingForInput.type;
        const wiPlayer = gs.waitingForInput.playerId;

        if (wiPlayer === 0 || wiType === 'mulligan') {
          // Capture snapshot BEFORE casting the target card
          if (wiType === 'main_phase' && !result.snapshotBeforePlay) {
            const hand = gs.players[0].zones.hand.getAll();
            const hasTarget = hand.some((c: any) => c.name.toLowerCase() === nameLC);
            if (hasTarget) {
              result.snapshotBeforePlay = takeSnapshot(gs);
            }
          }

          // Our turn — SimulatedHuman responds
          const action = respondToInput(gs, opts);
          if (action) {
            result.actions.push(action);
            if (!result.inputsHandled.includes(wiType)) {
              result.inputsHandled.push(wiType);
            }
            // Detect when target card was just cast
            if (action.detail?.includes('cast target:') || action.detail?.toLowerCase().includes(nameLC)) {
              cardJustCast = true;
              phasesAfterCast = 0;
            }
          }
        } else {
          // AI's turn — clear waitingForInput and let engine handle
          gs.waitingForInput = null;
          GameState.reprocessCurrentPhase(gs);
        }
      } else {
        GameState.advancePhase(gs);
      }
      phases++;

      // Stuck detection
      const key = `${gs.turn}-${gs.phase}-${gs.activePlayer}-${gs.waitingForInput?.type || 'none'}`;
      if (key === lastKey) {
        stuckCount++;
        if (stuckCount > 40) {
          gs.waitingForInput = null;
          try { GameState.advancePhase(gs); } catch { /* */ }
          stuckCount = 0;
        }
      } else {
        stuckCount = 0;
        lastKey = key;
      }

      // NaN life check
      if (isNaN(gs.players[0].life) || isNaN(gs.players[1].life)) {
        result.error = 'NaN life detected';
        break;
      }

      // Capture snapshot ~10 phases after target card cast (effects + ETB targeting resolved)
      if (cardJustCast) {
        phasesAfterCast++;
        if (phasesAfterCast >= 10 && !result.snapshotAfterPlay) {
          result.snapshotAfterPlay = takeSnapshot(gs);
          cardJustCast = false;
        }
      }

      // Collect card-specific logs
      for (const line of gs.log.slice(result.log.length)) {
        if (line.toLowerCase().includes(nameLC)) {
          result.cardLog.push(line);
        }
      }
      result.log = [...gs.log];
    }

    result.turns = gs.turn;
    result.winner = gs.winner;
    result.gs = gs;

    // Check if card is on battlefield or graveyard
    const p0bf = gs.players[0].zones.battlefield.cards;
    const p0gy = gs.players[0].zones.graveyard?.getAll?.() || gs.players[0].zones.graveyard?.cards || [];
    result.cardOnBattlefield = p0bf.some((c: any) => c.name.toLowerCase() === nameLC);
    result.cardInGraveyard = p0gy.some((c: any) => c.name.toLowerCase() === nameLC);

    // If we didn't get afterPlay snapshot, take one now
    if (result.snapshotBeforePlay && !result.snapshotAfterPlay) {
      result.snapshotAfterPlay = takeSnapshot(gs);
    }

    // Run assertions
    for (const assertion of assertions) {
      try {
        const res = assertion.check(result, gs);
        result.assertions.push({ name: assertion.name, ...res });
        if (!res.passed) result.passed = false;
      } catch (e: any) {
        result.assertions.push({
          name: assertion.name,
          passed: false,
          expected: 'no error',
          actual: `CRASH: ${e.message}`,
        });
        result.passed = false;
      }
    }

  } catch (e: any) {
    result.error = `CRASH: ${e.message?.slice(0, 200)}`;
    result.passed = false;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Built-in assertion factories
// ═══════════════════════════════════════════════════════════════════════

/** Assert the card was cast (appears in log) */
export function assertCardWasPlayed(cardName: string): CardAssertion {
  return {
    name: `"${cardName}" was cast/played`,
    check: (result) => {
      const found = result.cardLog.some(l =>
        l.toLowerCase().includes('cast') ||
        l.toLowerCase().includes('plays') ||
        l.toLowerCase().includes('enters') ||
        l.toLowerCase().includes('etb')
      );
      return { passed: found, expected: 'card appears in log', actual: found ? 'found in log' : 'NOT found in log' };
    },
  };
}

/** Assert a specific log pattern appeared */
export function assertLogContains(pattern: string, description?: string): CardAssertion {
  return {
    name: description || `log contains "${pattern}"`,
    check: (result) => {
      const found = result.log.some(l => l.toLowerCase().includes(pattern.toLowerCase()));
      return { passed: found, expected: `"${pattern}" in log`, actual: found ? 'found' : 'NOT found' };
    },
  };
}

/** Assert game finished without crash */
export function assertNoCrash(): CardAssertion {
  return {
    name: 'game did not crash',
    check: (result) => ({
      passed: !result.error?.startsWith('CRASH'),
      expected: 'no crash',
      actual: result.error || 'clean',
    }),
  };
}

/** Assert game has a winner (didn't stall) */
export function assertGameFinished(): CardAssertion {
  return {
    name: 'game finished with winner',
    check: (result) => ({
      passed: result.winner !== null,
      expected: 'winner exists',
      actual: result.winner !== null ? `Player ${result.winner} won` : 'no winner (stalled)',
    }),
  };
}

/** Assert a specific waitingForInput type was triggered during the game */
export function assertInputTriggered(inputType: string, description?: string): CardAssertion {
  return {
    name: description || `triggered "${inputType}" input`,
    check: (result) => ({
      passed: result.inputsHandled.includes(inputType),
      expected: `"${inputType}" in inputs`,
      actual: result.inputsHandled.includes(inputType) ? 'triggered' : `NOT triggered. Had: [${result.inputsHandled.join(', ')}]`,
    }),
  };
}

/** Assert a creature on the battlefield has specific counters */
export function assertCreatureHasCounters(cardName: string, counterType: string, minCount: number): CardAssertion {
  return {
    name: `"${cardName}" has ${minCount}+ ${counterType} counters`,
    check: (_, gs) => {
      const all = [...gs.players[0].zones.battlefield.cards, ...gs.players[1].zones.battlefield.cards];
      const card = all.find((c: any) => c.name.toLowerCase() === cardName.toLowerCase());
      const count = card?._counters?.[counterType] || 0;
      return {
        passed: count >= minCount,
        expected: `${minCount}+ ${counterType}`,
        actual: card ? `${count} ${counterType}` : 'card not on battlefield',
      };
    },
  };
}

/** Assert opponent life is below starting */
export function assertOpponentTookDamage(): CardAssertion {
  return {
    name: 'opponent took damage',
    check: (_, gs) => ({
      passed: gs.players[1].life < 20,
      expected: 'life < 20',
      actual: `life = ${gs.players[1].life}`,
    }),
  };
}

/** Assert we drew cards (hand size increased or log shows draw) */
export function assertDrewCards(): CardAssertion {
  return {
    name: 'drew extra cards',
    check: (result) => {
      const found = result.log.some(l => l.toLowerCase().includes('draw') || l.toLowerCase().includes('compra'));
      return { passed: found, expected: 'draw in log', actual: found ? 'found' : 'NOT found' };
    },
  };
}

/** Assert a token was created */
export function assertTokenCreated(tokenName?: string): CardAssertion {
  return {
    name: tokenName ? `"${tokenName}" token created` : 'token created',
    check: (result, gs) => {
      const hasTokenLog = result.log.some(l =>
        l.toLowerCase().includes('token') || l.toLowerCase().includes('cria')
      );
      const hasTokenBf = gs.players[0].zones.battlefield.cards.some((c: any) => c._isToken);
      const hasTokenGy = gs.players[0].zones.graveyard?.getAll?.()?.some?.((c: any) => c._isToken);
      const found = hasTokenLog || hasTokenBf || hasTokenGy;
      return { passed: found, expected: 'token created', actual: found ? 'found' : 'NOT found' };
    },
  };
}

/** Assert equipment was attached */
export function assertEquipped(): CardAssertion {
  return {
    name: 'equipment was attached',
    check: (result) => {
      const found = result.log.some(l =>
        l.toLowerCase().includes('equip') || l.toLowerCase().includes('attach')
      );
      return { passed: found, expected: 'equip in log', actual: found ? 'found' : 'NOT found' };
    },
  };
}

/** Assert the ring tempted you */
export function assertRingTempted(): CardAssertion {
  return {
    name: 'ring tempted you',
    check: (result) => {
      const found = result.log.some(l =>
        l.toLowerCase().includes('ring tempts') || l.toLowerCase().includes('anel tenta')
      );
      return { passed: found, expected: 'ring tempts in log', actual: found ? 'found' : 'NOT found' };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// STATE-BASED assertions — check REAL game state changes
// ═══════════════════════════════════════════════════════════════════════

/** Assert opponent lost life compared to before the card was played */
export function assertOpponentLostLife(minAmount = 1): CardAssertion {
  return {
    name: `opponent lost ${minAmount}+ life after card played`,
    check: (result) => {
      if (!result.snapshotBeforePlay || !result.snapshotAfterPlay) {
        return { passed: false, expected: `life loss >= ${minAmount}`, actual: 'no snapshots (card never played?)' };
      }
      const lost = result.snapshotBeforePlay.p1Life - result.snapshotAfterPlay.p1Life;
      return { passed: lost >= minAmount, expected: `lost >= ${minAmount}`, actual: `lost ${lost} (${result.snapshotBeforePlay.p1Life} → ${result.snapshotAfterPlay.p1Life})` };
    },
  };
}

/** Assert we gained life compared to before */
export function assertGainedLife(minAmount = 1): CardAssertion {
  return {
    name: `gained ${minAmount}+ life after card played`,
    check: (result) => {
      if (!result.snapshotBeforePlay || !result.snapshotAfterPlay) {
        return { passed: false, expected: `gain >= ${minAmount}`, actual: 'no snapshots' };
      }
      const gained = result.snapshotAfterPlay.p0Life - result.snapshotBeforePlay.p0Life;
      return { passed: gained >= minAmount, expected: `gained >= ${minAmount}`, actual: `gained ${gained} (${result.snapshotBeforePlay.p0Life} → ${result.snapshotAfterPlay.p0Life})` };
    },
  };
}

/** Assert opponent has fewer creatures after card was played (destroy/exile/bounce worked) */
export function assertOpponentLostCreatures(minAmount = 1): CardAssertion {
  return {
    name: `opponent lost ${minAmount}+ creature(s) after card played`,
    check: (result) => {
      if (!result.snapshotBeforePlay || !result.snapshotAfterPlay) {
        return { passed: false, expected: `lost >= ${minAmount}`, actual: 'no snapshots' };
      }
      const lost = result.snapshotBeforePlay.p1Creatures - result.snapshotAfterPlay.p1Creatures;
      return { passed: lost >= minAmount, expected: `lost >= ${minAmount} creatures`, actual: `lost ${lost} (${result.snapshotBeforePlay.p1Creatures} → ${result.snapshotAfterPlay.p1Creatures})` };
    },
  };
}

/** Assert our creature count increased (token creation, etc) */
export function assertCreatureCountIncreased(minIncrease = 1): CardAssertion {
  return {
    name: `our creature count increased by ${minIncrease}+`,
    check: (result) => {
      if (!result.snapshotBeforePlay || !result.snapshotAfterPlay) {
        return { passed: false, expected: `increase >= ${minIncrease}`, actual: 'no snapshots' };
      }
      // The card itself is a creature, so subtract 1 if it's a creature
      const increase = result.snapshotAfterPlay.p0Creatures - result.snapshotBeforePlay.p0Creatures;
      return { passed: increase >= minIncrease, expected: `+${minIncrease} creatures`, actual: `+${increase} (${result.snapshotBeforePlay.p0Creatures} → ${result.snapshotAfterPlay.p0Creatures})` };
    },
  };
}

/** Assert we have tokens on battlefield */
export function assertHasTokens(minCount = 1): CardAssertion {
  return {
    name: `at least ${minCount} token(s) on battlefield`,
    check: (_, gs) => {
      const tokens = gs.players[0].zones.battlefield.cards.filter((c: any) => c._isToken);
      return { passed: tokens.length >= minCount, expected: `${minCount}+ tokens`, actual: `${tokens.length} tokens: [${tokens.map((t: any) => t.name).join(', ')}]` };
    },
  };
}

/** Assert our total +1/+1 counters increased */
export function assertCountersIncreased(minIncrease = 1): CardAssertion {
  return {
    name: `+1/+1 counters increased by ${minIncrease}+`,
    check: (result) => {
      if (!result.snapshotBeforePlay || !result.snapshotAfterPlay) {
        return { passed: false, expected: `+${minIncrease} counters`, actual: 'no snapshots' };
      }
      const increase = result.snapshotAfterPlay.p0CountersTotal - result.snapshotBeforePlay.p0CountersTotal;
      return { passed: increase >= minIncrease, expected: `+${minIncrease} counters`, actual: `+${increase} (${result.snapshotBeforePlay.p0CountersTotal} → ${result.snapshotAfterPlay.p0CountersTotal})` };
    },
  };
}

/** Assert opponent's exile zone grew (exile effect worked) */
export function assertOpponentExileGrew(minIncrease = 1): CardAssertion {
  return {
    name: `opponent exile grew by ${minIncrease}+`,
    check: (result) => {
      if (!result.snapshotBeforePlay || !result.snapshotAfterPlay) {
        return { passed: false, expected: `exile +${minIncrease}`, actual: 'no snapshots' };
      }
      const increase = result.snapshotAfterPlay.p1ExileSize - result.snapshotBeforePlay.p1ExileSize;
      return { passed: increase >= minIncrease, expected: `exile +${minIncrease}`, actual: `exile +${increase} (${result.snapshotBeforePlay.p1ExileSize} → ${result.snapshotAfterPlay.p1ExileSize})` };
    },
  };
}

/** Assert opponent's graveyard grew (destroy effect worked) */
export function assertOpponentGraveyardGrew(minIncrease = 1): CardAssertion {
  return {
    name: `opponent graveyard grew by ${minIncrease}+`,
    check: (result) => {
      if (!result.snapshotBeforePlay || !result.snapshotAfterPlay) {
        return { passed: false, expected: `gy +${minIncrease}`, actual: 'no snapshots' };
      }
      const increase = result.snapshotAfterPlay.p1GraveyardSize - result.snapshotBeforePlay.p1GraveyardSize;
      return { passed: increase >= minIncrease, expected: `gy +${minIncrease}`, actual: `gy +${increase} (${result.snapshotBeforePlay.p1GraveyardSize} → ${result.snapshotAfterPlay.p1GraveyardSize})` };
    },
  };
}

/** Assert a specific creature on our BF has power >= expected */
export function assertCreaturePower(cardName: string, minPower: number): CardAssertion {
  return {
    name: `"${cardName}" has power >= ${minPower}`,
    check: (_, gs) => {
      const card = gs.players[0].zones.battlefield.cards.find((c: any) => c.name.toLowerCase() === cardName.toLowerCase());
      if (!card) return { passed: false, expected: `power >= ${minPower}`, actual: 'card not on battlefield' };
      const basePower = parseInt(card.power) || 0;
      const totalPower = basePower + (card._powerMod || 0) + (card._tempPowerMod || 0) + (card._counters?.['+1/+1'] || 0) - (card._counters?.['-1/-1'] || 0);
      return { passed: totalPower >= minPower, expected: `power >= ${minPower}`, actual: `power = ${totalPower} (base ${basePower} + mods)` };
    },
  };
}

/** Assert the card itself is on the battlefield */
export function assertCardOnBattlefield(cardName: string): CardAssertion {
  return {
    name: `"${cardName}" is on battlefield`,
    check: (_, gs) => {
      const found = gs.players[0].zones.battlefield.cards.some((c: any) => c.name.toLowerCase() === cardName.toLowerCase());
      return { passed: found, expected: 'on battlefield', actual: found ? 'found' : 'NOT on battlefield' };
    },
  };
}

/** Assert our hand size increased (draw effect worked) */
export function assertHandSizeIncreased(minIncrease = 1): CardAssertion {
  return {
    name: `hand size increased by ${minIncrease}+ after card played`,
    check: (result) => {
      if (!result.snapshotBeforePlay || !result.snapshotAfterPlay) {
        return { passed: false, expected: `hand +${minIncrease}`, actual: 'no snapshots' };
      }
      // Account for the card being played from hand (-1)
      const netChange = result.snapshotAfterPlay.p0Hand - result.snapshotBeforePlay.p0Hand + 1; // +1 because we spent one card
      return { passed: netChange >= minIncrease, expected: `net draw +${minIncrease}`, actual: `net draw +${netChange} (${result.snapshotBeforePlay.p0Hand} → ${result.snapshotAfterPlay.p0Hand}, cast cost 1 card)` };
    },
  };
}
