#!/usr/bin/env node
/**
 * add-trigger-conditions.js
 * Gera as correções necessárias para adicionar conditions aos 25 triggers
 *
 * Estratégia:
 * - attacks: Já validados no engine, adicionar "attacks_self" para documentação
 * - combat_damage_player: Já validados, adicionar "self_combat_damage_player"
 * - dies: Já validados, adicionar "dies_self"
 * - becomes_tapped: Já validados, adicionar "self_becomes_tapped"
 * - second_spell: JÁ FIXADO (Equilibrium Adept + Jeskai Devotee)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dbPath = path.join(__dirname, '../js/data/card-effects.js');
const content = fs.readFileSync(dbPath, 'utf8');

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} }
};
vm.createContext(sandbox);
const modified = content.replace(/\bconst CardEffectsDB\s*=/, 'var CardEffectsDB =');
vm.runInContext(modified, sandbox);

const DB = sandbox.CardEffectsDB;
const cards = Object.keys(DB).filter(k => !k.startsWith('_') && typeof DB[k] === 'object');

const needsFix = [];

for (const cardName of cards) {
  const entry = DB[cardName];
  if (!entry.triggered) continue;

  for (const trig of entry.triggered) {
    // Skip if already has condition
    if (trig.condition) continue;

    // Skip second_spell (already have 2 fixed)
    if (trig.event === 'second_spell') continue;

    if (trig.self) {
      needsFix.push({
        card: cardName,
        event: trig.event,
        needsCondition: true,
        suggestedCondition: getSuggestedCondition(trig.event)
      });
    }
  }
}

function getSuggestedCondition(event) {
  // These events already validate self in engine, but adding condition for clarity
  switch (event) {
    case 'attacks': return 'attacks_self';
    case 'combat_damage_player': return 'self_combat_damage_player';
    case 'dies': return 'dies_self';
    case 'becomes_tapped': return 'self_becomes_tapped';
    case 'cast_spell': return 'cast_with_another_spell'; // Only if cast as 2nd+ spell
    default: return null;
  }
}

console.log(`\n=== CONDITIONS TO ADD (${needsFix.length}) ===\n`);
console.log(`Note: These conditions provide better documentation and safety.\n`);

// Group by event
const byEvent = {};
for (const item of needsFix) {
  if (!byEvent[item.event]) {
    byEvent[item.event] = {
      cards: [],
      condition: item.suggestedCondition
    };
  }
  byEvent[item.event].cards.push(item.card);
}

// Display grouped
for (const [event, data] of Object.entries(byEvent)) {
  console.log(`\n${event} → condition: "${data.condition}"`);
  console.log(`Cards (${data.cards.length}):`);
  for (const card of data.cards) {
    console.log(`  - ${card}`);
  }
}

console.log(`\n\n=== IMPLEMENTATION ===`);
console.log(`\nNOTE: The engine already validates self triggers correctly.`);
console.log(`These conditions are for documentation + extra safety.\n`);
console.log(`However, some conditions don't exist in _checkTriggerCondition yet.`);
console.log(`We need to add them to game-state.js switch statement.\n`);
console.log(`Suggested new conditions to add:`);
console.log(`  - attacks_self: Always true (self is already validated)`);
console.log(`  - self_combat_damage_player: Always true (self is already validated)`);
console.log(`  - dies_self: Always true (self is already validated)`);
console.log(`  - self_becomes_tapped: Always true (self is already validated)\n`);
