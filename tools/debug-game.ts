// @ts-nocheck
// Minimal debug: trace life after each turn
globalThis.window = globalThis as any;
globalThis.document = { querySelector: () => null, createElement: () => ({}) } as any;
globalThis.UIGame = undefined;

import { CardEffectsDB } from '../src/engine/card-effects';
import * as GameState from '../src/engine/game-state';

const MANA_COLORS = ['W', 'U', 'B', 'R', 'G'];
const seed = 3;
let rngState = seed;
function rng() { rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff; return rngState / 0x7fffffff; }
function makeCard(card: any, uid: string) {
  return { ...card, _uid: uid, _tapped: false, _attacking: false, _blocking: null,
    _powerMod: 0, _toughnessMod: 0, _counters: {}, _damage: 0, _summoningSick: true, _tempKeywords: [], _triggers: [] };
}
function makeLand(color: string, idx: number) {
  const n: any = { W:'Plains', U:'Island', B:'Swamp', R:'Mountain', G:'Forest' };
  return makeCard({ id:`l${color}${idx}`, oracle_id:`lo${color}`, name: n[color], mana_cost:'', cmc:0,
    type_line:`Basic Land — ${n[color]}`, oracle_text:'', colors:[], color_identity:[color], keywords:[],
    set_code:'TDM', set_name:'', collector_number:`L${idx}`, rarity:'common',
    image_small:'', image_normal:'', image_art_crop:'', layout:'normal' }, `land-${color}-${idx}`);
}
function inferCardType(name: string, entry: any) {
  const triggers = entry.triggered || [];
  const hasETB = entry.etb?.length > 0;
  const hasCast = entry.cast?.length > 0;
  const hasActivated = entry.activated?.length > 0;
  const staticKw = (entry.static || []).filter((s: any) => s.type === 'has_keyword').flatMap((s: any) => s.keywords || []);
  const creatureKw = ['flying','trample','menace','vigilance','haste','reach','first_strike','double_strike','deathtouch','lifelink','defender'];
  const hasCreatureKw = staticKw.some((k: string) => creatureKw.includes(k));
  const hasAttack = triggers.some((t: any) => t.event === 'attacks' || t.event === 'enters_or_attacks');
  const hasDies = triggers.some((t: any) => t.event === 'dies');
  if (entry.saga) return { typeLine: 'Enchantment — Saga', power: undefined, toughness: undefined };
  if (hasETB || hasAttack || hasCreatureKw || hasDies)
    return { typeLine: 'Creature — Human', power: String(1 + (seed + name.length) % 4), toughness: String(1 + (seed + name.length * 2) % 4) };
  if (hasCast && !hasETB && !hasActivated) return { typeLine: seed % 2 ? 'Instant' : 'Sorcery', power: undefined, toughness: undefined };
  if (hasActivated) return { typeLine: 'Creature — Human', power: String(1 + seed % 3), toughness: String(1 + (seed * 2) % 3) };
  return { typeLine: 'Creature — Human', power: String(2 + seed % 3), toughness: String(2 + (seed * 2) % 3) };
}

function buildPool() {
  const pool: any[] = [];
  let idx = 0;
  for (const [name, entry] of Object.entries(CardEffectsDB)) {
    const { typeLine, power, toughness } = inferCardType(name, entry);
    if (typeLine.includes('Basic Land')) continue;
    const color = MANA_COLORS[idx % 5];
    const cmc = typeLine.includes('Creature') ? 1 + (idx % 5) : 1 + (idx % 4);
    const kw = (entry.static || []).filter((s: any) => s.type === 'has_keyword').flatMap((s: any) => s.keywords || []);
    pool.push({ id: `s${idx}`, oracle_id: `so${idx}`, name, mana_cost: cmc <= 1 ? `{${color}}` : `{${cmc-1}}{${color}}`,
      cmc, type_line: typeLine, oracle_text: '', power, toughness, colors: [color], color_identity: [color],
      keywords: kw, set_code: 'TDM', set_name: '', collector_number: String(idx), rarity: 'common',
      image_small: '', image_normal: '', image_art_crop: '', layout: 'normal' });
    idx++;
  }
  return pool;
}
function buildDeck(pool: any[], deckIdx: number) {
  const c1 = MANA_COLORS[Math.floor(rng() * 5)];
  let c2 = MANA_COLORS[Math.floor(rng() * 5)];
  while (c2 === c1) c2 = MANA_COLORS[Math.floor(rng() * 5)];
  const matching = pool.filter(c => c.colors.includes(c1) || c.colors.includes(c2));
  const shuffled = [...matching].sort(() => rng() - 0.5);
  const spells = shuffled.slice(0, Math.min(23, shuffled.length));
  while (spells.length < 23) spells.push(pool[Math.floor(rng() * pool.length)]);
  const lands: any[] = [];
  for (let i = 0; i < 9; i++) lands.push(makeLand(c1, i));
  for (let i = 0; i < 8; i++) lands.push(makeLand(c2, i + 9));
  return [...spells, ...lands].map((c, i) => makeCard(c, `d${deckIdx}-${i}-${c.id}`));
}

console.error = () => {};
const pool = buildPool();
const d1 = buildDeck(pool, 0);
const d2 = buildDeck(pool, 1);
const gs = GameState.create(d1, d2);
gs.players[0].isHuman = false;
gs.players[1].isHuman = false;
GameState.keepHand(gs, 0, []);
GameState.keepHand(gs, 1, []);

// Hook into advancePhase to trace turn changes
let lastTurn = 0;
const origAdvance = GameState.advancePhase;

GameState.startGame(gs);

// Game resolved inside startGame. Trace the log for turn markers + life
const log = gs.log || [];
let currentTurn = 0;
for (const line of log) {
  if (line.startsWith('--- Turn')) {
    currentTurn++;
    const who = line.includes('You') ? 'P0' : 'P1';
    process.stdout.write(`T${currentTurn}(${who}) L:${gs.players[0].life}/${gs.players[1].life} | `);
  }
}
console.log('');
console.log(`\nWinner: P${gs.winner} | Turns: ${gs.turn}`);
console.log(`P0 life: ${gs.players[0].life} | P1 life: ${gs.players[1].life}`);
// Count damage/life logs
const dmgToP0 = log.filter(l => l.includes('damage to you') || l.includes('You lose')).length;
const dmgToP1 = log.filter(l => l.includes('damage to opponent') || l.includes('Opponent loses')).length;
console.log(`Damage events to P0: ${dmgToP0} | to P1: ${dmgToP1}`);
// Safety limits
const safety = log.filter(l => l.includes('Safety') || l.includes('safety') || l.includes('Winner by life'));
console.log(`Safety: ${safety.length > 0 ? safety.join('; ') : 'none'}`);
