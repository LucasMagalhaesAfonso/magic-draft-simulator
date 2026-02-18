#!/usr/bin/env node
/**
 * process-set.js — Auto-processor de sets para CardEffectsDB
 *
 * Usa os mesmos parsers do engine (cards.js) via vm sandbox para gerar
 * entries do CardEffectsDB automaticamente a partir do Scryfall API.
 *
 * Usage:
 *   node tools/process-set.js <SET_CODE> [options]
 *
 * Options:
 *   --dry-run    Só mostra relatório, não gera arquivo (default)
 *   --merge      Adiciona entries novas no card-effects.js (não sobrescreve)
 *   --force      Sobrescreve entries existentes com as geradas
 *   --verbose    Mostra cada carta processada
 *
 * Examples:
 *   node tools/process-set.js TDM --dry-run
 *   node tools/process-set.js TDM
 *   node tools/process-set.js LRW --verbose
 *   node tools/process-set.js ECL --merge
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ===================== CONFIG =====================

const ROOT = path.resolve(__dirname, '..');
const CARDS_JS = path.join(ROOT, 'js', 'game', 'cards.js');
const EFFECTS_JS = path.join(ROOT, 'js', 'data', 'card-effects.js');
const OUTPUT_DIR = path.join(__dirname, 'output');

const TRACKED_KEYWORDS = [
  'Flying', 'Flash', 'Menace', 'Reach', 'Trample',
  'Haste', 'Deathtouch', 'Vigilance', 'Defender', 'First Strike',
  'Double Strike', 'Lifelink', 'Hexproof', 'Indestructible', 'Wither',
  'Persist', 'Changeling', 'Ward'
];

// Patterns that signal manual review needed
const COMPLEX_PATTERNS = [
  { regex: /choose one/i, tag: 'modal (choose one)' },
  { regex: /choose two/i, tag: 'modal (choose two)' },
  { regex: /instead/i, tag: 'replacement effect' },
  { regex: /for each/i, tag: 'dynamic amount (for each)' },
  { regex: /you may cast[^.]*graveyard/i, tag: 'graveyard cast' },
  { regex: /as long as/i, tag: 'conditional static' },
  { regex: /if you control/i, tag: 'conditional (if you control)' },
  { regex: /whenever a creature enters/i, tag: 'global trigger (creature enters)' },
  { regex: /protection from/i, tag: 'protection' },
  { regex: /can't be blocked/i, tag: 'evasion (can\'t be blocked)' },
  { regex: /phases? out/i, tag: 'phasing' },
  { regex: /planeswalker/i, tag: 'planeswalker' },
  { regex: /cascade/i, tag: 'cascade' },
  { regex: /storm/i, tag: 'storm' },
  { regex: /kicker/i, tag: 'kicker' },
  { regex: /madness/i, tag: 'madness' },
  { regex: /suspend/i, tag: 'suspend' },
  { regex: /partner/i, tag: 'partner' },
  { regex: /crew \d/i, tag: 'vehicle (crew)' },
];

// ===================== SCRYFALL FETCH =====================

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchSetCards(setCode) {
  const cards = [];
  let url = `https://api.scryfall.com/cards/search?q=set:${setCode.toLowerCase()}+is:booster&unique=prints&order=set`;
  let page = 1;

  while (url) {
    if (page > 1) await delay(100); // Scryfall rate limit
    process.stdout.write(`  Fetching page ${page}...`);

    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (resp.status === 404 || (err.code === 'not_found')) {
        console.error(`\n  ERROR: Set "${setCode}" not found on Scryfall.`);
        process.exit(1);
      }
      throw new Error(`Scryfall API error: ${resp.status} ${err.details || ''}`);
    }
    const data = await resp.json();
    cards.push(...data.data);
    process.stdout.write(` ${data.data.length} cards\n`);
    url = data.has_more ? data.next_page : null;
    page++;
  }

  return cards;
}

function simplifyCard(raw) {
  const face = raw.card_faces?.[0] || raw;
  return {
    name: raw.name,
    oracle_text: face.oracle_text || raw.oracle_text || '',
    type_line: face.type_line || raw.type_line || '',
    power: face.power || raw.power || null,
    toughness: face.toughness || raw.toughness || null,
    keywords: raw.keywords || [],
    mana_cost: face.mana_cost || raw.mana_cost || '',
    cmc: raw.cmc || 0,
    colors: face.colors || raw.colors || [],
    color_identity: raw.color_identity || [],
    rarity: raw.rarity,
    layout: raw.layout || 'normal',
    collector_number: raw.collector_number || '',
    // DFC back face
    backFace: (raw.layout === 'transform' && raw.card_faces?.[1]) ? {
      name: raw.card_faces[1].name,
      oracle_text: raw.card_faces[1].oracle_text || '',
      type_line: raw.card_faces[1].type_line || '',
      power: raw.card_faces[1].power,
      toughness: raw.card_faces[1].toughness,
      keywords: raw.card_faces[1].keywords || raw.keywords || []
    } : null,
    // Adventure
    adventure: (raw.layout === 'adventure' && raw.card_faces?.[1]) ? {
      name: raw.card_faces[1].name,
      mana_cost: raw.card_faces[1].mana_cost || '',
      type_line: raw.card_faces[1].type_line || '',
      oracle_text: raw.card_faces[1].oracle_text || ''
    } : null
  };
}

// ===================== VM SANDBOX — LOAD PARSERS =====================

function loadParsers() {
  const cardsSource = fs.readFileSync(CARDS_JS, 'utf8');

  const sandbox = {
    // Minimal stubs so cards.js doesn't crash
    ManaSystem: {
      parseCost(cost) {
        let total = 0, W = 0, U = 0, B = 0, R = 0, G = 0;
        const symbols = (cost || '').match(/\{([^}]+)\}/g) || [];
        for (const sym of symbols) {
          const v = sym.replace(/[{}]/g, '').toUpperCase();
          if (/^\d+$/.test(v)) total += parseInt(v);
          else if (v === 'X') { /* skip */ }
          else if (v === 'W') { W++; total++; }
          else if (v === 'U') { U++; total++; }
          else if (v === 'B') { B++; total++; }
          else if (v === 'R') { R++; total++; }
          else if (v === 'G') { G++; total++; }
          else if (v === 'C') total++;
          else if (v.includes('/')) total++; // hybrid
          else total++;
        }
        return { total, W, U, B, R, G };
      }
    },
    CardEffectsDB: {
      hasEffects() { return false; },
      getEffects() { return null; }
    },
    AIProcessor: { isInCache() { return false; } },
    console: { log() {}, warn() {}, error() {} }
  };

  vm.createContext(sandbox);
  // cards.js uses `const CardEngine = {...}` — const doesn't leak into sandbox
  const wrappedSource = cardsSource.replace(/\bconst CardEngine\s*=/, 'var CardEngine =');
  vm.runInContext(wrappedSource, sandbox);
  return sandbox.CardEngine;
}

