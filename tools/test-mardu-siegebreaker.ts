// @ts-nocheck
// Test: Mardu Siegebreaker — attacks trigger creates token copy of exiled creature
// Usage: npx tsx tools/test-mardu-siegebreaker.ts

globalThis.window = globalThis as any;
globalThis.document = { querySelector: () => null, createElement: () => ({}) } as any;

import * as GameState from '../src/engine/game-state';
import * as CardEngine from '../src/engine/cards';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeLand(color: string, idx: number) {
  const names: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  return {
    id: `l${color}${idx}`, oracle_id: `lo${color}`, name: names[color], mana_cost: '', cmc: 0,
    type_line: `Basic Land — ${names[color]}`, oracle_text: '', colors: [], color_identity: [color],
    keywords: [], set_code: 'TDM', set_name: '', collector_number: `L${idx}`, rarity: 'common',
    image_small: '', image_normal: '', image_art_crop: '', layout: 'normal',
    _uid: `land-${color}-${idx}`, _tapped: false, _attacking: false, _blocking: null,
    _powerMod: 0, _toughnessMod: 0, _counters: { '+1/+1': 0, '-1/-1': 0 }, _damage: 0,
    _summoningSick: false, _tempKeywords: [], _tempPowerMod: 0, _tempToughnessMod: 0,
  };
}

function makeCreature(name: string, power: number, toughness: number, uid: string) {
  return {
    id: uid, oracle_id: uid, name, mana_cost: '{2}{W}', cmc: 3,
    type_line: 'Creature — Human Warrior', oracle_text: '',
    power: String(power), toughness: String(toughness),
    colors: ['W'], color_identity: ['W'], keywords: [],
    set_code: 'TDM', set_name: '', collector_number: '99', rarity: 'common',
    image_small: '', image_normal: '', image_art_crop: '', layout: 'normal',
    _uid: uid, _tapped: false, _attacking: false, _blocking: null,
    _powerMod: 0, _toughnessMod: 0, _counters: { '+1/+1': 0, '-1/-1': 0 }, _damage: 0,
    _summoningSick: false, _tempKeywords: [], _tempPowerMod: 0, _tempToughnessMod: 0,
  };
}

function makeSiegebreaker(uid: string) {
  return {
    id: uid, oracle_id: 'mardu-sb', name: 'Mardu Siegebreaker',
    mana_cost: '{1}{R}{W}{B}', cmc: 4,
    type_line: 'Creature — Human Warrior',
    oracle_text: 'Deathtouch, haste\nWhen this creature enters, exile up to one other target creature you control until this creature leaves the battlefield.\nWhenever this creature attacks, create a tapped token that\'s a copy of the exiled card attacking that opponent. At the beginning of your next end step, sacrifice those tokens.',
    power: '4', toughness: '4', colors: ['R', 'W', 'B'], color_identity: ['R', 'W', 'B'],
    keywords: ['Haste', 'Deathtouch'], set_code: 'TDM', set_name: '',
    collector_number: '206', rarity: 'rare', image_small: '', image_normal: '', image_art_crop: '', layout: 'normal',
    _uid: uid, _tapped: false, _attacking: false, _blocking: null,
    _powerMod: 0, _toughnessMod: 0, _counters: { '+1/+1': 0, '-1/-1': 0 }, _damage: 0,
    _summoningSick: false, _tempKeywords: [], _tempPowerMod: 0, _tempToughnessMod: 0,
  };
}

function buildDeck() {
  const cards: any[] = [];
  for (let i = 0; i < 17; i++) cards.push(makeLand('W', i));
  for (let i = 0; i < 23; i++) cards.push({
    ...makeCreature(`Warrior${i}`, 2, 2, `warrior-${i}`),
    mana_cost: '{2}{W}', cmc: 3,
  });
  return cards;
}

// ── Test setup ────────────────────────────────────────────────────────────

