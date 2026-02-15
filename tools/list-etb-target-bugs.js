#!/usr/bin/env node
/**
 * list-etb-target-bugs.js
 * Lista as 19 cartas com ETB target issues
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

const issues = [];

for (const cardName of cards) {
  const entry = DB[cardName];
  if (!entry.etb || !Array.isArray(entry.etb)) continue;

  for (const effect of entry.etb) {
    // Check if effect has target but no target validation
    if (effect.target && !entry.targets &&
        ['counter', 'buff', 'debuff', 'destroy', 'damage', 'exile', 'bounce', 'put_counter'].includes(effect.type)) {
      issues.push({
        card: cardName,
        type: effect.type,
        target: effect.target,
        optional: effect.optional,
        fullEffect: effect
      });
    }
  }
}

console.log(`\n=== ETB TARGET ISSUES (${issues.length}) ===\n`);

for (let i = 0; i < issues.length; i++) {
  const item = issues[i];
  console.log(`${i + 1}. ${item.card.toUpperCase()}`);
  console.log(`   Type: ${item.type}`);
  console.log(`   Target: ${item.target}`);
  console.log(`   Optional: ${item.optional ? 'YES' : 'NO'}`);
  console.log(`   Full: ${JSON.stringify(item.fullEffect).substring(0, 100)}...`);
  console.log('');
}

console.log('='.repeat(80) + '\n');

// Analyze by type
const byType = {};
for (const item of issues) {
  if (!byType[item.type]) byType[item.type] = [];
  byType[item.type].push(item.card);
}

console.log('By Effect Type:\n');
for (const [type, cardList] of Object.entries(byType)) {
  console.log(`${type} (${cardList.length}):`);
  for (const card of cardList) {
    console.log(`  - ${card}`);
  }
  console.log('');
}