// ===================== LOAD EXISTING DB =====================

function loadExistingDB() {
  const source = fs.readFileSync(EFFECTS_JS, 'utf8');
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }
  };
  vm.createContext(sandbox);
  // card-effects.js uses `const CardEffectsDB = {...}` which doesn't leak into sandbox
  // Wrap it so the variable gets assigned to the sandbox context
  const wrappedSource = source.replace(/\bconst CardEffectsDB\s*=/, 'var CardEffectsDB =');
  vm.runInContext(wrappedSource, sandbox);
  return sandbox.CardEffectsDB;
}

// ===================== GENERATE ENTRY =====================

function generateEntry(CE, card) {
  const entry = {};
  const flags = [];
  const typeLine = card.type_line || '';
  const isCreature = typeLine.includes('Creature');
  const isInstSorc = typeLine.includes('Instant') || typeLine.includes('Sorcery');
  const isEquip = typeLine.toLowerCase().includes('equipment');
  const isAura = typeLine.toLowerCase().includes('aura');
  const isSaga = typeLine.toLowerCase().includes('saga');
  const isLand = typeLine.includes('Land') && !typeLine.includes('Creature');
  const text = card.oracle_text || '';

  // 1. Cast effects (instants/sorceries)
  if (isInstSorc) {
    try {
      const effects = CE.parseSpellEffects(card);
      if (effects && effects.length > 0) entry.cast = effects;
    } catch (e) { flags.push('parseSpellEffects crashed: ' + e.message); }
  }

  // 2. ETB effects (permanents)
  if (!isInstSorc) {
    try {
      const etb = CE.parseETBEffects(card);
      if (etb && etb.length > 0) entry.etb = etb;
    } catch (e) { flags.push('parseETBEffects crashed: ' + e.message); }
  }

  // 3. Triggered abilities
  try {
    const triggered = CE.parseTriggeredAbilities(card);
    if (triggered && triggered.length > 0) entry.triggered = triggered;
  } catch (e) { flags.push('parseTriggeredAbilities crashed: ' + e.message); }

  // 4. Activated abilities
  try {
    const activated = CE.parseActivatedAbilities(card);
    if (activated && activated.length > 0) entry.activated = activated;
  } catch (e) { flags.push('parseActivatedAbilities crashed: ' + e.message); }

  // 5. Equipment / Aura effects
  if (isEquip) {
    try {
      const eqEffects = CE.parseEquipmentEffects(card);
      if (eqEffects && eqEffects.length > 0) entry.equipment = eqEffects;
    } catch (e) { flags.push('parseEquipmentEffects crashed: ' + e.message); }
  }
  if (isAura) {
    try {
      const auraEffects = CE.parseAuraEffects(card);
      if (auraEffects && auraEffects.length > 0) entry.aura = auraEffects;
    } catch (e) { flags.push('parseAuraEffects crashed: ' + e.message); }
  }

  // 6. Additional costs
  try {
    const addCosts = CE.parseAdditionalCosts(card);
    if (addCosts && addCosts.length > 0) entry.additional_costs = addCosts;
  } catch (e) { /* ignore */ }

  // 7. Static keywords
  const keywords = (card.keywords || []).filter(k => TRACKED_KEYWORDS.includes(k));
  if (keywords.length > 0) {
    if (!entry.static) entry.static = [];
    entry.static.push({ type: 'has_keyword', keywords });
  }

  // 8. Special mechanics detection
  try {
    const evokeCost = CE.getEvokeCost(card);
    if (evokeCost) entry._evoke = evokeCost;
  } catch (e) { /* ignore */ }

  try {
    const champion = CE.getChampionType(card);
    if (champion) entry._champion = champion;
  } catch (e) { /* ignore */ }

  try {
    if (CE.hasConvoke(card)) entry._convoke = true;
  } catch (e) { /* ignore */ }

  try {
    const harmonize = CE.getHarmonizeCost(card);
    if (harmonize) entry.harmonize = harmonize;
  } catch (e) { /* ignore */ }

  try {
    const cycling = CE.parseCyclingAbility(card);
    if (cycling) entry._cycling = cycling;
  } catch (e) { /* ignore */ }

  if (card.layout === 'transform') entry._transform = true;
  if (card.adventure) entry._adventure = card.adventure.name;
  if (isSaga) flags.push('saga (chapters need manual review)');

  // 9. Detect complexity that parsers can't handle
  const lowerText = text.toLowerCase();
  for (const pat of COMPLEX_PATTERNS) {
    if (pat.regex.test(text)) {
      flags.push(pat.tag);
    }
  }

  // 10. Check if we got nothing from non-trivial card
  const hasEffects = Object.keys(entry).some(k => !k.startsWith('_'));
  if (!hasEffects && text.length > 20 && !isLand) {
    flags.push('no effects parsed from non-trivial oracle text');
  }

  return { entry, flags };
}

