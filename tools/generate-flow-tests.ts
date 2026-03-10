#!/usr/bin/env tsx
// generate-flow-tests.ts — Reads Scryfall JSON + CardEffectsDB → emits card-flow-fixtures.ts
// Usage: npx tsx tools/generate-flow-tests.ts ltr

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const setCode = (process.argv[2] || 'ltr').toLowerCase();
const jsonPath = path.resolve(__dirname, `../legacy-pure-js/js/data/scryfall-${setCode}.json`);

if (!fs.existsSync(jsonPath)) {
  console.error(`Scryfall JSON not found: ${jsonPath}`);
  process.exit(1);
}

const scryfallData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const cards: any[] = scryfallData.cards;

// Read CardEffectsDB
let CardEffectsDB: Record<string, any>;
try {
  const ceModule = await import('../src/engine/card-effects');
  CardEffectsDB = ceModule.CardEffectsDB;
} catch (e) {
  console.error('Could not load CardEffectsDB:', e);
  process.exit(1);
}

interface OracleAnthem {
  pattern: string;
  power: number;
  toughness: number;
  target: string;
  keywords?: string[];
}

interface OracleTrigger {
  pattern: string;
  event: string;
}

interface CardFlowFixture {
  name: string;
  cardDef: {
    name: string;
    type_line: string;
    oracle_text: string;
    mana_cost: string;
    power?: string;
    toughness?: string;
    keywords: string[];
    colors: string[];
    color_identity: string[];
    rarity: string;
    set: string;
    cmc: number;
  };
  manaCost: string;
  manaPool: Record<string, number>;
  isPermanent: boolean;
  isCreature: boolean;
  isLand: boolean;
  hasETB: boolean;
  etbTypes: string[];
  hasCastEffects: boolean;
  hasAttackTrigger: boolean;
  hasDeathTrigger: boolean;
  keywords: string[];
  needsTarget: boolean;
  interactiveTypes: string[];
  power: number;
  toughness: number;
  oracleAnthems: OracleAnthem[];
  oracleTriggers: OracleTrigger[];
  oracleKeywords: string[];
  hasAnthemInDB: boolean;
  hasTriggeredInDB: boolean;
  dbEntry: any;
}

function parseManaPool(manaCost: string): Record<string, number> {
  const pool: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const symbols = manaCost.match(/\{([^}]+)\}/g) || [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1);
    if (/^\d+$/.test(inner)) {
      pool.C += parseInt(inner, 10);
    } else if ('WUBRG'.includes(inner)) {
      pool[inner] = (pool[inner] || 0) + 1;
    } else if (inner === 'X') {
      // Skip X costs
    }
  }
  return pool;
}

function isTargeting(effects: any[]): boolean {
  if (!effects) return false;
  for (const eff of effects) {
    const t = eff.target || '';
    if (/creature|player|opponent|permanent|artifact|enchantment|planeswalker/.test(t)) {
      return true;
    }
    if (eff.modes) {
      for (const m of eff.modes) {
        const mt = m.target || '';
        if (/creature|player|opponent|permanent|artifact|enchantment|planeswalker/.test(mt)) return true;
      }
    }
  }
  return false;
}

