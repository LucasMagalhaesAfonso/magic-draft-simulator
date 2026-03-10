/**
 * Oracle-Based Card Audit Tool
 * Compares Scryfall oracle text against CardEffectsDB definitions.
 * Usage: npx tsx tools/oracle-audit.ts <set_code>
 * Example: npx tsx tools/oracle-audit.ts ltr
 */

import { CardEffectsDB } from '../src/engine/card-effects';
import * as fs from 'fs';
import * as path from 'path';

type Severity = 'STUB' | 'NO_ENTRY' | 'MISSING_TRIGGER' | 'MISSING_ETB' | 'MISSING_ACTIVATED' | 'WRONG_KEYWORD' | 'MISSING_MODAL' | 'CHAPTER_MISMATCH' | 'MISSING_RING';

interface Issue {
  card: string;
  severity: Severity;
  detail: string;
}

const KNOWN_KEYWORDS = [
  'flying', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'reach',
  'first strike', 'double strike', 'menace', 'haste', 'hexproof',
  'indestructible', 'defender', 'flash', 'ward', 'prowess'
];

const TRIGGER_PATTERNS = [
  /whenever .+ attacks/i,
  /whenever .+ dies/i,
  /whenever .+ enters/i,
  /whenever .+ deals combat damage/i,
  /whenever you cast/i,
  /whenever .+ becomes? (tapped|blocked)/i,
  /at the beginning of/i,
];

function getOracleText(card: any): string {
  if (card.card_faces && Array.isArray(card.card_faces)) {
    return card.card_faces.map((f: any) => f.oracle_text || '').join('\n');
  }
  return card.oracle_text || '';
}

function getTypeLine(card: any): string {
  if (card.card_faces && Array.isArray(card.card_faces)) {
    return card.card_faces.map((f: any) => f.type_line || '').join(' // ');
  }
  return card.type_line || '';
}

function getFrontName(card: any): string {
  if (card.card_faces && Array.isArray(card.card_faces)) {
    return card.card_faces[0].name || card.name;
  }
  return card.name.split(' // ')[0];
}

function isVanilla(oracle: string, keywords: string[]): boolean {
  const stripped = oracle.replace(/\(.*?\)/g, '').trim();
  if (!stripped) return true;
  // Only keywords, no other text
  const lines = stripped.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.every(line => KNOWN_KEYWORDS.some(k => line.toLowerCase() === k || line.toLowerCase().startsWith(k + ',')));
}