// ===================== COMPARISON =====================

function getEffectTypes(entry) {
  const types = new Set();
  if (entry.cast) types.add('cast');
  if (entry.etb) types.add('etb');
  if (entry.triggered) types.add('triggered');
  if (entry.activated) types.add('activated');
  if (entry.static) types.add('static');
  if (entry.equipment) types.add('equipment');
  if (entry.aura) types.add('aura');
  if (entry.additional_costs) types.add('additional_costs');
  if (entry.harmonize) types.add('harmonize');
  if (entry.modal) types.add('modal');
  if (entry.modes) types.add('modes');
  if (entry.saga) types.add('saga');
  if (entry.chapters) types.add('chapters');
  if (entry.graveyard) types.add('graveyard');
  return types;
}

function countEffects(entry) {
  let count = 0;
  if (entry.cast) count += entry.cast.length;
  if (entry.etb) count += entry.etb.length;
  if (entry.triggered) count += entry.triggered.length;
  if (entry.activated) count += entry.activated.length;
  if (entry.static) count += entry.static.length;
  if (entry.equipment) count += entry.equipment.length;
  if (entry.aura) count += entry.aura.length;
  if (entry.graveyard) count += entry.graveyard.length;
  if (entry.modes) count += entry.modes.length;
  if (entry.chapters) count += Object.keys(entry.chapters).length;
  return count;
}