function getInteractiveTypes(dbEntry: any): string[] {
  const types: string[] = [];
  const allEffects = [...(dbEntry.etb || []), ...(dbEntry.cast || [])];
  for (const eff of allEffects) {
    switch (eff.type) {
      case 'scry': types.push('scry'); break;
      case 'surveil': types.push('surveil'); break;
      case 'modal': types.push('modal_choice'); break;
      case 'search_library': types.push('search_library'); break;
      case 'ramp': types.push('ramp_choice'); break;
      case 'discard': types.push('discard'); break;
      case 'look_top': types.push('look_top_choice'); break;
      case 'distribute_counters': types.push('distribute_counters'); break;
      case 'damage':
        if (eff.target === 'any' || eff.target === 'creature_or_player') {
          types.push('etb_any_damage_target', 'etb_damage_target');
        }
        break;
      case 'counter_self':
      case 'counter':
        if (eff.target) types.push('etb_counter_target');
        break;
      case 'exile':
        if (eff.target && /creature|permanent/.test(eff.target)) types.push('etb_exile_target');
        break;
      case 'bounce':
        if (eff.target && /creature|permanent/.test(eff.target)) types.push('etb_bounce_target');
        break;
      case 'tap':
        if (eff.target) types.push('etb_tap_target');
        break;
      case 'fight':
        types.push('etb_fight_target');
        break;
      case 'destroy':
        if (eff.target && /creature|permanent|artifact|enchantment/.test(eff.target)) types.push('etb_destroy_target');
        break;
    }
  }
  return [...new Set(types)];
}

// ─── Oracle text parsing ───

function parseOracleAnthems(oracleText: string): OracleAnthem[] {
  const anthems: OracleAnthem[] = [];
  // Match: "X creatures you control get +N/+N" patterns (exclude "until end of turn" — those are temp buffs, not anthems)
  const anthemRe = /(?:(legendary|nonlegendary|other) )?creatures you control get ([+-]\d+)\/([+-]\d+)(?!.*until end of turn)/gi;
  let m;
  while ((m = anthemRe.exec(oracleText)) !== null) {
    const qualifier = (m[1] || '').toLowerCase();
    let target = 'all_creatures';
    if (qualifier === 'legendary') target = 'legendary_creatures';
    else if (qualifier === 'nonlegendary') target = 'nonlegendary_creatures';
    else if (qualifier === 'other') target = 'other_creatures';
    anthems.push({
      pattern: m[0],
      power: parseInt(m[2], 10),
      toughness: parseInt(m[3], 10),
      target,
    });
  }
  // Keyword grants: "creatures you control have X"
  const kwRe = /creatures you control (?:get [^.]*and )?have ([\w\s,]+)/gi;
  while ((m = kwRe.exec(oracleText)) !== null) {
    const kwList = m[1].split(/,\s*| and /).map(k => k.trim().toLowerCase()).filter(Boolean);
    if (kwList.length > 0 && anthems.length > 0) {
      anthems[anthems.length - 1].keywords = kwList;
    } else if (kwList.length > 0) {
      anthems.push({ pattern: m[0], power: 0, toughness: 0, target: 'all_creatures', keywords: kwList });
    }
  }
  // Equipment: "equipped creature gets +N/+N"
  const equipRe = /equipped creature gets ([+-]\d+)\/([+-]\d+)/i;
  const eqMatch = oracleText.match(equipRe);
  if (eqMatch) {
    anthems.push({
      pattern: eqMatch[0],
      power: parseInt(eqMatch[1], 10),
      toughness: parseInt(eqMatch[2], 10),
      target: 'equipped_creature',
    });
  }
  return anthems;
}

function parseOracleTriggers(oracleText: string): OracleTrigger[] {
  const triggers: OracleTrigger[] = [];
  const lines = oracleText.split('\n');
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/^whenever .* attacks/i.test(line)) {
      triggers.push({ pattern: line.substring(0, 60), event: 'attacks' });
    } else if (/^whenever .* deals combat damage/i.test(line)) {
      triggers.push({ pattern: line.substring(0, 60), event: 'deals_combat_damage' });
    } else if (/^whenever .* dies/i.test(line)) {
      triggers.push({ pattern: line.substring(0, 60), event: 'dies' });
    } else if (/^whenever .* enters/i.test(line)) {
      triggers.push({ pattern: line.substring(0, 60), event: 'enters' });
    } else if (/^at the beginning of combat/i.test(line)) {
      triggers.push({ pattern: line.substring(0, 60), event: 'combat_begin' });
    } else if (/^at the beginning of your upkeep/i.test(line)) {
      triggers.push({ pattern: line.substring(0, 60), event: 'upkeep' });
    } else if (/^at the beginning of your end step/i.test(line)) {
      triggers.push({ pattern: line.substring(0, 60), event: 'end_step' });
    } else if (/^whenever you cast/i.test(line)) {
      triggers.push({ pattern: line.substring(0, 60), event: 'cast_spell' });
    } else if (/^whenever you gain life/i.test(line)) {
      triggers.push({ pattern: line.substring(0, 60), event: 'gain_life' });
    } else if (/^whenever .* blocks/i.test(line)) {
      triggers.push({ pattern: line.substring(0, 60), event: 'blocks' });
    }
  }
  return triggers;
}

