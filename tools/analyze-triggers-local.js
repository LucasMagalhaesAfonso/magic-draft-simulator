#!/usr/bin/env node
/**
 * analyze-triggers-local.js
 * Analisa CardEffectsDB local para identificar padrões de bugs
 * (tipo Sage of the Skies - trigger.self validation)
 */

const fs = require('fs');
const path = require('path');

// Load CardEffectsDB
const dbPath = path.join(__dirname, '../js/data/card-effects.js');
const dbContent = fs.readFileSync(dbPath, 'utf8');

// Extract DB object
const match = dbContent.match(/const CardEffectsDB = \{([\s\S]*)\};/);
if (!match) {
  console.error('Could not parse CardEffectsDB');
  process.exit(1);
}

// Use vm to safely eval
const vm = require('vm');
const sandbox = {
  CardEffectsDB: {}
};
vm.createContext(sandbox);
vm.runInContext('const CardEffectsDB = {' + match[1] + '};', sandbox);
const CardEffectsDB = sandbox.CardEffectsDB;

console.log(`\n=== TRIGGER ANALYSIS ===\n`);
console.log(`Total cards in DB: ${Object.keys(CardEffectsDB).length}\n`);

// Analysis
const results = {
  cardsWithTriggered: [],
  castSpellTriggers: [],
  selfTriggersWithoutValidation: [],
  otherCreatureDeathTriggers: [],
  allTriggerPatterns: {}
};

for (const [cardName, entry] of Object.entries(CardEffectsDB)) {
  if (!entry.triggered) continue;

  results.cardsWithTriggered.push(cardName);

  for (const trigger of entry.triggered) {
    const event = trigger.event;

    // Track all patterns
    if (!results.allTriggerPatterns[event]) {
      results.allTriggerPatterns[event] = { count: 0, cards: [], selfCount: 0 };
    }
    results.allTriggerPatterns[event].count++;
    results.allTriggerPatterns[event].cards.push(cardName);

    // Check for SAGE pattern: cast_spell trigger with self: true
    if (event === 'cast_spell' && trigger.self) {
      results.castSpellTriggers.push({
        card: cardName,
        trigger,
        hasSelfValidation: trigger.self ? 'YES' : 'NO',
        condition: trigger.condition
      });
      results.allTriggerPatterns[event].selfCount++;
    }

    // Check for potential issues: self triggers that might not validate properly
    if (trigger.self && !trigger.condition) {
      results.selfTriggersWithoutValidation.push({
        card: cardName,
        event,
        trigger
      });
    }

    // Track other_creature_dies which might have self issues
    if (event === 'other_creature_dies' && trigger.self) {
      results.otherCreatureDeathTriggers.push({
        card: cardName,
        trigger
      });
    }
  }
}

// Print results
console.log(`📊 TRIGGER SUMMARY\n`);
console.log(`Cards with triggered abilities: ${results.cardsWithTriggered.length}`);
console.log(`\n--- By Event Type ---\n`);

const sorted = Object.entries(results.allTriggerPatterns)
  .sort((a, b) => b[1].count - a[1].count);

for (const [event, data] of sorted) {
  const selfNote = data.selfCount > 0 ? ` (${data.selfCount} with self:true)` : '';
  console.log(`  ${event}: ${data.count}${selfNote}`);
}

// CRITICAL: Cast spell triggers (Sage pattern)
console.log(`\n⚠️  CAST_SPELL TRIGGERS (Sage of the Skies pattern)\n`);
if (results.castSpellTriggers.length === 0) {
  console.log('  None found ✓\n');
} else {
  console.log(`Found ${results.castSpellTriggers.length} cards:\n`);
  for (const item of results.castSpellTriggers) {
    const condStr = item.condition ? `[condition: ${item.condition}]` : '[NO CONDITION - MIGHT BE BUG!]';
    console.log(`  - ${item.card}`);
    console.log(`    Event: ${item.trigger.event}, Self: ${item.hasSelfValidation}`);
    console.log(`    ${condStr}\n`);
  }
}

// Self triggers without validation
console.log(`\n⚠️  SELF TRIGGERS WITHOUT CONDITION (potential bugs)\n`);
if (results.selfTriggersWithoutValidation.length === 0) {
  console.log('  None found ✓\n');
} else {
  console.log(`Found ${results.selfTriggersWithoutValidation.length} triggers:\n`);
  for (const item of results.selfTriggersWithoutValidation) {
    console.log(`  - ${item.card}`);
    console.log(`    Event: ${item.event}, Self: true, NO CONDITION\n`);
  }
}

// Other creature death with self
console.log(`\n ℹ️  OTHER_CREATURE_DIES with self:true (possible bugs)\n`);
if (results.otherCreatureDeathTriggers.length === 0) {
  console.log('  None found ✓\n');
} else {
  console.log(`Found ${results.otherCreatureDeathTriggers.length} cards:\n`);
  for (const item of results.otherCreatureDeathTriggers) {
    console.log(`  - ${item.card}\n`);
  }
}

// Estimate work
console.log(`\n📈 ESTIMATE FOR FULL VALIDATION\n`);
const buggyCards = results.castSpellTriggers.length + results.selfTriggersWithoutValidation.length;
console.log(`  Potentially buggy cards: ~${buggyCards}`);
console.log(`  Time per card: 5-10 minutes`);
console.log(`  Total work: ~${buggyCards * 7.5 / 60} hours`);
console.log(`  Tokens estimated: ${buggyCards * 50}-${buggyCards * 100} tokens\n`);

// Save report
const reportPath = path.join(__dirname, 'trigger-analysis.txt');
let reportText = `TRIGGER ANALYSIS REPORT\n`;
reportText += `${new Date().toISOString()}\n\n`;
reportText += `Total triggered abilities: ${results.cardsWithTriggered.length} cards\n`;
reportText += `Cast spell triggers (CRITICAL): ${results.castSpellTriggers.length}\n`;
reportText += `Self triggers without condition: ${results.selfTriggersWithoutValidation.length}\n`;
reportText += `\nDetailed card list:\n`;
reportText += results.castSpellTriggers.map(c => `  - ${c.card}`).join('\n');
fs.writeFileSync(reportPath, reportText);
console.log(`✓ Report saved to: ${reportPath}\n`);