function compareWithExisting(generated, existingDB) {
  const report = { matches: [], dbBetter: [], genBetter: [], newCards: [], conflicts: [] };

  for (const [name, genData] of Object.entries(generated)) {
    const dbEntry = existingDB.getEffects(name);
    if (!dbEntry) {
      report.newCards.push(name);
      continue;
    }

    const genTypes = getEffectTypes(genData.entry);
    const dbTypes = getEffectTypes(dbEntry);
    const genCount = countEffects(genData.entry);
    const dbCount = countEffects(dbEntry);

    // Compare: same types = match, DB has more = DB better, gen has more = gen better
    const genOnly = [...genTypes].filter(t => !dbTypes.has(t));
    const dbOnly = [...dbTypes].filter(t => !genTypes.has(t));

    if (genOnly.length === 0 && dbOnly.length === 0) {
      report.matches.push({ name, genCount, dbCount });
    } else if (dbOnly.length > 0 && genOnly.length === 0) {
      report.dbBetter.push({ name, dbOnly, genCount, dbCount });
    } else if (genOnly.length > 0 && dbOnly.length === 0) {
      report.genBetter.push({ name, genOnly, genCount, dbCount });
    } else {
      report.conflicts.push({ name, genOnly, dbOnly });
    }
  }

  return report;
}

// ===================== OUTPUT GENERATION =====================

function entryToJS(name, entry, indent = '  ') {
  // Clean up internal flags before output
  const clean = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k.startsWith('_')) continue; // Skip internal flags
    clean[k] = v;
  }

  if (Object.keys(clean).length === 0) return null;

  const lines = [];
  lines.push(`${indent}"${name}": {`);

  for (const [key, val] of Object.entries(clean)) {
    const json = JSON.stringify(val);
    // Pretty-format arrays of effects
    if (Array.isArray(val) && val.length === 1) {
      lines.push(`${indent}  ${key}: [${JSON.stringify(val[0])}]`);
    } else if (Array.isArray(val)) {
      lines.push(`${indent}  ${key}: [`);
      val.forEach((item, i) => {
        const comma = i < val.length - 1 ? ',' : '';
        lines.push(`${indent}    ${JSON.stringify(item)}${comma}`);
      });
      lines.push(`${indent}  ]`);
    } else if (typeof val === 'string') {
      lines.push(`${indent}  ${key}: "${val}"`);
    } else {
      lines.push(`${indent}  ${key}: ${json}`);
    }
  }

  lines.push(`${indent}}`);
  return lines.join('\n');
}