function auditCard(card: any): Issue[] {
  const frontName = getFrontName(card);
  const key = frontName.toLowerCase();
  const oracle = getOracleText(card);
  const typeLine = getTypeLine(card);
  const cardKeywords: string[] = card.keywords || [];
  const issues: Issue[] = [];

  // Basic lands — skip
  if (/^Basic Land/i.test(typeLine)) return [];

  // Vanilla creatures — skip
  if (isVanilla(oracle, cardKeywords)) return [];

  // Try exact key first, then full DFC name (e.g. "name // adventure_name")
  let db = CardEffectsDB[key];
  if (!db) {
    // Search for DFC keys containing this front name
    const dfcKey = Object.keys(CardEffectsDB).find(k => k.startsWith(key + ' // '));
    if (dfcKey) db = CardEffectsDB[dfcKey];
  }

  // NO_ENTRY: card not in DB (skip Alchemy "A-" cards)
  if (!db) {
    if (frontName.startsWith('A-')) return []; // Alchemy variant, skip
    issues.push({ card: frontName, severity: 'NO_ENTRY', detail: 'Card not in CardEffectsDB' });
    return issues;
  }

  // STUB: DB entry exists but is empty or only has empty keywords
  const isStub = (() => {
    const keys = Object.keys(db);
    if (keys.length === 0) return true;
    if (keys.length === 1 && keys[0] === 'static') {
      const st = db.static;
      if (Array.isArray(st) && st.length === 1 && st[0].type === 'has_keyword' && (!st[0].keywords || st[0].keywords.length === 0)) {
        return true;
      }
    }
    return false;
  })();

  if (isStub) {
    issues.push({ card: frontName, severity: 'STUB', detail: 'DB entry is empty stub' });
    return issues;
  }

  // MISSING_TRIGGER: oracle has trigger patterns but no triggered array
  // Strip reminder text to avoid false positives
  const oracleNoReminderForTrigger = oracle.replace(/\([^)]*\)/g, '');
  const hasTriggerText = TRIGGER_PATTERNS.some(p => p.test(oracleNoReminderForTrigger));
  if (hasTriggerText && !db.triggered && !db.chapters) {
    const hasTriggerElsewhere = db.gy_trigger || db.cast ||
      db.modal?.modes?.some((m: any) => m.effects?.some((e: any) => e.type === 'triggered')) ||
      db.activated?.some((a: any) => a.effects?.some((e: any) => e.type === 'register_temp_trigger')) ||
      db.equip_cost || db.equip ||
      db.static?.some((s: any) => s.type === 'aura_grant_triggered') ||
      db.aura_debuff;
    if (!hasTriggerElsewhere) {
      issues.push({ card: frontName, severity: 'MISSING_TRIGGER', detail: 'Oracle has trigger text but no triggered[] in DB' });
    }
  }

  // MISSING_ETB: oracle has "When ~ enters" but no etb
  const etbPattern = new RegExp(`when ${frontName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} enters`, 'i');
  const genericEtb = /when (?:it|this creature|this enchantment|this artifact) enters/i;
  if ((etbPattern.test(oracle) || genericEtb.test(oracle)) && !db.etb && !db.cast) {
    // Some ETBs are modeled as cast effects — only flag if neither exists
    issues.push({ card: frontName, severity: 'MISSING_ETB', detail: 'Oracle has ETB text but no etb[] or cast[] in DB' });
  }

  // MISSING_ACTIVATED: oracle has "{cost}: effect" pattern (activated abilities)
  // Strip reminder text (parenthesized) to avoid false positives from Food/Treasure/Clue reminder text
  // Strip reminder text (parenthesized) AND quoted ability text ("...") to avoid false positives
  const oracleNoReminder = oracle.replace(/\([^)]*\)/g, '').replace(/"[^"]*"/g, '');
  const activatedPattern = /\{[WUBRGC0-9T]+\}(?:, \{[WUBRGC0-9T]+\})*.*?:/;
  if (activatedPattern.test(oracleNoReminder) && !db.activated && !db.graveyard) {
    const hasEquip = db.equip_cost || db.equip || /\bEquip\b/i.test(oracle);
    const hasAuraGrant = db.static?.some((s: any) => s.type === 'aura_grant_activated');
    const isManaAbility = /\{T\}: Add/i.test(oracleNoReminder);
    const hasCycling = db.cycling;
    const hasStaticMana = db.static?.some((s: any) => s.type === 'creatures_tap_for_mana' || s.type === 'add_mana');
    const isFood = /\bFood\b/.test(typeLine);
    if (!hasEquip && !hasAuraGrant && !isManaAbility && !hasCycling && !hasStaticMana && !isFood) {
      issues.push({ card: frontName, severity: 'MISSING_ACTIVATED', detail: 'Oracle has activated ability but no activated[] in DB' });
    }
  }

  // Mana dork: {T}: Add (skip lands — their mana abilities are engine-handled)
  // Also skip if oracle only mentions it in reminder text, or if static handles it
  const oracleNoReminderMana = oracle.replace(/\([^)]*\)/g, '');
  if (/\{T\}: Add/i.test(oracleNoReminderMana) && !db.activated && !/\bLand\b/.test(typeLine)) {
    const hasAddMana = db.static?.some((s: any) => s.type === 'add_mana' || s.add_mana || s.type === 'creatures_tap_for_mana');
    if (!hasAddMana) {
      issues.push({ card: frontName, severity: 'MISSING_ACTIVATED', detail: 'Mana dork ({T}: Add) not in activated[] or static[]' });
    }
  }

  // WRONG_KEYWORD: oracle/scryfall keywords vs DB keywords
  const dbKeywords: string[] = (() => {
    if (!db.static) return [];
    for (const s of db.static) {
      if (s.type === 'has_keyword' && s.keywords) return s.keywords.map((k: string) => k.toLowerCase());
    }
    return [];
  })();

  // Only check Scryfall's top-level keywords (inherent to the card), not keywords
  // mentioned in oracle text as grants/buffs to other creatures.
  // Skip "Enchant" (aura implicit), "Equip" (handled by equip_cost).
  // Ward has its own dedicated static type { type: "ward" }.
  const skipKeywords = ['enchant', 'equip'];
  const isSaga = /Saga/i.test(typeLine);
  for (const kw of KNOWN_KEYWORDS) {
    if (skipKeywords.includes(kw)) continue;
    // Sagas often list keywords of created tokens — skip keyword checks for sagas
    if (isSaga) continue;
    const inScryfall = cardKeywords.map(k => k.toLowerCase()).includes(kw);
    const inDb = dbKeywords.includes(kw);
    if (inScryfall && !inDb) {
      // Check for dedicated static types (e.g. ward has { type: "ward" })
      const hasDedicatedType = db.static?.some((s: any) => s.type === kw);
      if (!hasDedicatedType) {
        issues.push({ card: frontName, severity: 'WRONG_KEYWORD', detail: `Keyword "${kw}" in Scryfall keywords but missing from DB` });
      }
    }
  }

  // MISSING_MODAL: "Choose one —" / "Choose two —" (modal spells with bullet points)
  if (/choose (one|two|three) —/i.test(oracle)) {
    const hasModal = db.modal ||
      db.cast?.some((e: any) => e.type === 'modal') ||
      db.etb?.some((e: any) => e.type === 'modal') ||
      db.triggered?.some((t: any) => t.effects?.some((e: any) => e.type === 'modal'));
    if (!hasModal) {
      issues.push({ card: frontName, severity: 'MISSING_MODAL', detail: 'Oracle has modal choice but no modal in DB' });
    }
  }

  // CHAPTER_MISMATCH: Saga type
  if (/Saga/i.test(typeLine)) {
    if (!db.saga || !db.chapters) {
      issues.push({ card: frontName, severity: 'CHAPTER_MISMATCH', detail: 'Saga card but missing saga/chapters in DB' });
    } else {
      // Count chapters in oracle — handle combined chapters like "I, II —"
      const chapterLines = oracle.match(/^[IVX]+(?:,\s*[IVX]+)* —/gm) || [];
      let oracleChapters = 0;
      for (const line of chapterLines) {
        const nums = line.replace(/ —.*/, '').split(',').map(s => s.trim());
        oracleChapters += nums.length;
      }
      const dbChapters = Object.keys(db.chapters).length;
      if (oracleChapters > 0 && dbChapters !== oracleChapters) {
        issues.push({ card: frontName, severity: 'CHAPTER_MISMATCH', detail: `Oracle has ${oracleChapters} chapters but DB has ${dbChapters}` });
      }
    }
  }

  // MISSING_RING: "The Ring tempts you"
  if (/the ring tempts you/i.test(oracle)) {
    const hasRing = JSON.stringify(db).includes('ring_tempt');
    if (!hasRing) {
      issues.push({ card: frontName, severity: 'MISSING_RING', detail: 'Oracle has "The Ring tempts you" but no ring_tempts in DB' });
    }
  }

  return issues;
}