function parseOracleKeywords(oracleText: string, scryfallKeywords: string[]): string[] {
  const allKws = new Set<string>(scryfallKeywords.map(k => k.toLowerCase()));
  // Also extract keyword-like words from oracle text first line
  const kwPatterns = ['flying', 'trample', 'vigilance', 'lifelink', 'deathtouch', 'first strike',
    'double strike', 'haste', 'reach', 'menace', 'hexproof', 'indestructible', 'flash',
    'defender', 'ward', 'protection'];
  for (const kw of kwPatterns) {
    if (oracleText.toLowerCase().includes(kw)) allKws.add(kw);
  }
  return [...allKws];
}

const fixtures: CardFlowFixture[] = [];

for (const card of cards) {
  const name = card.name;
  const typeLine: string = card.type_line || '';
  const manaCost: string = card.mana_cost || '';
  const isLand = typeLine.toLowerCase().includes('land');
  const isCreature = typeLine.toLowerCase().includes('creature');
  const isPermanent = isCreature ||
    typeLine.toLowerCase().includes('artifact') ||
    typeLine.toLowerCase().includes('enchantment') ||
    typeLine.toLowerCase().includes('planeswalker') ||
    isLand;

  // Skip tokens, emblems, DFCs back faces
  if (typeLine.toLowerCase().includes('token') || typeLine.toLowerCase().includes('emblem')) continue;

  const dbEntry = CardEffectsDB[name.toLowerCase()] || {};

  // Skip X-cost, adventure, and additional_costs cards for cast flow
  const hasX = manaCost.includes('{X}');
  const isAdventure = card.layout === 'adventure';
  const hasAdditionalCosts = !!(dbEntry.additional_costs && dbEntry.additional_costs.length > 0);
  const etbEffects = dbEntry.etb || [];
  const castEffects = dbEntry.cast || [];
  const triggers = dbEntry.triggered || [];

  const hasAttackTrigger = triggers.some((t: any) => t.event === 'attacks');
  const hasDeathTrigger = triggers.some((t: any) => t.event === 'dies' || t.event === 'creature_dies');

  const oracleText = card.oracle_text || '';
  const oracleAnthems = parseOracleAnthems(oracleText);
  const oracleTriggers = parseOracleTriggers(oracleText);
  const oracleKeywords = parseOracleKeywords(oracleText, card.keywords || []);

  const hasAnthemInDB = !!(dbEntry.anthem || (dbEntry.static || []).some((s: any) =>
    s.type === 'anthem' || s.type === 'buff_all'));
  const hasTriggeredInDB = (triggers.length > 0);

  const fixture: CardFlowFixture = {
    name,
    cardDef: {
      name,
      type_line: typeLine,
      oracle_text: oracleText,
      mana_cost: manaCost,
      power: card.power,
      toughness: card.toughness,
      keywords: card.keywords || [],
      colors: card.colors || [],
      color_identity: card.color_identity || [],
      rarity: card.rarity || 'common',
      set: setCode.toUpperCase(),
      cmc: card.cmc || 0,
    },
    manaCost,
    manaPool: parseManaPool(manaCost),
    isPermanent,
    isCreature,
    isLand,
    hasETB: etbEffects.length > 0,
    etbTypes: etbEffects.map((e: any) => e.type),
    hasCastEffects: castEffects.length > 0,
    hasAttackTrigger,
    hasDeathTrigger,
    keywords: card.keywords || [],
    needsTarget: isTargeting(castEffects) || isTargeting(etbEffects),
    interactiveTypes: getInteractiveTypes(dbEntry),
    power: parseInt(card.power || '0', 10) || 0,
    toughness: parseInt(card.toughness || '0', 10) || 0,
    oracleAnthems,
    oracleTriggers,
    oracleKeywords,
    hasAnthemInDB,
    hasTriggeredInDB,
    dbEntry: Object.keys(dbEntry).length > 0 ? dbEntry : null,
  };

  // Tag skips
  (fixture as any)._skipCast = isLand || hasX || isAdventure || hasAdditionalCosts;

  fixtures.push(fixture);
}

