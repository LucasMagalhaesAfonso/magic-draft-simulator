#!/usr/bin/env node
// audit-new-project.js
// Audits card-effects.ts against the new TypeScript engine
// Checks 3 layers: Data (card-effects.ts), Engine (stack), UI/AI (targeting)
// Usage: node tools/audit-new-project.js [cardName]  (or no args for full audit)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CARD_EFFECTS = path.join(ROOT, 'src/engine/card-effects.ts');
const STACK_PART1  = path.join(ROOT, 'src/engine/stack-part1.ts');
const STACK_PART2  = path.join(ROOT, 'src/engine/stack-part2.ts');
const GAME_STATE   = path.join(ROOT, 'src/engine/game-state.ts');
const AI_PART2     = path.join(ROOT, 'src/engine/game-ai-part2.ts');
const SCRYFALL_TDM = path.join(ROOT, 'legacy-pure-js/js/data/scryfall-tdm.json');

// ─── Load Scryfall oracle text ─────────────────────────────────────────────
function loadOracleTexts() {
  const oracleMap = {}; // lowercase name → oracle_text
  try {
    const raw = fs.readFileSync(SCRYFALL_TDM, 'utf8');
    const jsonStart = raw.indexOf('{');
    const data = JSON.parse(raw.slice(jsonStart));
    for (const card of (data.cards || [])) {
      const name = (card.name || '').toLowerCase();
      const oracle = card.oracle_text || '';
      oracleMap[name] = oracle;
      // Also index card_faces for adventure/DFC
      if (card.card_faces) {
        for (const face of card.card_faces) {
          const faceName = (face.name || '').toLowerCase();
          if (faceName) oracleMap[faceName] = face.oracle_text || oracle;
        }
      }
    }
  } catch (e) {
    // Scryfall JSON not available — checks A/B that need it will be skipped
  }
  return oracleMap;
}

// ─── Parse card-effects.ts ──────────────────────────────────────────────────
function parseCardEffects() {
  const src = fs.readFileSync(CARD_EFFECTS, 'utf8');
  const cards = {};

  // Extract each card entry: "card name": { ... }
  // Strategy: find all top-level keys (lines starting with a quoted string followed by colon inside CardEffectsDB)
  const lines = src.split('\n');
  let currentCard = null;
  let depth = 0;
  let inDB = false;
  let cardStart = 0;
  let cardLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inDB && line.includes('export const CardEffectsDB')) {
      inDB = true;
      depth = 1;
      continue;
    }
    if (!inDB) continue;

    // Save depth BEFORE counting braces on this line
    const prevDepth = depth;

    // Count brace depth
    for (const ch of line) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }

    if (prevDepth === 1) {
      // Was at top level before this line — look for card entry start
      const m = line.match(/^\s+"([^"]+)"\s*:/);
      if (m) {
        currentCard = m[1];
        cardLines = [line];
        cardStart = i;
      }
    } else if (prevDepth > 1 && currentCard) {
      cardLines.push(line);
      // Check if we've closed back to depth 1
      if (depth === 1) {
        // Extract all effect types and fields from cardLines
        const blob = cardLines.join('\n');
        cards[currentCard] = analyzeCardBlob(blob, currentCard);
        currentCard = null;
        cardLines = [];
      }
    }
  }

  return cards;
}

