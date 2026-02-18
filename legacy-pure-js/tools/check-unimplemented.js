/**
 * Verifica definições no CardEffectsDB que não estão implementadas no código
 */

const fs = require('fs');
const path = require('path');

// Read all game files
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

// Extract all effect types from CardEffectsDB
const effectTypes = new Set();
const targetTypes = new Set();
const conditionTypes = new Set();
const eventTypes = new Set();

// Regex to find effect types
const effectMatches = cardEffectsCode.matchAll(/type:\s*["']([^"']+)["']/g);
for (const match of effectMatches) {
  effectTypes.add(match[1]);
}

// Regex to find target types
const targetMatches = cardEffectsCode.matchAll(/target:\s*["']([^"']+)["']/g);
for (const match of targetMatches) {
  targetTypes.add(match[1]);
}

// Regex to find condition types
const conditionMatches = cardEffectsCode.matchAll(/condition:\s*["']([^"']+)["']/g);
for (const match of conditionMatches) {
  conditionTypes.add(match[1]);
}

// Regex to find event types
const eventMatches = cardEffectsCode.matchAll(/event:\s*["']([^"']+)["']/g);
for (const match of eventMatches) {
  eventTypes.add(match[1]);
}

console.log('\n========== UNIMPLEMENTED DEFINITIONS CHECK ==========\n');

// Check effect types
console.log('📦 EFFECT TYPES');
console.log(`Total unique effect types in CardEffectsDB: ${effectTypes.size}\n`);

const unimplementedEffects = [];
for (const effectType of Array.from(effectTypes).sort()) {
  // Check if implemented in stack.js (case 'effect_type':)
  const caseRegex = new RegExp(`case\\s+['"]${effectType}['"]\\s*:`, 'g');
  const inStack = caseRegex.test(stackCode);

  if (!inStack) {
    unimplementedEffects.push(effectType);
  }
}

if (unimplementedEffects.length > 0) {
  console.log(`❌ UNIMPLEMENTED (${unimplementedEffects.length}):`);
  unimplementedEffects.forEach(e => console.log(`  - ${e}`));
} else {
  console.log('✅ All effect types implemented in stack.js');
}

// Check target types
console.log('\n\n🎯 TARGET TYPES');
console.log(`Total unique target types in CardEffectsDB: ${targetTypes.size}\n`);

const unimplementedTargets = [];
for (const targetType of Array.from(targetTypes).sort()) {
  // Check in game-ai.js (_chooseTargets)
  const aiRegex = new RegExp(`['"]${targetType}['"]`, 'g');
  const inAi = aiRegex.test(gameAiCode);

  // Check in ui-game.js (hasValidTargets or targeting logic)
  const inUi = aiRegex.test(uiGameCode);

  if (!inAi && !inUi) {
    unimplementedTargets.push(targetType);
  }
}

if (unimplementedTargets.length > 0) {
  console.log(`❌ UNIMPLEMENTED (${unimplementedTargets.length}):`);
  unimplementedTargets.forEach(t => console.log(`  - ${t}`));
} else {
  console.log('✅ All target types implemented in game-ai.js or ui-game.js');
}

// Check condition types
console.log('\n\n🔍 CONDITION TYPES');
console.log(`Total unique condition types in CardEffectsDB: ${conditionTypes.size}\n`);

const unimplementedConditions = [];
for (const conditionType of Array.from(conditionTypes).sort()) {
  // Check in game-state.js (_checkEffectCondition or _checkTriggerCondition)
  const condRegex = new RegExp(`case\\s+['"]${conditionType}['"]\\s*:`, 'g');
  const inGameState = condRegex.test(gameStateCode);

  // Also check if mentioned anywhere in stack.js
  const condMentionRegex = new RegExp(`['"]${conditionType}['"]`, 'g');
  const inStack = condMentionRegex.test(stackCode);

  if (!inGameState && !inStack) {
    unimplementedConditions.push(conditionType);
  }
}

if (unimplementedConditions.length > 0) {
  console.log(`❌ UNIMPLEMENTED (${unimplementedConditions.length}):`);
  unimplementedConditions.forEach(c => console.log(`  - ${c}`));
} else {
  console.log('✅ All condition types implemented in game-state.js or stack.js');
}

// Check event types
console.log('\n\n⚡ EVENT TYPES (Triggers)');
console.log(`Total unique event types in CardEffectsDB: ${eventTypes.size}\n`);

const unimplementedEvents = [];
for (const eventType of Array.from(eventTypes).sort()) {
  // Check in game-state.js (fireTrigger)
  const eventRegex = new RegExp(`event\\s*===\\s*['"]${eventType}['"]`, 'g');
  const inGameState = eventRegex.test(gameStateCode);

  // Also check if trigger event is registered anywhere
  const eventMentionRegex = new RegExp(`['"]${eventType}['"]`, 'g');
  const mentionedInGameState = eventMentionRegex.test(gameStateCode);

  if (!inGameState && !mentionedInGameState) {
    unimplementedEvents.push(eventType);
  }
}

if (unimplementedEvents.length > 0) {
  console.log(`❌ UNIMPLEMENTED (${unimplementedEvents.length}):`);
  unimplementedEvents.forEach(e => console.log(`  - ${e}`));
} else {
  console.log('✅ All event types implemented in game-state.js');
}

// Summary
console.log('\n\n========== SUMMARY ==========');
const totalUnimplemented = unimplementedEffects.length + unimplementedTargets.length +
                          unimplementedConditions.length + unimplementedEvents.length;

if (totalUnimplemented === 0) {
  console.log('✅ ALL DEFINITIONS IMPLEMENTED! 🎉');
} else {
  console.log(`❌ TOTAL UNIMPLEMENTED: ${totalUnimplemented}`);
  console.log(`   - Effects: ${unimplementedEffects.length}`);
  console.log(`   - Targets: ${unimplementedTargets.length}`);
  console.log(`   - Conditions: ${unimplementedConditions.length}`);
  console.log(`   - Events: ${unimplementedEvents.length}`);
}

console.log('\n');