function generateOutputFile(setCode, generated, needsReview, setName) {
  const date = new Date().toISOString().split('T')[0];
  const autoEntries = [];
  const reviewEntries = [];

  for (const [name, data] of Object.entries(generated)) {
    if (data.flags.length > 0) {
      reviewEntries.push({ name, data });
    } else {
      autoEntries.push({ name, data });
    }
  }

  let output = '';
  output += `// Auto-generated CardEffectsDB entries for ${setCode.toUpperCase()}${setName ? ' (' + setName + ')' : ''}\n`;
  output += `// Generated: ${date}\n`;
  output += `// Cards: ${autoEntries.length} auto-generated, ${reviewEntries.length} need manual review\n`;
  output += `//\n`;
  output += `// To use: copy desired entries into js/data/card-effects.js\n`;
  output += `// inside the CardEffectsDB object.\n\n`;

  // Auto-generated section
  output += `// =================== AUTO-GENERATED (${autoEntries.length}) ===================\n\n`;
  for (const { name, data } of autoEntries) {
    const js = entryToJS(name, data.entry);
    if (js) output += js + ',\n\n';
  }

  // Manual review section
  output += `\n// =================== NEEDS MANUAL REVIEW (${reviewEntries.length}) ===================\n`;
  output += `// These cards have oracle text patterns not fully recognized by parsers.\n\n`;
  for (const { name, data } of reviewEntries) {
    output += `// "${name}"\n`;
    output += `// Flags: ${data.flags.join(', ')}\n`;
    const oraclePreview = (data.oracle || '').replace(/\n/g, ' ').substring(0, 120);
    if (oraclePreview) output += `// Oracle: ${oraclePreview}\n`;
    const js = entryToJS(name, data.entry);
    if (js) {
      output += `// Partial parse (may be incomplete):\n`;
      output += `// ${js.split('\n').join('\n// ')}\n`;
    }
    output += `\n`;
  }

  return output;
}

function generateDiffFile(setCode, comparison) {
  let output = `Comparison: ${setCode.toUpperCase()} — Auto-generated vs Existing DB\n`;
  output += `${'='.repeat(60)}\n\n`;

  output += `MATCHES (${comparison.matches.length}):\n`;
  for (const m of comparison.matches) {
    output += `  ✓ "${m.name}" — gen:${m.genCount} effects, db:${m.dbCount} effects\n`;
  }

  output += `\nDB IS BETTER (${comparison.dbBetter.length}):\n`;
  for (const m of comparison.dbBetter) {
    output += `  ⚠ "${m.name}" — DB has extra: [${m.dbOnly.join(', ')}] (gen:${m.genCount}, db:${m.dbCount})\n`;
  }

  output += `\nGENERATED IS BETTER (${comparison.genBetter.length}):\n`;
  for (const m of comparison.genBetter) {
    output += `  ★ "${m.name}" — Gen has extra: [${m.genOnly.join(', ')}] (gen:${m.genCount}, db:${m.dbCount})\n`;
  }

  output += `\nCONFLICTS (${comparison.conflicts.length}):\n`;
  for (const m of comparison.conflicts) {
    output += `  ✗ "${m.name}" — Gen-only: [${m.genOnly.join(', ')}], DB-only: [${m.dbOnly.join(', ')}]\n`;
  }

  output += `\nNEW CARDS not in DB (${comparison.newCards.length}):\n`;
  for (const name of comparison.newCards) {
    output += `  + "${name}"\n`;
  }

  return output;
}

// ===================== MERGE INTO CARD-EFFECTS.JS =====================

