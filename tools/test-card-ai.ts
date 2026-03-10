// @ts-nocheck
// test-card-ai.ts — Testa automaticamente o comportamento de uma carta quando jogada pela IA
// Usage: npx tsx tools/test-card-ai.ts "Card Name" [--games=20] [--verbose]

globalThis.window = globalThis as any;
globalThis.document = { querySelector: () => null, createElement: () => ({}) } as any;
globalThis.UIGame = undefined;

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CardEffectsDB } from '../src/engine/card-effects';
import * as GameState from '../src/engine/game-state';
import * as Cards from '../src/engine/cards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const CARD_NAME = args.find(a => !a.startsWith('--')) || '';
const NUM_GAMES = parseInt(args.find(a => a.startsWith('--games='))?.split('=')[1] || '20');
const VERBOSE = args.includes('--verbose');
const MAX_PHASES = 1800;
const MAX_TURNS = 60;
const PHASE_TIMEOUT = 30000; // ms per game

if (!CARD_NAME) {
  console.error('Usage: npx tsx tools/test-card-ai.ts "Card Name" [--games=20] [--verbose]');
  process.exit(1);
}

// ── Colors ────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', blue: '\x1b[34m', magenta: '\x1b[35m', white: '\x1b[37m',
};
const ok = (s: string) => `${C.green}✅${C.reset} ${s}`;
const warn = (s: string) => `${C.yellow}⚠️ ${C.reset} ${s}`;
const fail = (s: string) => `${C.red}❌${C.reset} ${s}`;
const info = (s: string) => `${C.cyan}ℹ️ ${C.reset} ${s}`;
const pct = (n: number, d: number) => d === 0 ? 'N/A' : `${Math.round((n / d) * 100)}%`;

// ── Load scryfall data ─────────────────────────────────────────────────────
function loadScryfallCard(name: string): any | null {
  const filePath = path.resolve(__dirname, '../legacy-pure-js/js/data/scryfall-tdm.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  // File has header lines before the JSON — find where JSON starts
  const jsonStart = raw.indexOf('{');
  if (jsonStart === -1) return null;
  const data = JSON.parse(raw.slice(jsonStart));
  const lower = name.toLowerCase();
  return data.cards.find((c: any) => c.name.toLowerCase() === lower) || null;
}

// ── Card helpers ───────────────────────────────────────────────────────────
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
    id: uid, oracle_id: `lo-${color}`, name: names[color], mana_cost: '', cmc: 0,
    type_line: `Basic Land — ${names[color]}`, oracle_text: '', colors: [], color_identity: [color],
    keywords: [], set_code: 'TDM', set_name: '', collector_number: uid, rarity: 'common',
    image_small: '', image_normal: '', image_art_crop: '', layout: 'normal',
  }, uid);
}

function makeVanilla(idx: number, color: string, cmc: number, power: number, toughness: number): any {
  const uid = `vanilla-${idx}`;
  return makeCard({
    id: uid, oracle_id: uid, name: `Warrior_${idx}`, mana_cost: cmc <= 1 ? `{${color}}` : `{${cmc - 1}}{${color}}`,
    cmc, type_line: 'Creature — Human Warrior', oracle_text: '',
    power: String(power), toughness: String(toughness),
    colors: [color], color_identity: [color], keywords: [],
    set_code: 'TDM', set_name: '', collector_number: String(idx), rarity: 'common',
    image_small: '', image_normal: '', image_art_crop: '', layout: 'normal',
  }, uid);
}