// Emit TypeScript file
const outPath = path.resolve(__dirname, '../tests/helpers/card-flow-fixtures.ts');
const lines: string[] = [
  '// AUTO-GENERATED by tools/generate-flow-tests.ts — do not edit manually',
  `// Set: ${setCode.toUpperCase()}, ${fixtures.length} cards`,
  `// Generated: ${new Date().toISOString()}`,
  '',
  'import type { CardDef } from \'./game-helper\';',
  '',
  'export interface OracleAnthem {',
  '  pattern: string;',
  '  power: number;',
  '  toughness: number;',
  '  target: string;',
  '  keywords?: string[];',
  '}',
  '',
  'export interface OracleTrigger {',
  '  pattern: string;',
  '  event: string;',
  '}',
  '',
  'export interface CardFlowFixture {',
  '  name: string;',
  '  cardDef: CardDef;',
  '  manaCost: string;',
  '  manaPool: Record<string, number>;',
  '  isPermanent: boolean;',
  '  isCreature: boolean;',
  '  isLand: boolean;',
  '  hasETB: boolean;',
  '  etbTypes: string[];',
  '  hasCastEffects: boolean;',
  '  hasAttackTrigger: boolean;',
  '  hasDeathTrigger: boolean;',
  '  keywords: string[];',
  '  needsTarget: boolean;',
  '  interactiveTypes: string[];',
  '  power: number;',
  '  toughness: number;',
  '  oracleAnthems: OracleAnthem[];',
  '  oracleTriggers: OracleTrigger[];',
  '  oracleKeywords: string[];',
  '  hasAnthemInDB: boolean;',
  '  hasTriggeredInDB: boolean;',
  '  dbEntry: any;',
  '  _skipCast?: boolean;',
  '}',
  '',
  'export const FIXTURES: CardFlowFixture[] = ' + JSON.stringify(fixtures, null, 2) + ';',
  '',
  '// Index by name for quick lookup',
  'export const FIXTURE_MAP: Record<string, CardFlowFixture> = {};',
  'for (const f of FIXTURES) FIXTURE_MAP[f.name] = f;',
  '',
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`✅ Generated ${fixtures.length} fixtures → ${outPath}`);
console.log(`   Castable (non-land, non-X, non-adventure): ${fixtures.filter(f => !(f as any)._skipCast).length}`);
console.log(`   Creatures: ${fixtures.filter(f => f.isCreature).length}`);
console.log(`   Interactive (human tests): ${fixtures.filter(f => f.interactiveTypes.length > 0).length}`);
console.log(`   With attack triggers: ${fixtures.filter(f => f.hasAttackTrigger).length}`);
console.log(`   With oracle anthems: ${fixtures.filter(f => f.oracleAnthems.length > 0).length}`);
console.log(`   With oracle triggers: ${fixtures.filter(f => f.oracleTriggers.length > 0).length}`);
console.log(`   With DB entry: ${fixtures.filter(f => f.dbEntry !== null).length}`);