function mergeIntoEffectsFile(generated, force) {
  const source = fs.readFileSync(EFFECTS_JS, 'utf8');
  const existingDB = loadExistingDB();

  let added = 0, skipped = 0, replaced = 0;
  const newEntries = [];

  for (const [name, data] of Object.entries(generated)) {
    if (data.flags.length > 0) { skipped++; continue; } // Skip cards needing review

    const clean = {};
    for (const [k, v] of Object.entries(data.entry)) {
      if (!k.startsWith('_')) clean[k] = v;
    }
    if (Object.keys(clean).length === 0) { skipped++; continue; }

    const exists = existingDB.hasEffects(name);
    if (exists && !force) {
      skipped++;
      continue;
    }

    if (exists) replaced++;
    else added++;

    newEntries.push({ name, entry: clean });
  }

  if (newEntries.length === 0) {
    console.log('  No new entries to merge.');
    return;
  }

  // Build the JS text for new entries
  let insertText = `\n  // =================== AUTO-GENERATED (${new Date().toISOString().split('T')[0]}) ===================\n\n`;
  for (const { name, entry } of newEntries) {
    const js = entryToJS(name, entry);
    if (js) insertText += js + ',\n\n';
  }

  // Insert before the closing `};` of CardEffectsDB
  const insertPos = source.lastIndexOf('};');
  if (insertPos === -1) {
    console.error('  ERROR: Could not find closing }; in card-effects.js');
    return;
  }

  const newSource = source.substring(0, insertPos) + insertText + source.substring(insertPos);
  fs.writeFileSync(EFFECTS_JS, newSource, 'utf8');
  console.log(`  Merged: ${added} added, ${replaced} replaced, ${skipped} skipped`);
}

// ===================== MAIN =====================

