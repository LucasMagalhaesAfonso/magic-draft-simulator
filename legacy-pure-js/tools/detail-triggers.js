#!/usr/bin/env node
/**
 * detail-triggers.js
 * Lista detalhado das 26 cartas com problema de triggers
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

const buggy = [];

for (const cardName of cards) {
  const entry = DB[cardName];
  if (!entry.triggered) continue;

  for (const trig of entry.triggered) {
    if (trig.self && !trig.condition) {
      buggy.push({
        card: cardName,
        event: trig.event,
        trigger: trig,
        effects: trig.effects
      });
    }
  }
}

console.log(`\nFound ${buggy.length} triggers to fix:\n`);
console.log('='.repeat(80) + '\n');

for (let i = 0; i < buggy.length; i++) {
  const item = buggy[i];
  console.log(`${i + 1}. ${item.card.toUpperCase()}`);
  console.log(`   Event: ${item.event}`);
  console.log(`   Effects: ${JSON.stringify(item.effects).substring(0, 100)}`);
  console.log(`   Self: ${item.trigger.self}`);
  console.log(`   Condition: ${item.trigger.condition || 'MISSING'}`);
  console.log('');
}

console.log('='.repeat(80) + '\n');

// Group by event for patterns
const byEvent = {};
for (const item of buggy) {
  if (!byEvent[item.event]) byEvent[item.event] = [];
  byEvent[item.event].push(item.card);
}

console.log('By Event Type:\n');
for (const [event, cardList] of Object.entries(byEvent)) {
  console.log(`${event} (${cardList.length}):`);
  for (const card of cardList) {
    console.log(`  - ${card}`);
  }
  console.log('');
}
