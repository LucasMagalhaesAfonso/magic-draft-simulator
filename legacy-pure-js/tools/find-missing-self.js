#!/usr/bin/env node
/**
 * find-missing-self.js
 * Encontra triggers que deveriam ter self: true mas não têm
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

// Events that typically trigger on SELF
const SELF_EVENTS = new Set([
  'attacks', 'combat_damage_player', 'dies', 'becomes_tapped',
  'enters_or_attacks', 'second_spell', 'cast_spell', 'cast_noncreature',
  'cast_colorless', 'leaves_battlefield', 'equipped_attacks'
]);

const issues = [];

for (const cardName of cards) {
  const entry = DB[cardName];
  if (!entry.triggered || !Array.isArray(entry.triggered)) continue;

  for (const trig of entry.triggered) {
    const event = trig.event;

    // Check: Is this a SELF event but the trigger doesn't have self: true
    // AND the effect targets self
    if (SELF_EVENTS.has(event) && !trig.self &&
        trig.effects?.some(e => e.target === 'self' || e.target === 'own_creature')) {
      issues.push({
        card: cardName,
        event,
        hasSelf: !!trig.self,
        targetsSelf: true,
        effect: trig.effects?.[0]?.type
      });
    }
  }
}

console.log(`\n=== TRIGGERS MISSING SELF FLAG (${issues.length}) ===\n`);

if (issues.length === 0) {
  console.log('✓ None found\n');
} else {
  for (const item of issues) {
    console.log(`${item.card.toUpperCase()}`);
    console.log(`  Event: ${item.event}`);
    console.log(`  Has self: ${item.hasSelf}`);
    console.log(`  Effect: ${item.effect}`);
    console.log('');
  }
}