const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: string) {
  if (condition) {
    origLog(`  ✅ ${label}${detail ? ' — ' + detail : ''}`);
    passed++;
  } else {
    origLog(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

origLog('=== Test: Mardu Siegebreaker ===\n');

try {
  // Create game state (both AI to avoid mulligan pause)
  const deck = buildDeck();
  const gs = GameState.create(deck, [...deck]);
  gs.players[0].isHuman = false;
  gs.players[1].isHuman = false;
  GameState.keepHand(gs, 0, []);
  GameState.keepHand(gs, 1, []);

  // ── SCENARIO: Siegebreaker with exiled creature ──────────────────────
  origLog('[SETUP] Manually placing Siegebreaker + exiled companion on board');

  // Clear any existing battlefield cards (keep it clean)
  gs.players[0].zones.battlefield.cards.length = 0;
  gs.players[0].zones.exile.cards.length = 0;
  gs._triggers = gs._triggers || [];
  // Clear any stale triggers
  gs._triggers = gs._triggers.filter((t: any) => t.cardUid === undefined);

  // Create the companion creature (will be "exiled" by Siegebreaker ETB)
  const companion = makeCreature('Elites of the Mardu', 3, 3, 'companion-uid-001');

  // Create Siegebreaker on battlefield
  const sb = makeSiegebreaker('siegebreaker-uid-001');
  gs.players[0].zones.battlefield.add(sb);
  GameState._registerCardTriggers(gs, sb, 0);

  // Simulate what ETB exile does: put companion in exile + set _exiledUntilLeaves on sb
  gs.players[0].zones.exile.add(companion);
  sb._exiledUntilLeaves = [companion];

  // Also put opponent's creature on battlefield for combat
  const oppCreature = makeCreature('Opp Blocker', 2, 2, 'opp-blocker-001');
  gs.players[1].zones.battlefield.add(oppCreature);

  // Set up combat state (Siegebreaker is attacking)
  gs.combat = { phase: 'declare_attackers', attackers: [{ uid: sb._uid, card: sb }], blockers: {} };
  gs.phase = 'combat_attackers';

  const bfBefore = gs.players[0].zones.battlefield.cards.length;
  origLog(`[TEST] BF before attack trigger: ${gs.players[0].zones.battlefield.cards.map((c: any) => c.name).join(', ')}`);

  // ── TEST: Fire attacks trigger ──────────────────────────────────────
  origLog('\n[TEST 1] Firing attacks trigger for Siegebreaker');
  console.log = () => {};
  const triggerLogs = GameState.fireTrigger(gs, 'attacks', {
    cardUid: sb._uid,
    card: sb,
    controllerId: 0,
    attackingCreatureCount: 1,
  });
  console.log = origLog;

  const bfAfter = gs.players[0].zones.battlefield.cards.length;
  const tokens = gs.players[0].zones.battlefield.cards.filter((c: any) => c._isToken);

  ok('Token was created on battlefield', tokens.length > 0, `BF: ${bfBefore} → ${bfAfter}`);

  if (tokens.length > 0) {
    const token = tokens[0];
    ok('Token is a copy of companion (Elites of the Mardu)', token.name === companion.name, `got: ${token.name}`);
    ok('Token has correct power/toughness', token.power === companion.power && token.toughness === companion.toughness,
      `${token.power}/${token.toughness}`);
    ok('Token is tapped', !!token._tapped);
    ok('Token is marked attacking', !!token._attacking);
    ok('Token has sacrificeAtEndStep', !!token._sacrificeAtEndStep);
    ok('Token is in combat.attackers', gs.combat.attackers.some((a: any) => a.uid === token._uid));
    origLog(`  Trigger logs: ${triggerLogs.slice(0, 3).join(' | ')}`);
  } else {
    origLog(`  Trigger logs: ${JSON.stringify(triggerLogs)}`);
    origLog(`  _exiledUntilLeaves: ${JSON.stringify(sb._exiledUntilLeaves?.map((c: any) => c.name))}`);
    origLog(`  _permanentExiles: ${JSON.stringify(gs._permanentExiles?.[sb._uid])}`);
    origLog(`  Triggers registered: ${JSON.stringify(gs._triggers?.map((t: any) => ({ event: t.event, cardUid: t.cardUid, self: t.self })))}`);
  }

  // ── TEST 2: Verify exiled creature is still in exile (not consumed) ──
  origLog('\n[TEST 2] Exiled creature stays in exile after token creation');
  const stillExiled = gs.players[0].zones.exile.has(companion._uid);
  ok('Companion still in exile (not returned yet)', stillExiled);

  // ── SUMMARY ──
  origLog(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);

} catch (e: any) {
  origLog(`\n❌ CRASH: ${e.message}`);
  origLog(e.stack?.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}
