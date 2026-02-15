#!/usr/bin/env node
/**
 * scan-triggers.js
 * Analisa CardEffectsDB local para bugs de triggers
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dbPath = path.join(__dirname, '../js/data/card-effects.js');
const content = fs.readFileSync(dbPath, 'utf8');

// Parse via vm
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} }
};
vm.createContext(sandbox);

try {
  // Convert const to var so it leaks into sandbox
  const modified = content.replace(/\bconst CardEffectsDB\s*=/, 'var CardEffectsDB =');
  vm.runInContext(modified, sandbox);
} catch (e) {
  console.error('Error parsing:', e.message);
  process.exit(1);
}

const DB = sandbox.CardEffectsDB;
if (!DB) {
  console.error('CardEffectsDB not found in sandbox');
  process.exit(1);
}
const cards = Object.keys(DB).filter(k => !k.startsWith('_') && typeof DB[k] === 'object');

console.log(`\n=== TRIGGER SCAN ===\n`);
console.log(`Total cards: ${cards.length}\n`);

const issues = {
  castSpellWithSelf: [],           // Sage pattern - needs validation check
  selfWithoutCondition: [],         // Self trigger but no condition
  otherCreatureDiesSelf: [],       // Suspicious pattern
  allTriggerEvents: {},
  cardsWithTriggered: 0
};

for (const cardName of cards) {
  const entry = DB[cardName];
  if (!entry.triggered) continue;

  issues.cardsWithTriggered++;

  for (const trig of entry.triggered) {
    const event = trig.event;

    if (!issues.allTriggerEvents[event]) {
      issues.allTriggerEvents[event] = [];
    }
    issues.allTriggerEvents[event].push(cardName);

    // CRITICAL: cast_spell triggers with self:true
    if (event === 'cast_spell' && trig.self) {
      issues.castSpellWithSelf.push({
        card: cardName,
        self: trig.self,
        condition: trig.condition,
        hasBug: !trig.condition || trig.condition !== 'cast_with_another_spell'
      });
    }

    // Self trigger without condition = likely bug
    if (trig.self && !trig.condition) {
      issues.selfWithoutCondition.push({
        card: cardName,
        event,
        self: true
      });
    }

    // Other creature dies with self = suspicious
    if (event === 'other_creature_dies' && trig.self) {
      issues.otherCreatureDiesSelf.push(cardName);
    }
  }
}

console.log(`Cards with triggered: ${issues.cardsWithTriggered}\n`);

// Event breakdown
console.log(`📊 TRIGGER EVENTS:\n`);
const sorted = Object.entries(issues.allTriggerEvents)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 10);

for (const [event, cards] of sorted) {
  console.log(`  ${event}: ${cards.length} cards`);
}

// CRITICAL FINDINGS
console.log(`\n\n⚠️  CRITICAL: CAST_SPELL TRIGGERS (Sage pattern)\n`);

if (issues.castSpellWithSelf.length === 0) {
  console.log('  ✓ None found\n');
} else {
  const buggy = issues.castSpellWithSelf.filter(x => x.hasBug);
  console.log(`  Found: ${issues.castSpellWithSelf.length} total`);
  console.log(`  Potentially buggy: ${buggy.length}\n`);

  for (const item of issues.castSpellWithSelf) {
    const status = item.hasBug ? '❌ BUG' : '✓ OK';
    const cond = item.condition ? `[${item.condition}]` : '[NO CONDITION]';
    console.log(`  ${status} ${item.card} ${cond}`);
  }
}

// Self without condition
console.log(`\n\n⚠️  SELF TRIGGERS WITHOUT CONDITION\n`);

if (issues.selfWithoutCondition.length === 0) {
  console.log('  ✓ None found\n');
} else {
  console.log(`  Found: ${issues.selfWithoutCondition.length}\n`);

  const byEvent = {};
  for (const item of issues.selfWithoutCondition) {
    if (!byEvent[item.event]) byEvent[item.event] = [];
    byEvent[item.event].push(item.card);
  }

  for (const [event, cardList] of Object.entries(byEvent)) {
    console.log(`  ${event}:`);
    for (const card of cardList.slice(0, 5)) {
      console.log(`    - ${card}`);
    }
    if (cardList.length > 5) console.log(`    ... and ${cardList.length - 5} more`);
  }
}

// Estimate
console.log(`\n\n📈 WORK ESTIMATE\n`);
const totalBugs = issues.castSpellWithSelf.filter(x => x.hasBug).length +
                  issues.selfWithoutCondition.length;
console.log(`  Total potential bugs: ${totalBugs}`);
console.log(`  Time estimate: ${(totalBugs * 10 / 60).toFixed(1)} hours (10 min per card)`);
console.log(`  Tokens estimate: ${totalBugs * 75}-${totalBugs * 150} tokens\n`);

console.log(`✓ Analysis complete\n`);
