/**
 * Engine Integrity Audit Tool
 * 3 systematic audits to catch bugs BEFORE manual testing:
 *
 * 1. ORPHAN VALUES — target/type values in card-effects.ts without handlers in engine
 * 2. ORPHAN FLAGS — property keys in card-effects.ts never read by engine
 * 3. PENDING FLOWS — state._pending* set but never consumed
 *
 * Usage: npx tsx tools/engine-audit.ts
 *
 * Can also run individual audits:
 *   npx tsx tools/engine-audit.ts targets
 *   npx tsx tools/engine-audit.ts flags
 *   npx tsx tools/engine-audit.ts pending
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CARD_EFFECTS_PATH = path.join(ROOT, 'src/engine/card-effects.ts');
const ENGINE_FILES = [
  'src/engine/game-state.ts',
  'src/engine/stack-part2.ts',
  'src/engine/combat.ts',
  'src/engine/game-ai-part1.ts',
  'src/engine/game-ai-part2.ts',
  'src/engine/card-utils.ts',
  'src/engine/cards.ts',
].map(f => path.join(ROOT, f));

const UI_FILES = [
  'src/hooks/useGameEngine.ts',
  'src/components/GameScreen.tsx',
  'src/components/game/GameOverlays.tsx',
].map(f => path.join(ROOT, f));

const ALL_CONSUMER_FILES = [...ENGINE_FILES, ...UI_FILES];

function readFile(p: string): string {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; }
}

// ═══════════════════════════════════════════════════════════════
// AUDIT 1: Orphan target/type values
// ═══════════════════════════════════════════════════════════════

function auditOrphanValues() {
  const cardEffects = readFile(CARD_EFFECTS_PATH);
  const engineCode = ENGINE_FILES.map(readFile).join('\n');

  const issues: string[] = [];

  // --- Extract all effect `type:` values from card-effects.ts ---
  const typeValues = new Set<string>();
  const typeRegex = /\btype:\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = typeRegex.exec(cardEffects))) {
    typeValues.add(m[1]);
  }

  // Known meta-types that don't need a case handler
  const metaTypes = new Set([
    'has_keyword', 'ward', 'enters_tapped', 'add_mana', 'behold',
    'aura_grant_triggered', 'aura_grant_activated', 'aura_debuff',
    'aura_buff', 'aura_cant_attack_block', 'aura_prevent_untap', 'aura_remove_keywords',
    'modal', 'sacrifice', 'discard', 'behold_dragon_cast',
    'creatures_tap_for_mana', 'anthem_static', 'cost_reduction_static',
    'draw_replacement_empty_hand', 'life_gain_double_low_life',
    'prevent_noncombat_damage', 'cant_be_blocked', 'lord',
    'power_equal_creatures', 'toughness_equal_creatures',
    'pump_on_noncreature_cast', 'triggered', 'static',
    'transform', 'typecycling', 'mill_land_choice', 'affinity',
    'opponents_cant_gain_life', 'power_toughness_star',
    'enters_tapped_with_counters', 'conditional_hexproof_indestructible',
    'aura_remove_keywords',
  ]);

  for (const t of typeValues) {
    if (metaTypes.has(t)) continue;
    // Check if there's a case handler OR string reference for this type
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const casePattern = new RegExp(`case\\s+['"]${escaped}['"]`);
    const refPattern = new RegExp(`['"]${escaped}['"]`);
    if (!casePattern.test(engineCode) && !refPattern.test(engineCode)) {
      issues.push(`❌ type: "${t}" — no handler in engine`);
    }
  }

  // --- Extract all `target:` values from card-effects.ts ---
  const targetValues = new Set<string>();
  const targetRegex = /\btarget:\s*["']([^"']+)["']/g;
  while ((m = targetRegex.exec(cardEffects))) {
    targetValues.add(m[1]);
  }

  // Check each target value is referenced somewhere in the engine
  const knownTargets = new Set([
    'self', 'creature', 'opponent_creature', 'own_creature', 'player',
    'any', 'all', 'each', 'opponent', 'card', 'spell',
    // Handled via generic fallback in engine (verified working manually):
    'opponent_hand_nonland', 'artifacts_creatures_planeswalkers', 'colorless_nonland',
    'any_card', 'noncreature_nonland', 'instant_or_sorcery_in_gy',
  ]);

  for (const t of targetValues) {
    if (knownTargets.has(t)) continue;
    // Check if the target value appears anywhere in the engine code
    const targetPattern = new RegExp(`['"]${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
    if (!targetPattern.test(engineCode)) {
      issues.push(`⚠️  target: "${t}" — not referenced in engine files`);
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════
// AUDIT 2: Orphan flags (properties in card-effects.ts not read)
// ═══════════════════════════════════════════════════════════════

function auditOrphanFlags() {
  const cardEffects = readFile(CARD_EFFECTS_PATH);
  const consumerCode = ALL_CONSUMER_FILES.map(readFile).join('\n');

  const issues: string[] = [];

  // Extract all property keys used in card-effects.ts objects
  // Pattern: key: value (inside objects)
  const propKeys = new Set<string>();
  const propRegex = /\b([a-z_][a-z_0-9]*)\s*:/gi;
  let m: RegExpExecArray | null;
  while ((m = propRegex.exec(cardEffects))) {
    const key = m[1];
    // Skip common/obvious keys
    if (['type', 'target', 'amount', 'effects', 'event', 'self', 'keywords',
         'keyword', 'duration', 'power', 'toughness', 'name', 'cost',
         'modes', 'counter', 'condition', 'mana', 'colors', 'color',
         'count', 'tap', 'sacrifice', 'optional', 'subtype',
         'type_line', 'draw', 'discard', 'up_to',
    ].includes(key)) continue;
    propKeys.add(key);
  }

  // Known props that are handled implicitly or via generic spreading
  const knownProps = new Set([
    'cast', 'etb', 'triggered', 'activated', 'static', 'saga', 'chapters',
    'additional_costs', 'adventure', 'equip_cost', 'equip', 'cycling',
    'graveyard', 'gy_trigger', 'modal', 'aura_debuff', 'aura_buff',
    'self_cost_reduction', 'cost_reduction', 'flashback',
  ]);

  for (const key of propKeys) {
    if (knownProps.has(key)) continue;
    // Check if this property is ever read in consumer files
    // Patterns: .key, ['key'], key:, effect.key, etc.
    const readPattern = new RegExp(`\\.${key}\\b|\\['${key}'\\]|\\["${key}"\\]`);
    if (!readPattern.test(consumerCode)) {
      // Double check with a broader search
      const broadPattern = new RegExp(`\\b${key}\\b`);
      if (!broadPattern.test(consumerCode)) {
        issues.push(`❌ flag "${key}" — defined in card-effects.ts but never read in engine/UI`);
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════
// AUDIT 3: Pending flows (state._pending* set but never consumed)
// ═══════════════════════════════════════════════════════════════

function auditPendingFlows() {
  const engineCode = ENGINE_FILES.map(readFile).join('\n');
  const uiCode = UI_FILES.map(readFile).join('\n');
  const allCode = engineCode + '\n' + uiCode;

  const issues: string[] = [];

  // Find all state._pending* assignments
  const pendingSet = new Set<string>();
  const setRegex = /state\.(_pending\w+)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = setRegex.exec(allCode))) {
    pendingSet.add(m[1]);
  }

  // Pending states consumed indirectly via waitingForInput.type (not by reading _pending directly)
  // The UI renders overlays based on waitingForInput.type, and resolvers consume via engine functions
  const indirectlyConsumed = new Set([
    '_pendingLoot', '_pendingETBDestroy', '_pendingETBExile', '_pendingETBBounce',
    '_pendingETBTap', '_pendingETBCantBlock', '_pendingETBClone', '_pendingMoveCounters',
    '_pendingWhenYouDo', '_pendingGraveyardChoice', '_pendingActivationTapCreature',
    '_pendingActivationExileGY',
  ]);

  // For each _pending*, check if it's ever READ (not just assigned or nulled)
  for (const p of pendingSet) {
    if (indirectlyConsumed.has(p)) continue;
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Simple approach: count ALL mentions, then subtract assignments and clears
    const allMentions = (allCode.match(new RegExp(escaped, 'g')) || []).length;

    // Count sets (assignments including to null, delete)
    const setCount = (allCode.match(new RegExp(`(?:state|gs)\\.${escaped}\\s*=`, 'g')) || []).length;
    const deleteCount = (allCode.match(new RegExp(`delete\\s+(?:state|gs)\\.${escaped}`, 'g')) || []).length;
    const totalWrites = setCount + deleteCount;

    // If the only mentions are writes, it's never read
    if (allMentions <= totalWrites) {
      issues.push(`❌ ${p} — SET but never READ anywhere`);
      continue;
    }

    // Check if read in UI (for human flow)
    const uiMentions = (uiCode.match(new RegExp(escaped, 'g')) || []).length;
    const uiWrites = (uiCode.match(new RegExp(`(?:state|gs)\\.${escaped}\\s*=`, 'g')) || []).length
      + (uiCode.match(new RegExp(`delete\\s+(?:state|gs)\\.${escaped}`, 'g')) || []).length;

    const engineSets = (engineCode.match(new RegExp(`(?:state)\\.${escaped}\\s*=\\s*(?!null)`, 'g')) || []).length;

    if (engineSets > 0 && uiMentions <= uiWrites) {
      // Set in engine, never read in UI — BUT check if engine has a resolve function that reads it
      // (the UI calls the resolver, which reads the pending state in the engine)
      const engineMentions = (engineCode.match(new RegExp(escaped, 'g')) || []).length;
      const engineWriteCount = (engineCode.match(new RegExp(`(?:state)\\.${escaped}\\s*=`, 'g')) || []).length
        + (engineCode.match(new RegExp(`delete\\s+state\\.${escaped}`, 'g')) || []).length;
      // If engine has reads beyond writes (resolver functions consume it), it's fine
      if (engineMentions <= engineWriteCount + 1) { // +1 for a const/variable reference
        issues.push(`⚠️  ${p} — set in engine but never read in UI (human flow may be broken)`);
      }
    }

    // Check for waitingForInput type that matches but no overlay handles it
    // Find the waitingForInput type set alongside this pending
    const wiPattern = new RegExp(
      `${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,200}waitingForInput\\s*=\\s*\\{[^}]*type:\\s*['"]([^'"]+)['"]`,
      'g'
    );
    let wiMatch: RegExpExecArray | null;
    while ((wiMatch = wiPattern.exec(engineCode))) {
      const wiType = wiMatch[1];
      // Check if GameScreen handles this waitingForInput type
      const casePattern = new RegExp(`case\\s+['"]${wiType}['"]`);
      if (!casePattern.test(uiCode)) {
        issues.push(`❌ ${p} → waitingForInput type="${wiType}" — no case handler in UI`);
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

const mode = process.argv[2]?.toLowerCase();

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║         ENGINE INTEGRITY AUDIT                  ║');
console.log('╚══════════════════════════════════════════════════╝\n');

let totalIssues = 0;

if (!mode || mode === 'targets' || mode === 'all') {
  console.log('━━━ AUDIT 1: Orphan Values (type/target without handler) ━━━\n');
  const issues = auditOrphanValues();
  if (issues.length === 0) {
    console.log('  ✅ All type/target values have handlers\n');
  } else {
    issues.forEach(i => console.log(`  ${i}`));
    console.log(`\n  Total: ${issues.length} issues\n`);
  }
  totalIssues += issues.length;
}

if (!mode || mode === 'flags' || mode === 'all') {
  console.log('━━━ AUDIT 2: Orphan Flags (card-effects props not read) ━━━\n');
  const issues = auditOrphanFlags();
  if (issues.length === 0) {
    console.log('  ✅ All flags are consumed by engine/UI\n');
  } else {
    issues.forEach(i => console.log(`  ${i}`));
    console.log(`\n  Total: ${issues.length} issues\n`);
  }
  totalIssues += issues.length;
}

if (!mode || mode === 'pending' || mode === 'all') {
  console.log('━━━ AUDIT 3: Pending Flows (set but never consumed) ━━━\n');
  const issues = auditPendingFlows();
  if (issues.length === 0) {
    console.log('  ✅ All _pending flows have consumers\n');
  } else {
    issues.forEach(i => console.log(`  ${i}`));
    console.log(`\n  Total: ${issues.length} issues\n`);
  }
  totalIssues += issues.length;
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (totalIssues === 0) {
  console.log('✅ ALL CLEAN — No integrity issues found!');
} else {
  console.log(`⚠️  TOTAL: ${totalIssues} issues found`);
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('💡 Combine with Scryfall oracle audit:');
console.log('   npx tsx tools/oracle-audit.ts ltr');
console.log('   npx tsx tools/oracle-audit.ts tdm\n');