function analyzeCardBlob(blob, cardName) {
  const info = {
    name: cardName,
    raw: blob,
    effectTypes: new Set(),
    triggerEvents: new Set(),
    targetTypes: new Set(),
    hasCast: false,
    hasEtb: false,
    hasTriggered: false,
    hasActivated: false,
    hasStatic: false,
    hasGraveyard: false,
    hasChapters: false,
    conditionalLogic: [],
  };

  // Detect top-level sections
  if (blob.includes('cast:') || blob.includes('cast :[')) info.hasCast = true;
  if (blob.includes('etb:')) info.hasEtb = true;
  if (blob.includes('triggered:')) info.hasTriggered = true;
  if (blob.includes('activated:')) info.hasActivated = true;
  if (blob.includes('static:')) info.hasStatic = true;
  if (blob.includes('graveyard:')) info.hasGraveyard = true;
  if (blob.includes('chapters:')) info.hasChapters = true;

  // Extract all type: "xxx" values — use \b to avoid matching land_type, subtype, counter_type etc.
  const typeMatches = blob.matchAll(/\btype\s*:\s*["']([^"']+)["']/g);
  for (const m of typeMatches) {
    info.effectTypes.add(m[1]);
  }

  // Extract all event: "xxx" values
  const eventMatches = blob.matchAll(/event\s*:\s*["']([^"']+)["']/g);
  for (const m of eventMatches) {
    info.triggerEvents.add(m[1]);
  }

  // Extract all target: "xxx" values
  const targetMatches = blob.matchAll(/target\s*:\s*["']([^"']+)["']/g);
  for (const m of targetMatches) {
    info.targetTypes.add(m[1]);
  }

  // Detect conditional logic patterns (potential parser issues)
  if (blob.includes('condition:')) {
    const condMatches = [...blob.matchAll(/condition\s*:\s*["']([^"']+)["']/g)];
    info.conditionalLogic = condMatches.map(m => m[1]);
  }

  return info;
}

// ─── Build known stacks ──────────────────────────────────────────────────────
function getKnownEffectTypes() {
  const types = new Set();
  const src1 = fs.readFileSync(STACK_PART1, 'utf8');
  const src2 = fs.readFileSync(STACK_PART2, 'utf8');
  const gsrc = fs.readFileSync(GAME_STATE, 'utf8');

  // Also scan game-state.ts _resolveSimpleEffect which handles many cases
  const combined = src1 + src2 + gsrc;
  // Match case 'xxx': switch cases
  const caseMatches = combined.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g);
  for (const m of caseMatches) {
    types.add(m[1]);
  }
  // Also match s.type === 'xxx' and effect.type === 'xxx' style checks in game-state.ts
  const typeEqMatches = gsrc.matchAll(/[a-z]\.type\s*===\s*['"]([^'"]+)['"]/g);
  for (const m of typeEqMatches) {
    types.add(m[1]);
  }
  return types;
}

function getKnownTriggerEvents() {
  const events = new Set();
  const src = fs.readFileSync(GAME_STATE, 'utf8');
  // Look for fireTrigger(state, 'xxx') calls
  const matches = src.matchAll(/fireTrigger\s*\([^,]+,\s*['"]([^'"]+)['"]/g);
  for (const m of matches) {
    events.add(m[1]);
  }
  // Also look for trigger.event === 'xxx'
  const eventChecks = src.matchAll(/trigger\.event\s*===\s*['"]([^'"]+)['"]/g);
  for (const m of eventChecks) {
    events.add(m[1]);
  }
  return events;
}

function getAITargetingCoverage() {
  const covered = new Set();
  const src = fs.readFileSync(AI_PART2, 'utf8');
  // Find all case 'xxx' in the _chooseTargets switch
  const inChooseTargets = src.slice(src.indexOf('export function _chooseTargets'));
  const caseMatches = inChooseTargets.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g);
  for (const m of caseMatches) {
    covered.add(m[1]);
  }
  return covered;
}

function getKnownConditions() {
  const conditions = new Set();
  const src = fs.readFileSync(GAME_STATE, 'utf8');
  // Look for condition strings in _checkEffectCondition and _checkTriggerCondition
  const matches = src.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g);
  for (const m of matches) {
    conditions.add(m[1]);
  }
  // Also string comparisons
  const strMatches = src.matchAll(/condition\s*===\s*['"]([^'"]+)['"]/g);
  for (const m of strMatches) {
    conditions.add(m[1]);
  }
  return conditions;
}