function scryfallToEngineCard(sc: any, uid: string): any {
  const isCreature = sc.type_line?.includes('Creature');
  const isLand = sc.type_line?.includes('Land');
  const entry = CardEffectsDB[sc.name.toLowerCase()] || {};
  const kw = (entry.static || [])
    .filter((s: any) => s.type === 'has_keyword')
    .flatMap((s: any) => s.keywords || [])
    .map((k: string) => k.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
  const allKw = [...(sc.keywords || []), ...kw].filter((v, i, a) => a.indexOf(v) === i);
  // scryfall-tdm.json may not have explicit cmc — parse from mana_cost
  const computedCmc = sc.cmc || parseCMC(sc.mana_cost || '');
  return makeCard({
    id: uid, oracle_id: uid, name: sc.name,
    mana_cost: sc.mana_cost || '', cmc: computedCmc,
    type_line: sc.type_line || 'Creature — Human', oracle_text: sc.oracle_text || '',
    power: sc.power || (isCreature ? '2' : undefined),
    toughness: sc.toughness || (isCreature ? '2' : undefined),
    colors: sc.colors || [], color_identity: sc.color_identity || [],
    keywords: allKw, rarity: sc.rarity || 'common',
    set_code: 'TDM', set_name: '', collector_number: sc.set_number || uid,
    image_small: '', image_normal: '', image_art_crop: '',
    layout: sc.card_faces ? 'adventure' : 'normal',
  }, uid);
}

// ── Deck builder ───────────────────────────────────────────────────────────
// AI deck: 3 copies of target card + lands matching its colors + vanilla creatures
function buildAIDeck(targetCard: any, scryfallCard: any): any[] {
  const colors = scryfallCard.colors?.length > 0 ? scryfallCard.colors : ['W'];
  const cmc = scryfallCard.cmc || 3;
  // Land count: enough to cast the card comfortably (cmc + 2, min 15, max 22)
  const landCount = Math.min(22, Math.max(15, cmc + 10));
  const cards: any[] = [];

  // 3 copies of target card
  for (let i = 0; i < 3; i++) {
    cards.push(scryfallToEngineCard(scryfallCard, `target-${i}`));
  }

  // Lands split by color
  const landsPerColor = Math.ceil(landCount / colors.length);
  for (const color of colors) {
    for (let i = 0; i < landsPerColor && cards.filter(c => c.type_line?.includes('Land')).length < landCount; i++) {
      cards.push(makeLand(color, `land-ai-${color}-${i}`));
    }
  }
  // Fill remaining with white if needed
  while (cards.filter(c => c.type_line?.includes('Land')).length < landCount) {
    cards.push(makeLand('W', `land-fill-${cards.length}`));
  }

  // Fill to 40 with vanilla creatures of compatible colors
  let idx = 0;
  while (cards.length < 40) {
    const color = colors[idx % colors.length];
    const c = 1 + (idx % 4) + 1; // cmc 2-5
    const p = 1 + (idx % 3) + 1; // power 2-4
    const t = 1 + (idx % 4) + 1; // toughness 2-5
    cards.push(makeVanilla(idx, color, c, p, t));
    idx++;
  }

  // Shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  // Put target cards near top so they appear in opening hand
  const nonTargets = cards.filter(c => !c.id?.startsWith('target-'));
  const targets = cards.filter(c => c.id?.startsWith('target-'));
  return [...targets, ...nonTargets];
}

// Opponent: pure vanilla creatures + lands (gives AI real targets)
function buildOpponentDeck(): any[] {
  const cards: any[] = [];
  const colors = ['R', 'G'];
  for (let i = 0; i < 18; i++) cards.push(makeLand(colors[i % 2], `land-opp-${i}`));
  for (let i = 0; i < 22; i++) {
    const c = 1 + (i % 4) + 1;
    const p = 1 + (i % 3) + 1;
    const t = 2 + (i % 3);
    cards.push(makeVanilla(100 + i, colors[i % 2], c, p, t));
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// ── Effect analysis ────────────────────────────────────────────────────────
// Based on CardEffectsDB entry, figure out what observable events to track
interface ExpectedEffect {
  type: string;
  description: string;
  logPatterns: string[]; // log substrings to match
  stateCheck?: (before: any, after: any) => boolean;
}

function getExpectedEffects(entry: any, cardName: string): ExpectedEffect[] {
  const effects: ExpectedEffect[] = [];
  const name = cardName.toLowerCase();
  const allEffects = [
    ...(entry.cast || []),
    ...(entry.etb || []),
    ...(entry.triggered || []).flatMap((t: any) => t.effects || []),
    ...(entry.activated || []).flatMap((a: any) => a.effects || []),
  ];

  for (const eff of allEffects) {
    switch (eff.type) {
      case 'damage':
        effects.push({ type: 'damage', description: `Cause dano (${eff.amount || '?'})`,
          logPatterns: ['dano', 'damage', 'sofre'],
          stateCheck: (b, a) => a.oppLife < b.oppLife || a.oppCreatures < b.oppCreatures });
        break;
      case 'destroy':
        effects.push({ type: 'destroy', description: 'Destruir criatura/permanent',
          logPatterns: ['destrói', 'destroy', 'é destruída', 'goes to graveyard'],
          stateCheck: (b, a) => a.oppCreatures < b.oppCreatures });
        break;
      case 'exile':
        effects.push({ type: 'exile', description: 'Exilar permanente',
          logPatterns: ['exila', 'exile', 'é exilada'],
          stateCheck: (b, a) => a.oppCreatures < b.oppCreatures || a.oppExile > b.oppExile });
        break;
      case 'draw':
        effects.push({ type: 'draw', description: `Comprar carta(s) (${eff.amount || 1})`,
          logPatterns: ['compra', 'draws', 'draw'],
          stateCheck: (b, a) => a.aiHand > b.aiHand });
        break;
      case 'gainLife':
        effects.push({ type: 'gainLife', description: 'Ganhar vida',
          logPatterns: ['ganha', 'gains life', 'vida'],
          stateCheck: (b, a) => a.aiLife > b.aiLife });
        break;
      case 'drain':
        effects.push({ type: 'drain', description: 'Drenar vida',
          logPatterns: ['drena', 'drain', 'vida'],
          stateCheck: (b, a) => a.aiLife > b.aiLife || a.oppLife < b.oppLife });
        break;
      case 'create_token':
        effects.push({ type: 'create_token', description: 'Criar token',
          logPatterns: ['token', 'cria', 'creates'],
          stateCheck: (b, a) => a.aiCreatures > b.aiCreatures });
        break;
      case 'counter_self':
      case 'grant_counter':
      case 'grant_counters':
        effects.push({ type: 'counter', description: 'Adicionar contador +1/+1',
          logPatterns: ['contador', 'counter', '+1/+1'],
          stateCheck: (b, a) => a.aiCounters > b.aiCounters });
        break;
      case 'buff':
      case 'buff_self':
      case 'buff_all':
        effects.push({ type: 'buff', description: 'Buff de poder/resistência',
          logPatterns: ['+', '/'],
          stateCheck: null });
        break;
      case 'bounce':
        effects.push({ type: 'bounce', description: 'Devolver ao dono',
          logPatterns: ['retorna', 'bounce', 'mão'],
          stateCheck: (b, a) => a.oppCreatures < b.oppCreatures });
        break;
      case 'scry':
        effects.push({ type: 'scry', description: `Scry ${eff.amount || 1}`,
          logPatterns: ['scry', 'vê', 'topo'],
          stateCheck: null });
        break;
      case 'surveil':
        effects.push({ type: 'surveil', description: `Surveil ${eff.amount || 1}`,
          logPatterns: ['surveil', 'cemitério'],
          stateCheck: null });
        break;
      case 'mill':
        effects.push({ type: 'mill', description: 'Moer cards',
          logPatterns: ['cemitério', 'mill', 'moagem'],
          stateCheck: null });
        break;
      case 'ramp':
        effects.push({ type: 'ramp', description: 'Buscar/colocar terreno',
          logPatterns: ['terreno', 'land', 'ramp'],
          stateCheck: (b, a) => a.aiLands > b.aiLands });
        break;
      case 'fight':
        effects.push({ type: 'fight', description: 'Lutar com criatura',
          logPatterns: ['luta', 'fight', 'combate'],
          stateCheck: (b, a) => a.oppCreatures < b.oppCreatures });
        break;
      case 'counter_spell':
        effects.push({ type: 'counter_spell', description: 'Contrafeitiço',
          logPatterns: ['contrafeitiço', 'counter', 'cancelad'],
          stateCheck: null });
        break;
    }
  }

  // Dedup by type
  return effects.filter((e, i, arr) => arr.findIndex(x => x.type === e.type) === i);
}

function getTriggerEvents(entry: any): string[] {
  return (entry.triggered || []).map((t: any) => t.event || t.condition || '?');
}

// ── State snapshot ─────────────────────────────────────────────────────────
// AI is player 0 (aiDeck passed first to GameState.create)
// Opp is player 1 (oppDeck passed second)
function snapshot(gs: any): any {
  const ai = gs.players[0];
  const opp = gs.players[1];
  const aiBf = ai.zones.battlefield.cards;
  const oppBf = opp.zones.battlefield.cards;
  return {
    aiLife: ai.life,
    oppLife: opp.life,
    aiHand: ai.zones.hand.count(),
    oppHand: opp.zones.hand.count(),
    aiCreatures: aiBf.filter((c: any) => Cards.isCreature(c)).length,
    oppCreatures: oppBf.filter((c: any) => Cards.isCreature(c)).length,
    aiLands: aiBf.filter((c: any) => Cards.isLand(c)).length,
    oppExile: ai.zones.exile?.getAll?.()?.length || 0,
    aiCounters: aiBf.filter((c: any) => Cards.isCreature(c))
      .reduce((s: number, c: any) => s + (c._counters?.['+1/+1'] || 0), 0),
    turn: gs.turn,
    phase: gs.phase,
  };
}

// ── Parse CMC from mana_cost string ───────────────────────────────────────
function parseCMC(manaCost: string): number {
  if (!manaCost) return 0;
  let cmc = 0;
  // Generic: {N}
  const generic = manaCost.match(/\{(\d+)\}/g);
  if (generic) generic.forEach(m => { cmc += parseInt(m.replace(/[{}]/g, '')); });
  // Colored symbols: {W}, {U}, {B}, {R}, {G}, {C}
  const colored = manaCost.match(/\{[WUBRGCXS]\}/g);
  if (colored) cmc += colored.length;
  // Hybrid: {W/U} counts as 1
  const hybrid = manaCost.match(/\{[A-Z]\/[A-Z]\}/g);
  if (hybrid) cmc += hybrid.length;
  // Phyrexian: {W/P} counts as 1
  const phyrexian = manaCost.match(/\{[A-Z]\/P\}/g);
  if (phyrexian) cmc += phyrexian.length;
  return cmc;
}

// ── Game result types ──────────────────────────────────────────────────────
interface GameResult {
  gameNum: number;
  winner: number | null;
  turns: number;
  error: string | null;
  cardPlayed: boolean;
  playTurn: number | null;
  logLines: string[];       // All log lines mentioning the card
  triggersFired: string[];  // Trigger events observed in logs
  effectsObserved: Record<string, boolean>; // which effects fired
  stateBeforePlay: any;
  stateAfterPlay: any;
}

// ── Single game runner ─────────────────────────────────────────────────────
function runGame(
  gameNum: number,
  targetCardName: string,
  scryfallCard: any,
  entry: any,
  expectedEffects: ExpectedEffect[],
  triggerEvents: string[],
): GameResult {
  const result: GameResult = {
    gameNum, winner: null, turns: 0, error: null,
    cardPlayed: false, playTurn: null,
    logLines: [], triggersFired: [],
    effectsObserved: {},
    stateBeforePlay: null, stateAfterPlay: null,
  };

  try {
    const aiDeck = buildAIDeck(entry, scryfallCard);
    const oppDeck = buildOpponentDeck();

    const gs = GameState.create(aiDeck, oppDeck);
    gs.players[0].isHuman = false;
    gs.players[1].isHuman = false;
    GameState.keepHand(gs, 0, []);
    GameState.keepHand(gs, 1, []);
    GameState.startGame(gs);

    let phases = 0;
    let stuckCount = 0;
    let lastKey = '';
    let prevLogLen = gs.log.length;
    let cardPlayedThisTurn = false;
    let stateAtPlay: any = null;
    const nameLC = targetCardName.toLowerCase();

    const startTime = Date.now();

    while (!gs.winner && gs.turn <= MAX_TURNS && phases < MAX_PHASES) {
      if (Date.now() - startTime > PHASE_TIMEOUT) {
        result.error = 'TIMEOUT';
        break;
      }

      if (gs.waitingForInput) {
        gs.waitingForInput = null;
        GameState.reprocessCurrentPhase(gs);
      } else {
        GameState.advancePhase(gs);
      }
      phases++;

      // Stuck detection
      const key = `${gs.turn}-${gs.phase}-${gs.activePlayer}`;
      if (key === lastKey) {
        stuckCount++;
        if (stuckCount > 35) {
          gs.waitingForInput = null;
          try { GameState.advancePhase(gs); } catch { /* ignore */ }
          stuckCount = 0;
        }
      } else { stuckCount = 0; lastKey = key; }

      // NaN life check
      if (isNaN(gs.players[0].life) || isNaN(gs.players[1].life)) {
        result.error = 'NaN life'; break;
      }

      // Scan new log entries for card mentions
      const newLogs = gs.log.slice(prevLogLen);
      prevLogLen = gs.log.length;

      for (const line of newLogs) {
        const lineLC = line.toLowerCase();
        if (lineLC.includes(nameLC)) {
          result.logLines.push(line);

          // Detect card play — match any "cast/play" verb or ETB entry
          if (!result.cardPlayed && (
            lineLC.includes('joga') || lineLC.includes('usa') || lineLC.includes('conjura') ||
            lineLC.includes('casts') || lineLC.includes('plays') || lineLC.includes(' play ') ||
            lineLC.includes('cast') || lineLC.includes('entra no campo') ||
            lineLC.includes('enters the battlefield') || lineLC.includes('etb') ||
            lineLC.includes('dispara') || lineLC.includes('trigger')
          )) {
            result.cardPlayed = true;
            result.playTurn = gs.turn;
            result.stateBeforePlay = snapshot(gs);
            stateAtPlay = snapshot(gs);
          }

          // Detect trigger fires
          for (const ev of triggerEvents) {
            if (lineLC.includes('trigger') || lineLC.includes('dispara') || lineLC.includes('whenever') ||
                lineLC.includes('ataca') || lineLC.includes('entra') || lineLC.includes('morre')) {
              if (!result.triggersFired.includes(ev)) result.triggersFired.push(ev);
            }
          }

          // Detect effects from log patterns
          for (const eff of expectedEffects) {
            if (eff.logPatterns.some(p => lineLC.includes(p.toLowerCase()))) {
              result.effectsObserved[eff.type] = true;
            }
          }
        }
      }
    }

    result.turns = gs.turn;
    result.winner = gs.winner;

    // State after play: capture final state if card was played
    if (result.cardPlayed) {
      result.stateAfterPlay = snapshot(gs);

      // State-based effect detection
      for (const eff of expectedEffects) {
        if (!result.effectsObserved[eff.type] && eff.stateCheck && result.stateBeforePlay) {
          // Check the state 1-2 turns after play
          if (eff.stateCheck(result.stateBeforePlay, result.stateAfterPlay)) {
            result.effectsObserved[eff.type] = true;
          }
        }
      }
    }

  } catch (e: any) {
    result.error = `CRASH: ${e.message?.slice(0, 80)}`;
  }

  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────
console.log = () => {};
console.warn = () => {};
console.error = () => {};
const print = console.log.bind(console.__proto__);

// Restore print
const origLog = (...args: any[]) => process.stdout.write(args.join(' ') + '\n');

function main() {
  origLog(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  origLog(`${C.bold}${C.cyan}║  AI Card Behavior Tester                                 ║${C.reset}`);
  origLog(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}\n`);

  // Find card in scryfall data
  const scCard = loadScryfallCard(CARD_NAME);
  if (!scCard) {
    origLog(fail(`Card "${CARD_NAME}" not found in scryfall-tdm.json`));
    origLog(info('Check spelling — names are case-insensitive'));
    process.exit(1);
  }

  // Find in CardEffectsDB
  const entry = CardEffectsDB[CARD_NAME.toLowerCase()];
  if (!entry) {
    origLog(warn(`"${CARD_NAME}" not in CardEffectsDB — effects may not work`));
    origLog(info('Static audit: node tools/audit-new-project.cjs "' + CARD_NAME + '"'));
  }

  const dbEntry = entry || {};
  const expectedEffects = getExpectedEffects(dbEntry, CARD_NAME);
  const triggerEvents = getTriggerEvents(dbEntry);

  const cardCMC = scCard.cmc || parseCMC(scCard.mana_cost || '');
  origLog(`${C.bold}Card:${C.reset}    ${C.yellow}${scCard.name}${C.reset}`);
  origLog(`${C.bold}Type:${C.reset}    ${scCard.type_line}`);
  origLog(`${C.bold}Cost:${C.reset}    ${scCard.mana_cost || '—'} (CMC ${cardCMC})`);
  origLog(`${C.bold}In DB:${C.reset}   ${entry ? C.green + 'Yes' : C.red + 'No'}${C.reset}`);
  origLog(`${C.bold}Effects:${C.reset} ${expectedEffects.map(e => e.description).join(', ') || 'none detected'}`);
  if (triggerEvents.length > 0) {
    origLog(`${C.bold}Triggers:${C.reset} ${triggerEvents.join(', ')}`);
  }
  origLog('');
  origLog(`Running ${NUM_GAMES} games...\n`);

  // Run games
  const results: GameResult[] = [];
  for (let i = 0; i < NUM_GAMES; i++) {
    const r = runGame(i, CARD_NAME, scCard, dbEntry, expectedEffects, triggerEvents);
    results.push(r);

    // Progress bar
    const pctDone = Math.round(((i + 1) / NUM_GAMES) * 30);
    const bar = '█'.repeat(pctDone) + '░'.repeat(30 - pctDone);
    const statusIcon = r.error ? C.red + '✗' : r.winner !== null ? C.green + '✓' : C.yellow + '?';
    process.stdout.write(`\r  ${bar} ${i + 1}/${NUM_GAMES} [${statusIcon}${C.reset}]`);
  }
  process.stdout.write('\n\n');

  // ── Aggregate ──────────────────────────────────────────────────────────
  const total = results.length;
  const crashes = results.filter(r => r.error?.startsWith('CRASH')).length;
  const timeouts = results.filter(r => r.error === 'TIMEOUT').length;
  const nanLife = results.filter(r => r.error === 'NaN life').length;
  const completed = results.filter(r => !r.error).length;
  const withWinner = results.filter(r => r.winner !== null).length;
  const aiWins = results.filter(r => r.winner === 0).length; // AI is player 0
  const played = results.filter(r => r.cardPlayed).length;
  const aiWinsWithCard = results.filter(r => r.cardPlayed && r.winner === 0).length;
  const avgTurn = played > 0
    ? (results.filter(r => r.cardPlayed).reduce((s, r) => s + (r.playTurn || 0), 0) / played).toFixed(1)
    : 'N/A';
  const avgGameTurns = completed > 0
    ? (results.filter(r => !r.error).reduce((s, r) => s + r.turns, 0) / completed).toFixed(1)
    : 'N/A';

  // ── Report ─────────────────────────────────────────────────────────────
  origLog(`${C.bold}━━━━ RESULTADO (${NUM_GAMES} partidas) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);

  // Stability
  origLog(`${C.bold}Estabilidade:${C.reset}`);
  origLog(`  ${crashes === 0 ? ok('Sem crashes') : fail(`${crashes} crashes`)}  ${C.dim}(${crashes}/${total})${C.reset}`);
  origLog(`  ${timeouts === 0 ? ok('Sem timeouts') : warn(`${timeouts} timeouts`)}  ${C.dim}(${timeouts}/${total})${C.reset}`);
  origLog(`  ${nanLife === 0 ? ok('Sem NaN life') : fail(`${nanLife} NaN life`)}  ${C.dim}(${nanLife}/${total})${C.reset}`);
  origLog(`  ${withWinner === total ? ok('Todas terminaram') : warn(`${total - withWinner} sem vencedor`)}  ${C.dim}(${withWinner}/${total})${C.reset}`);
  origLog('');

  // Card play behavior
  const playRate = played / total;
  origLog(`${C.bold}Comportamento da IA:${C.reset}`);
  const playLine = playRate >= 0.7 ? ok : playRate >= 0.4 ? warn : fail;
  origLog(`  ${playLine(`IA jogou a carta: ${played}/${total} partidas (${pct(played, total)})`)} ${C.dim}[esperado: ≥70%]${C.reset}`);
  origLog(`  ${info(`Turno médio em que jogou: ${avgTurn}  ${C.dim}(esperado: CMC+1 ≈ ${cardCMC + 1})${C.reset}`)}`);
  origLog(`  ${info(`Duração média das partidas: ${avgGameTurns} turnos`)}`);

  if (played > 0) {
    const winWithCard = aiWinsWithCard / played;
    const winOverall = aiWins / Math.max(withWinner, 1);
    const cardHelps = winWithCard >= winOverall - 0.1;
    const winMsg = `IA ganha quando joga a carta: ${pct(aiWinsWithCard, played)} ${C.dim}(win rate geral: ${pct(aiWins, withWinner)})${C.reset}`;
    origLog(`  ${cardHelps ? ok(winMsg) : warn(winMsg)}`);
  }
  origLog('');

  // Effects
  if (expectedEffects.length > 0) {
    origLog(`${C.bold}Efeitos observados:${C.reset}`);
    for (const eff of expectedEffects) {
      const count = results.filter(r => r.effectsObserved[eff.type]).length;
      const rate = count / Math.max(played, 1);
      const effLine = rate >= 0.5 ? ok : rate >= 0.2 ? warn : fail;
      origLog(`  ${effLine(`${eff.description}: ${count}/${played} partidas (${pct(count, played)})`)} ${C.dim}[quando jogada]${C.reset}`);
    }
    origLog('');
  }

  // Triggers
  if (triggerEvents.length > 0) {
    origLog(`${C.bold}Triggers:${C.reset}`);
    for (const ev of triggerEvents) {
      const count = results.filter(r => r.triggersFired.includes(ev)).length;
      const rate = count / Math.max(played, 1);
      const tLine = rate >= 0.3 ? ok : rate >= 0.1 ? warn : fail;
      origLog(`  ${tLine(`Evento "${ev}": ${count}/${played} partidas detectadas`)} ${C.dim}[quando jogada]${C.reset}`);
    }
    origLog('');
  }

  // Sample logs
  if (VERBOSE && played > 0) {
    origLog(`${C.bold}Sample de logs (primeiras 3 partidas com a carta):${C.reset}`);
    let shown = 0;
    for (const r of results) {
      if (!r.cardPlayed || shown >= 3) continue;
      origLog(`\n  ${C.dim}Partida ${r.gameNum + 1} (turno ${r.playTurn}, vencedor: ${r.winner ?? 'nenhum'}):${C.reset}`);
      for (const line of r.logLines.slice(0, 6)) {
        origLog(`    ${C.dim}→${C.reset} ${line}`);
      }
      shown++;
    }
    origLog('');
  }

  // Issues to review
  const issues: string[] = [];
  if (crashes > 0) issues.push(`${crashes} crashes — verificar stack.ts e game-state.ts`);
  if (timeouts > 0) issues.push(`${timeouts} timeouts — possível loop infinito`);
  if (played / total < 0.5) issues.push(`IA joga pouco (${pct(played, total)}) — verificar scoring em playMainPhase`);
  if (played > 0) {
    const avgTurnNum = parseFloat(avgTurn);
    if (!isNaN(avgTurnNum) && avgTurnNum > cardCMC + 4) {
      issues.push(`IA joga tarde (turno médio ${avgTurn}) — possível problema de mana ou scoring`);
    }
  }
  for (const eff of expectedEffects) {
    const count = results.filter(r => r.effectsObserved[eff.type]).length;
    if (played > 0 && count / played < 0.15) {
      issues.push(`Efeito "${eff.type}" quase nunca detectado — verificar stack case ou log pattern`);
    }
  }

  if (issues.length > 0) {
    origLog(`${C.bold}${C.yellow}⚠️  Para revisar:${C.reset}`);
    for (const issue of issues) origLog(`  ${C.yellow}→${C.reset} ${issue}`);
    origLog('');
  } else {
    origLog(`${C.green}${C.bold}✅ Nenhum problema óbvio detectado!${C.reset}`);
    origLog(info('Use --verbose para ver logs de partidas individuais'));
    origLog('');
  }

  origLog(`${C.dim}Dica: node tools/audit-new-project.cjs "${CARD_NAME}" para análise estática detalhada${C.reset}\n`);
}

main();
