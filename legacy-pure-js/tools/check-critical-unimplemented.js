/**
 * Verifica definições CRÍTICAS não implementadas (ignora false positives)
 */

const fs = require('fs');
const path = require('path');

const gameStatePath = path.join(__dirname, '../js/game/game-state.js');
const stackPath = path.join(__dirname, '../js/game/stack.js');
const gameAiPath = path.join(__dirname, '../js/game/game-ai.js');
const uiGamePath = path.join(__dirname, '../js/ui-game.js');
const cardsPath = path.join(__dirname, '../js/game/cards.js');
const cardEffectsPath = path.join(__dirname, '../js/data/card-effects.js');

const gameStateCode = fs.readFileSync(gameStatePath, 'utf8');
const stackCode = fs.readFileSync(stackPath, 'utf8');
const gameAiCode = fs.readFileSync(gameAiPath, 'utf8');
const uiGameCode = fs.readFileSync(uiGamePath, 'utf8');
const cardsCode = fs.readFileSync(cardsPath, 'utf8');
const cardEffectsCode = fs.readFileSync(cardEffectsPath, 'utf8');

// Known false positives (these are handled differently)
const STATIC_EFFECTS = ['has_keyword', 'cost_reduction', 'token_doubling', 'prevent_activated_abilities',
                        'conditional_flash', 'grant_delve', 'static_ability', 'Dragon', 'basic',
                        'basic_mountain', 'basic_forest', 'creatures', 'warrior_tokens_protected_end_step',
                        'enters_tapped', 'enters_tapped_conditional', 'cant_be_blocked_by_smaller',
                        'power_equals', 'unblockable', 'loses_abilities', 'prevent_opponent_casting',
                        'double_damage', 'uncounterable', 'aura_prevent_untap', 'aura_debuff'];

const HANDLED_IN_CARDS_JS = ['behold', 'behold_dragon', 'add_mana'];

const HANDLED_SPECIALLY = ['etb_counters_if_second_spell', 'dragon_etb_counter',
                           'conditional_discard_return', 'conditional_buff', 'grant_flash'];

// Extract all effect types from CardEffectsDB
const effectTypes = new Set();
const targetTypes = new Set();
const conditionTypes = new Set();

const effectMatches = cardEffectsCode.matchAll(/type:\s*["']([^"']+)["']/g);
for (const match of effectMatches) {
  effectTypes.add(match[1]);
}

const targetMatches = cardEffectsCode.matchAll(/target:\s*["']([^"']+)["']/g);
for (const match of targetMatches) {
  targetTypes.add(match[1]);
}

const conditionMatches = cardEffectsCode.matchAll(/condition:\s*["']([^"']+)["']/g);
for (const match of conditionMatches) {
  conditionTypes.add(match[1]);
}

console.log('\n========== CRITICAL UNIMPLEMENTED DEFINITIONS ==========\n');

// Check CRITICAL effect types (not static or special handling)
console.log('📦 CRITICAL EFFECT TYPES (excluding static/special handling)');

const criticalUnimplementedEffects = [];
for (const effectType of Array.from(effectTypes).sort()) {
  // Skip false positives
  if (STATIC_EFFECTS.includes(effectType) || HANDLED_IN_CARDS_JS.includes(effectType) || HANDLED_SPECIALLY.includes(effectType)) {
    continue;
  }

  const caseRegex = new RegExp(`case\\s+['"]${effectType}['"]\\s*:`, 'g');
  const inStack = caseRegex.test(stackCode);

  if (!inStack) {
    criticalUnimplementedEffects.push(effectType);
  }
}

if (criticalUnimplementedEffects.length > 0) {
  console.log(`❌ MISSING IN stack.js (${criticalUnimplementedEffects.length}):`);
  criticalUnimplementedEffects.forEach(e => console.log(`  - ${e}`));
} else {
  console.log('✅ All critical effect types implemented');
}

// Check TARGET types (filter out many that are handled in targeting logic)
console.log('\n\n🎯 CRITICAL TARGET TYPES');

const KNOWN_TARGETS = [
  'any_graveyard', 'any_player', 'card', 'basic_land', 'basic_forest',
  'exiled_creature', 'named_card', 'enchanted', 'equipped', 'source_controller',
  'same_creature', 'self_creature', 'entering_creature', 'next_spell',
  'damaged_player', 'instant_or_sorcery_in_gy'
];

