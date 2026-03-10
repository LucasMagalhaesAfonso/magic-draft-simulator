// @ts-nocheck
// stress-test-worker.ts — Runs a SINGLE AI vs AI game, outputs JSON result
// Called by stress-test.ts via child process with hard timeout

globalThis.window = globalThis as any;
globalThis.document = { querySelector: () => null, createElement: () => ({}) } as any;
globalThis.UIGame = undefined;

import { CardEffectsDB } from '../src/engine/card-effects';
import * as GameState from '../src/engine/game-state';

const MANA_COLORS = ['W', 'U', 'B', 'R', 'G'];
const MAX_TURNS = 60;
const MAX_PHASE_ADVANCES = 2000;

// Seed from args
const seed = parseInt(process.argv[2] || '0');

// Seeded random (deterministic per game)
let rngState = seed;
function rng() { rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff; return rngState / 0x7fffffff; }

function makeCard(card: any, uid: string) {
  return { ...card, _uid: uid, _tapped: false, _attacking: false, _blocking: null,
    _powerMod: 0, _toughnessMod: 0, _counters: {}, _damage: 0, _summoningSick: true, _tempKeywords: [], _triggers: [] };
}

function makeLand(color: string, idx: number) {
  const n: Record<string,string> = { W:'Plains', U:'Island', B:'Swamp', R:'Mountain', G:'Forest' };
  return makeCard({ id:`l${color}${idx}`, oracle_id:`lo${color}`, name: n[color], mana_cost:'', cmc:0,
    type_line:`Basic Land — ${n[color]}`, oracle_text:'', colors:[], color_identity:[color], keywords:[],
    set_code:'TDM', set_name:'', collector_number:`L${idx}`, rarity:'common',
    image_small:'', image_normal:'', image_art_crop:'', layout:'normal' }, `land-${color}-${idx}`);
}

function makeVanillaCreature(name: string, power: number, toughness: number, cmc: number, color: string, idx: number) {
  const keywords: string[] = [];
  // Give some creatures evasion to ensure damage gets through
  if (idx % 7 === 0) keywords.push('Flying');
  if (idx % 11 === 0) keywords.push('Trample');
  if (idx % 13 === 0) keywords.push('Haste');

  return {
    id: `c${idx}`, oracle_id: `co${idx}`, name,
    mana_cost: cmc <= 1 ? `{${color}}` : `{${cmc-1}}{${color}}`,
    cmc, type_line: 'Creature — Human Warrior', oracle_text: '',
    power: String(power), toughness: String(toughness),
    colors: [color], color_identity: [color],
    keywords, set_code: 'TDM', set_name: '',
    collector_number: String(idx), rarity: 'common',
    image_small: '', image_normal: '', image_art_crop: '', layout: 'normal',
  };
}

function buildDeck(deckIdx: number) {
  const c1 = MANA_COLORS[Math.floor(rng() * 5)];
  let c2 = MANA_COLORS[Math.floor(rng() * 5)];
  while (c2 === c1) c2 = MANA_COLORS[Math.floor(rng() * 5)];

  const spells: any[] = [];
  const colors = [c1, c2];

  // Generate 23 vanilla creatures with varied stats
  for (let i = 0; i < 23; i++) {
    const color = colors[i % 2];
    const cmc = 1 + Math.floor(rng() * 5); // 1-5 CMC
    const power = 1 + Math.floor(rng() * 4); // 1-4 power
    const toughness = 1 + Math.floor(rng() * 4); // 1-4 toughness
    const name = `Warrior_${deckIdx}_${i}`;
    spells.push(makeVanillaCreature(name, power, toughness, cmc, color, deckIdx * 100 + i));
  }

  // 17 lands
  const lands: any[] = [];
  for (let i = 0; i < 9; i++) lands.push(makeLand(c1, deckIdx * 100 + i));
  for (let i = 0; i < 8; i++) lands.push(makeLand(c2, deckIdx * 100 + i + 9));

  // Shuffle deck
  const deck = [...spells, ...lands];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck.map((c, i) => makeCard(c, `d${deckIdx}-${i}-${c.id}`));
}

// Suppress console.error to avoid noise
const origError = console.error;
console.error = () => {};

try {
  const deck1 = buildDeck(0);
  const deck2 = buildDeck(1);

  const gs = GameState.create(deck1, deck2);
  gs.players[0].isHuman = false;
  gs.players[1].isHuman = false;
  GameState.keepHand(gs, 0, []);
  GameState.keepHand(gs, 1, []);
  GameState.startGame(gs);

  let phases = 0;
  let stuckCount = 0;
  let lastKey = '';

  while (!gs.winner && gs.turn <= MAX_TURNS && phases < MAX_PHASE_ADVANCES) {
    if (gs.waitingForInput) {
      gs.waitingForInput = null;
      GameState.reprocessCurrentPhase(gs);
    } else {
      GameState.advancePhase(gs);
    }
    phases++;

    // Detect stuck: same state for too many iterations
    const key = `${gs.turn}-${gs.phase}-${gs.activePlayer}`;
    if (key === lastKey) {
      stuckCount++;
      if (stuckCount > 30) {
        // Force-skip to next phase
        gs.waitingForInput = null;
        GameState.advancePhase(gs);
        stuckCount = 0;
      }
    } else {
      stuckCount = 0;
      lastKey = key;
    }

    if (isNaN(gs.players[0].life) || isNaN(gs.players[1].life)) {
      console.log(JSON.stringify({ ok: false, error: 'NaN life', turns: gs.turn, phases }));
      process.exit(0);
    }
  }

  const ok = gs.winner !== null;
  console.log(JSON.stringify({
    ok,
    winner: gs.winner,
    turns: gs.turn,
    phases,
    error: ok ? null : (gs.turn > MAX_TURNS ? 'max_turns' : 'max_phases')
  }));
} catch (e: any) {
  console.log(JSON.stringify({ ok: false, error: `CRASH: ${e.message}`, turns: 0, phases: 0 }));
}
process.exit(0);