async function main() {
  const args = process.argv.slice(2);
  const setCode = args.find(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const merge = args.includes('--merge');
  const force = args.includes('--force');
  const verbose = args.includes('--verbose');

  if (!setCode) {
    console.log('Usage: node tools/process-set.js <SET_CODE> [--dry-run] [--merge] [--force] [--verbose]');
    console.log('');
    console.log('  <SET_CODE>  Scryfall set code (e.g. TDM, LRW, ECL, MH3)');
    console.log('  --dry-run   Only show report, don\'t generate files (default if no flag)');
    console.log('  --merge     Add new entries to card-effects.js (skip existing)');
    console.log('  --force     Overwrite existing entries when merging');
    console.log('  --verbose   Show each card as it\'s processed');
    process.exit(1);
  }

  const upperCode = setCode.toUpperCase();
  console.log(`\n=== PROCESS SET: ${upperCode} ===\n`);

  // 1. Load parsers
  console.log('Loading engine parsers from cards.js...');
  const CE = loadParsers();
  console.log('  ✓ CardEngine loaded\n');

  // 2. Load existing DB
  console.log('Loading existing CardEffectsDB...');
  const existingDB = loadExistingDB();
  if (!existingDB) {
    console.error('  ERROR: Could not load CardEffectsDB. Check card-effects.js syntax.');
    process.exit(1);
  }
  const existingKeys = Object.keys(existingDB).filter(k => typeof existingDB[k] === 'object' && !['getEffects', 'hasEffects'].includes(k));
  console.log(`  ✓ ${existingKeys.length} existing entries\n`);

  // 3. Fetch from Scryfall
  console.log(`Fetching cards for set ${upperCode} from Scryfall...`);
  const rawCards = await fetchSetCards(setCode);
  console.log(`  ✓ ${rawCards.length} cards fetched\n`);

  // 4. Simplify and filter
  const cards = rawCards.map(simplifyCard);
  const basicLands = cards.filter(c => (c.type_line || '').includes('Basic Land'));
  const processable = cards.filter(c => !(c.type_line || '').includes('Basic Land'));
  const setName = rawCards[0]?.set_name || '';

  console.log(`  Basic lands skipped: ${basicLands.length}`);
  console.log(`  Cards to process: ${processable.length}\n`);

  // 5. Process each card
  console.log('Processing cards...');
  const generated = {};
  let existingCount = 0;
  let autoCount = 0;
  let reviewCount = 0;
  let landsSkipped = 0;

  for (const card of processable) {
    const key = card.name.toLowerCase().trim();

    // Skip pure lands with no oracle text beyond mana
    const isLand = card.type_line.includes('Land') && !card.type_line.includes('Creature');
    const oracleLen = (card.oracle_text || '').replace(/\{[WUBRGC\d]+\}/g, '').replace(/\(.*?\)/gs, '').trim().length;
    if (isLand && oracleLen < 15) {
      landsSkipped++;
      if (verbose) console.log(`  SKIP (simple land): ${card.name}`);
      continue;
    }

    const { entry, flags } = generateEntry(CE, card);

    // Store oracle text for review output
    generated[key] = { entry, flags, oracle: card.oracle_text, typeLine: card.type_line };

    const inDB = existingDB.hasEffects(card.name);
    if (inDB) existingCount++;

    if (flags.length > 0) {
      reviewCount++;
      if (verbose) console.log(`  REVIEW: ${card.name} — [${flags.join(', ')}]`);
    } else if (Object.keys(entry).some(k => !k.startsWith('_'))) {
      autoCount++;
      if (verbose) console.log(`  AUTO:   ${card.name}`);
    } else {
      if (verbose) console.log(`  EMPTY:  ${card.name} (no parseable effects)`);
    }
  }

  console.log(`\n  Cards with existing DB entry: ${existingCount}`);
  console.log(`  Cards auto-generated: ${autoCount}`);
  console.log(`  Cards needing manual review: ${reviewCount}`);
  console.log(`  Simple lands skipped: ${landsSkipped}`);

  // 6. Comparison with existing DB
  console.log('\nComparing with existing DB...');
  const comparison = compareWithExisting(generated, existingDB);
  console.log(`  Matches: ${comparison.matches.length}`);
  console.log(`  DB is better: ${comparison.dbBetter.length}`);
  console.log(`  Generated is better: ${comparison.genBetter.length}`);
  console.log(`  Conflicts: ${comparison.conflicts.length}`);
  console.log(`  New cards (not in DB): ${comparison.newCards.length}`);

  // 7. Show manual review list
  const reviewCards = Object.entries(generated)
    .filter(([, d]) => d.flags.length > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (reviewCards.length > 0) {
    console.log(`\n--- MANUAL REVIEW NEEDED (${reviewCards.length}) ---`);
    const flagCounts = {};
    for (const [name, data] of reviewCards) {
      const flagStr = data.flags.slice(0, 3).join(', ');
      console.log(`  - ${name}: ${flagStr}`);
      for (const f of data.flags) {
        flagCounts[f] = (flagCounts[f] || 0) + 1;
      }
    }
    console.log('\n  Flag summary:');
    const sorted = Object.entries(flagCounts).sort((a, b) => b[1] - a[1]);
    for (const [flag, count] of sorted) {
      console.log(`    ${flag}: ${count} cards`);
    }
  }

  // 8. Generate output files (unless dry-run)
  if (dryRun) {
    console.log('\n  [DRY RUN] No files generated. Remove --dry-run to generate output.\n');
    return;
  }

  // Ensure output dir exists
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Write generated entries file
  const outFile = path.join(OUTPUT_DIR, `${upperCode}-generated.js`);
  const outContent = generateOutputFile(upperCode, generated, reviewCards, setName);
  fs.writeFileSync(outFile, outContent, 'utf8');
  console.log(`\n  ✓ Generated entries: ${outFile}`);

  // Write diff file
  const diffFile = path.join(OUTPUT_DIR, `${upperCode}-diff.txt`);
  const diffContent = generateDiffFile(upperCode, comparison);
  fs.writeFileSync(diffFile, diffContent, 'utf8');
  console.log(`  ✓ Diff report: ${diffFile}`);

  // 9. Merge if requested
  if (merge || force) {
    console.log('\nMerging into card-effects.js...');
    mergeIntoEffectsFile(generated, force);
  }

  console.log('\nDone!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