const criticalUnimplementedTargets = [];
for (const targetType of Array.from(targetTypes).sort()) {
  if (KNOWN_TARGETS.includes(targetType)) continue;

  const mentioned = new RegExp(`['"]${targetType}['"]`, 'g');
  const inAi = mentioned.test(gameAiCode);
  const inUi = mentioned.test(uiGameCode);
  const inStack = mentioned.test(stackCode);

  if (!inAi && !inUi && !inStack) {
    criticalUnimplementedTargets.push(targetType);
  }
}

if (criticalUnimplementedTargets.length > 0) {
  console.log(`❌ NOT FOUND IN CODE (${criticalUnimplementedTargets.length}):`);
  criticalUnimplementedTargets.forEach(t => console.log(`  - ${t}`));
} else {
  console.log('✅ All critical target types mentioned in code');
}

// Check CONDITION types
console.log('\n\n🔍 CRITICAL CONDITION TYPES');

const KNOWN_CONDITIONS = ['second_spell', 'per_power4_creature', 'per_creature_power4_or_greater',
                          'any_number', 'own_creature_entering', 'per_attacking_creature',
                          'target_dragon', '3+_attacking'];

const criticalUnimplementedConditions = [];
for (const conditionType of Array.from(conditionTypes).sort()) {
  if (KNOWN_CONDITIONS.includes(conditionType)) continue;

  const caseRegex = new RegExp(`case\\s+['"]${conditionType}['"]\\s*:`, 'g');
  const inGameState = caseRegex.test(gameStateCode);

  const mentioned = new RegExp(`['"]${conditionType}['"]`, 'g');
  const inStack = mentioned.test(stackCode);
  const inAi = mentioned.test(gameAiCode);

  if (!inGameState && !inStack && !inAi) {
    criticalUnimplementedConditions.push(conditionType);
  }
}

if (criticalUnimplementedConditions.length > 0) {
  console.log(`❌ NOT FOUND IN CODE (${criticalUnimplementedConditions.length}):`);
  criticalUnimplementedConditions.forEach(c => console.log(`  - ${c}`));
} else {
  console.log('✅ All critical condition types mentioned in code');
}

// Now check for ACTUAL BUGS: cards using these unimplemented definitions
console.log('\n\n🐛 CARDS USING UNIMPLEMENTED DEFINITIONS');

const allUnimplemented = [
  ...criticalUnimplementedEffects,
  ...criticalUnimplementedTargets,
  ...criticalUnimplementedConditions
];

if (allUnimplemented.length === 0) {
  console.log('✅ No unimplemented definitions found!');
} else {
  console.log(`\nSearching for cards using ${allUnimplemented.length} unimplemented definitions...\n`);

  const affectedCards = [];

  for (const def of allUnimplemented) {
    const regex = new RegExp(`["']([^"']+)["']\\s*:\\s*\\{[^}]*(?:type|target|condition):\\s*["']${def}["']`, 'gs');
    const matches = cardEffectsCode.matchAll(regex);

    for (const match of matches) {
      affectedCards.push({ card: match[1], definition: def, type: 'unknown' });
    }
  }

  if (affectedCards.length > 0) {
    console.log(`❌ ${affectedCards.length} card(s) affected:\n`);
    const grouped = {};
    affectedCards.forEach(a => {
      if (!grouped[a.definition]) grouped[a.definition] = [];
      grouped[a.definition].push(a.card);
    });

    Object.entries(grouped).forEach(([def, cards]) => {
      console.log(`  ${def}:`);
      cards.forEach(card => console.log(`    - ${card}`));
    });
  }
}

// Summary
console.log('\n\n========== SUMMARY ==========');
const total = criticalUnimplementedEffects.length + criticalUnimplementedTargets.length +
              criticalUnimplementedConditions.length;

if (total === 0) {
  console.log('✅ NO CRITICAL ISSUES FOUND! 🎉');
} else {
  console.log(`⚠️  TOTAL CRITICAL UNIMPLEMENTED: ${total}`);
  console.log(`   - Effects: ${criticalUnimplementedEffects.length}`);
  console.log(`   - Targets: ${criticalUnimplementedTargets.length}`);
  console.log(`   - Conditions: ${criticalUnimplementedConditions.length}`);
}

console.log('\n');