// ─── CHECK A: P/T condicional no oracle text ──────────────────────────────
// Se o oracle text tem "during your turn, this creature has base power and toughness X/Y",
// o card DEVE ter static: [{ type: "conditional_buff", condition: "your_turn" }]
function checkA_ConditionalPT(cardInfo, oracleText) {
  if (!oracleText) return null;
  const oracle = oracleText.toLowerCase();

  // Padrão: "during your turn, this creature has base power and toughness"
  const hasDuringYourTurnPT = /during your turn[^.]*(?:has base|gets|becomes) [^.]*(?:power and toughness|\d+\/\d+)/i.test(oracle);
  if (!hasDuringYourTurnPT) return null;

  // Verificar se tem conditional_buff com your_turn no DB
  const blob = cardInfo.raw;
  const hasConditionalBuff = /type\s*:\s*["']conditional_buff["']/.test(blob);
  const hasYourTurnCond    = /condition\s*:\s*["']your_turn["']/.test(blob);

  if (!hasConditionalBuff || !hasYourTurnCond) {
    return `❌ [CHECK-A] Oracle: "during your turn, base P/T changes" → DB deve ter static conditional_buff com condition:"your_turn" (tem conditional_buff:${hasConditionalBuff}, your_turn:${hasYourTurnCond})`;
  }
  return null; // OK
}

// ─── CHECK B: Spell com dois alvos em lados opostos ───────────────────────
// Se um cast: array tem effect com target:"own_creature" E outro com target:"opponent_creature"
// (ou type:"fight"), a UI de targeting single-step vai selecionar o alvo errado para um dos efeitos.
// Esses spells precisam de two-step targeting ou lógica especial no stack.
function checkB_TwoSidedTargets(cardInfo) {
  const blob = cardInfo.raw;
  if (!cardInfo.hasCast) return null;

  // Extrair o bloco cast: [...] para analisar isoladamente
  const castMatch = blob.match(/cast\s*:\s*\[[\s\S]*?\](?=\s*[,}])/);
  if (!castMatch) return null;
  const castBlob = castMatch[0];

  const hasOwnTarget = /target\s*:\s*["']own_creature["']/.test(castBlob);
  const hasOppTarget = /target\s*:\s*["']opponent_creature["']/.test(castBlob);
  const hasFight     = /type\s*:\s*["']fight["']/.test(castBlob);

  // "own_creature" + "opponent_creature" OU "own_creature" + "fight"
  if (hasOwnTarget && (hasOppTarget || hasFight)) {
    return `⚠️  [CHECK-B] Cast tem alvos em lados opostos (own_creature + ${hasFight ? 'fight' : 'opponent_creature'}). UI single-step vai aplicar buff/efeito no alvo errado. Verificar se getMultiTargetSteps() cobre este card.`;
  }
  return null;
}

// ─── AUDIT ───────────────────────────────────────────────────────────────────
function auditCard(cardInfo, knownEffects, knownEvents, aiCoverage, knownConditions, oracleTexts) {
  const issues = [];
  const warnings = [];
  const ok = [];

  // Layer 1: Effect types in stack
  for (const type of cardInfo.effectTypes) {
    // Skip meta-types that aren't stack-resolved effect resolvers:
    // - Static abilities (handled by static system, not stack)
    // - Mana production (handled by ManaSystem, not stack)
    // - Additional cost types (handled by castSpell, not stack)
    // - Data-model fields with type: inside special objects (affinity, etc.)
    const metaTypes = new Set([
      // Static abilities
      'has_keyword', 'buff_all', 'cost_reduction', 'token_doubling',
      'double_damage', 'anthem', 'cant_be_blocked_by_smaller', 'conditional_buff',
      'etb_counters_if_second_spell', 'enters_tapped_conditional', 'prevent_activated_abilities',
      'vivid_power', 'dynamic_power', 'dynamic_toughness', 'keyword_only',
      'enters_tapped', 'conditional_flash', 'uncounterable', 'prevent_opponent_casting',
      'power_equals', 'warrior_tokens_protected_end_step', 'grant_delve', 'grant_flash',
      'unblockable', 'dragon_etb_counter', 'static_ability',
      // Mana production (handled by ManaSystem, not stack)
      'add_mana',
      // Additional cost / behold system (handled by castSpell pre-processing)
      'behold', 'behold_dragon',
      // Affinity data field (affinity: { type: "creatures" }) — not an effect
      'creatures', 'artifacts',
    ]);
    if (metaTypes.has(type)) { ok.push(`static[${type}]`); continue; }

    if (!knownEffects.has(type)) {
      issues.push(`❌ [STACK] Effect type "${type}" has NO case in stack resolver`);
    } else {
      ok.push(`✅ [STACK] ${type}`);
    }
  }

  // Layer 2: Trigger events
  for (const event of cardInfo.triggerEvents) {
    if (!knownEvents.has(event)) {
      issues.push(`❌ [TRIGGER] Event "${event}" never fired in game-state.ts`);
    } else {
      ok.push(`✅ [TRIGGER] ${event}`);
    }
  }

  // Layer 3: AI targeting coverage for targeted effects
  const NEEDS_AI_TARGET = new Set([
    'damage', 'destroy', 'exile', 'bounce', 'buff', 'debuff', 'counter',
    'fight', 'tap', 'untap', 'grant', 'gain_control', 'stun', 'remove_counters',
    'create_token_copy', 'clone', 'become_copy', 'mass_clone', 'move_counters',
    'threaten', 'counter_spell', 'regenerate', 'bounce_to_library_top',
    'grant_counter', 'grant_counters', 'return_from_graveyard', 'grant_harmonize',
    'damage_divided', 'multi_buff_up_to'
  ]);

  for (const type of cardInfo.effectTypes) {
    if (NEEDS_AI_TARGET.has(type)) {
      // Check if any target type suggests this needs AI targeting
      const hasTarget = [...cardInfo.targetTypes].some(t =>
        !t.includes('all') && !t.includes('each') && !t.includes('self') &&
        t !== 'own_creatures' && t !== 'creatures_and_enchantments'
      );
      if (hasTarget && !aiCoverage.has(type)) {
        warnings.push(`⚠️  [AI] Effect "${type}" has target but no case in _chooseTargets`);
      }
    }
  }

  // Layer 3b: Unknown conditions
  // Conditions that are in special non-effect fields (cost_reduction, conditional_cost etc.)
  // are handled separately in the engine and don't go through _checkEffectCondition
  const specialFieldConditions = new Set([
    'target_dragon',           // conditional_cost field (Dragon's Prey)
    'per_attacking_creature',  // cost_reduction field (Static Snare)
    'per_creature_power4_or_greater', // cost_reduction field (Spectral Denial)
    'second_spell',            // self_cost_reduction field
    'behold_dragon',           // conditional_flash static field
    'frostcliff_jeskai_mode', 'frostcliff_temur_mode', 'glacierwood_temur_mode', // modal mode conditions
    'any_number',              // search_library amount modifier
  ]);
  for (const cond of cardInfo.conditionalLogic) {
    if (specialFieldConditions.has(cond)) {
      ok.push(`static-cond[${cond}]`);
      continue;
    }
    if (!knownConditions.has(cond)) {
      issues.push(`❌ [CONDITION] "${cond}" not handled in engine`);
    } else {
      ok.push(`✅ [CONDITION] ${cond}`);
    }
  }

  // ── Check A: P/T condicional (oracle text → DB) ──────────────────────────
  const oracleText = oracleTexts ? (oracleTexts[cardInfo.name] || '') : '';
  const checkAResult = checkA_ConditionalPT(cardInfo, oracleText);
  if (checkAResult) {
    issues.push(checkAResult);
  } else if (oracleText && /during your turn/i.test(oracleText)) {
    ok.push('✅ [CHECK-A] conditional_buff your_turn presente');
  }

  // ── Check B: Cast com dois alvos em lados opostos ────────────────────────
  const checkBResult = checkB_TwoSidedTargets(cardInfo);
  if (checkBResult) {
    warnings.push(checkBResult);
  }

  return { issues, warnings, ok };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
function main() {
  const filterCard = process.argv[2] ? process.argv[2].toLowerCase() : null;

  console.log('Loading engine knowledge...');
  const knownEffects = getKnownEffectTypes();
  const knownEvents = getKnownTriggerEvents();
  const aiCoverage = getAITargetingCoverage();
  const knownConditions = getKnownConditions();
  const oracleTexts = loadOracleTexts();

  console.log(`  Stack effect types: ${knownEffects.size}`);
  console.log(`  Known trigger events: ${knownEvents.size}`);
  console.log(`  AI targeting cases: ${aiCoverage.size}`);
  console.log(`  Known conditions: ${knownConditions.size}`);
  console.log(`  Oracle texts loaded: ${Object.keys(oracleTexts).length} (for checks A/B)`);

  console.log('\nParsing card-effects.ts...');
  const cards = parseCardEffects();
  const allCardNames = Object.keys(cards);
  console.log(`  Found ${allCardNames.length} card entries\n`);

  const toAudit = filterCard
    ? allCardNames.filter(n => n.includes(filterCard))
    : allCardNames;

  if (toAudit.length === 0) {
    console.log(`No cards matching "${filterCard}"`);
    return;
  }

  let totalIssues = 0;
  let totalWarnings = 0;
  let cardsWithIssues = 0;
  const issueList = [];
  const warningList = [];

  for (const name of toAudit) {
    const info = cards[name];
    const { issues, warnings } = auditCard(info, knownEffects, knownEvents, aiCoverage, knownConditions, oracleTexts);

    if (issues.length > 0 || warnings.length > 0) {
      cardsWithIssues++;
      totalIssues += issues.length;
      totalWarnings += warnings.length;

      if (filterCard || issues.length > 0) {
        console.log(`\n── ${name} ──`);
        issues.forEach(i => { console.log(`  ${i}`); issueList.push(`${name}: ${i}`); });
        warnings.forEach(w => { console.log(`  ${w}`); warningList.push(`${name}: ${w}`); });
      } else {
        // Only warnings, collect silently
        warningList.push(...warnings.map(w => `${name}: ${w}`));
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('AUDIT SUMMARY');
  console.log('='.repeat(70));
  console.log(`Cards audited:    ${toAudit.length}`);
  console.log(`Cards with issues: ${cardsWithIssues}`);
  console.log(`Total ❌ issues:   ${totalIssues}`);
  console.log(`Total ⚠️  warnings: ${totalWarnings}`);

  if (totalIssues > 0) {
    console.log('\n── CRITICAL ISSUES (❌) ──');
    issueList.forEach(i => console.log(`  ${i}`));
  }

  if (totalWarnings > 0 && (filterCard || totalWarnings < 30)) {
    console.log('\n── WARNINGS (⚠️) ──');
    warningList.forEach(w => console.log(`  ${w}`));
  } else if (totalWarnings > 0) {
    console.log(`\n  (${totalWarnings} AI targeting warnings — run with card name to see details)`);
  }

  // Save report
  const report = [
    `Audit run: ${new Date().toISOString()}`,
    `Cards: ${toAudit.length}, Issues: ${totalIssues}, Warnings: ${totalWarnings}`,
    '',
    '=== CRITICAL ISSUES ===',
    ...issueList,
    '',
    '=== WARNINGS ===',
    ...warningList,
  ].join('\n');

  const reportPath = path.join(ROOT, 'tools/audit-report.txt');
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport saved to tools/audit-report.txt`);
}

main();