// --- Main ---
const setCode = process.argv[2]?.toLowerCase();
if (!setCode) {
  console.error('Usage: npx tsx tools/oracle-audit.ts <set_code>');
  console.error('Example: npx tsx tools/oracle-audit.ts ltr');
  process.exit(1);
}

const jsonPath = path.resolve(import.meta.dirname, `../legacy-pure-js/js/data/scryfall-${setCode}.json`);
if (!fs.existsSync(jsonPath)) {
  console.error(`File not found: ${jsonPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const cards: any[] = data.cards || data;

const allIssues: Issue[] = [];
let vanillaCount = 0;
let okCount = 0;

for (const card of cards) {
  const oracle = getOracleText(card);
  const typeLine = getTypeLine(card);
  if (/^Basic Land/i.test(typeLine)) { vanillaCount++; continue; }
  if (isVanilla(oracle, card.keywords || [])) { vanillaCount++; continue; }

  const issues = auditCard(card);
  if (issues.length === 0) {
    okCount++;
  } else {
    allIssues.push(...issues);
  }
}

// Group by severity
const grouped: Record<string, Issue[]> = {};
for (const issue of allIssues) {
  if (!grouped[issue.severity]) grouped[issue.severity] = [];
  grouped[issue.severity].push(issue);
}

const severityOrder: Severity[] = ['STUB', 'NO_ENTRY', 'MISSING_TRIGGER', 'MISSING_ETB', 'MISSING_ACTIVATED', 'WRONG_KEYWORD', 'MISSING_MODAL', 'CHAPTER_MISMATCH', 'MISSING_RING'];

console.log(`\n=== ${setCode.toUpperCase()} Oracle Audit (${cards.length} cards) ===\n`);

for (const sev of severityOrder) {
  const items = grouped[sev];
  if (!items || items.length === 0) continue;
  const icon = sev === 'STUB' || sev === 'NO_ENTRY' ? '❌' : '⚠️';
  console.log(`${icon} ${sev} (${items.length}):`);
  for (const item of items) {
    console.log(`   ${item.card} — ${item.detail}`);
  }
  console.log();
}

console.log(`✅ OK: ${okCount} cards`);
console.log(`⏭️ VANILLA/BASIC: ${vanillaCount} cards`);
console.log(`❌ ISSUES: ${allIssues.length} total across ${new Set(allIssues.map(i => i.card)).size} cards\n`);
