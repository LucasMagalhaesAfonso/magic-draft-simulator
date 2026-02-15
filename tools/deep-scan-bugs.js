#!/usr/bin/env node
/**
 * deep-scan-bugs.js
 * Analisa CardEffectsDB inteiro para encontrar bugs em triggers, ETB, cast, etc
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

console.log(`\n=== DEEP SCAN: ${cards.length} CARDS ===\n`);

const bugs = {
  triggersSelfWithoutCondition: [],     // self: true, no condition
  triggersWithoutSelfButShouldHave: [],  // Events that typically need self validation
  etbWithoutTargetValidation: [],        // ETB with effects that target, no targets array
  castWithoutTargetValidation: [],       // Cast with effects that target, no targets array
  modalWithoutModes: [],                 // Has type: 'modal' but no modes array
  duplicateEffects: [],                  // Same effect type multiple times (might be error)
  missingEffectType: [],                 // Effect without type field
  triggersWithWrongEvent: [],            // Events that don't match pattern
  additionalCostsIssues: [],             // Additional costs that look wrong
  etbOptionalWithoutOptionalField: [],   // ETB marked optional but field missing
  allTriggerEvents: {},
  allEffectTypes: {},
  cardWithMostTriggers: { name: '', count: 0 }
};

// Events that typically trigger on SELF
const SELF_EVENTS = new Set([
  'attacks', 'combat_damage_player', 'dies', 'becomes_tapped',
  'enters_or_attacks', 'second_spell', 'cast_spell', 'cast_noncreature',
  'cast_colorless', 'leaves_battlefield', 'equipped_attacks'
]);

// Events that typically trigger on ALL/OTHER creatures
const GLOBAL_EVENTS = new Set([
  'upkeep', 'end_step', 'gain_life', 'any_creature_dies', 'other_creature_dies',
  'dragon_enters', 'creature_etb', 'landfall', 'combat_begin', 'other_creature_enters',
  'cards_leave_graveyard', 'creature_dies_with_counters', 'counter_placed'
]);

// Scan all cards
for (const cardName of cards) {
  const entry = DB[cardName];

  // === TRIGGERS ===
  if (entry.triggered && Array.isArray(entry.triggered)) {
    if (entry.triggered.length > bugs.cardWithMostTriggers.count) {
      bugs.cardWithMostTriggers = { name: cardName, count: entry.triggered.length };
    }

    for (const trig of entry.triggered) {
      const event = trig.event;

      // Track all events
      if (!bugs.allTriggerEvents[event]) {
        bugs.allTriggerEvents[event] = [];
      }
      bugs.allTriggerEvents[event].push(cardName);

      // Self triggers without condition (after second_spell fix, still check)
      if (trig.self && !trig.condition && event !== 'second_spell') {
        bugs.triggersSelfWithoutCondition.push({
          card: cardName,
          event,
          self: true,
          hasCondition: !!trig.condition
        });
      }

      // Triggers that should have self but don't
      if (SELF_EVENTS.has(event) && !trig.self && trig.effects?.some(e => e.target === 'self')) {
        bugs.triggersWithoutSelfButShouldHave.push({
          card: cardName,
          event,
          hasSelf: !!trig.self,
          effect: trig.effects?.[0]?.type
        });
      }

      // Check for effects without type
      if (trig.effects) {
        for (const effect of trig.effects) {
          if (!effect.type) {
            bugs.missingEffectType.push({
              card: cardName,
              location: 'triggered',
              effect
            });
          }
        }
      }
    }
  }

  // === ETB EFFECTS ===
  if (entry.etb && Array.isArray(entry.etb)) {
    for (const effect of entry.etb) {
      // Track effect types
      if (!bugs.allEffectTypes[effect.type]) {
        bugs.allEffectTypes[effect.type] = [];
      }
      bugs.allEffectTypes[effect.type].push(cardName);

      // Check for targeted effects without target validation
      if (effect.target && !entry.targets &&
          ['counter', 'buff', 'debuff', 'destroy', 'damage', 'exile', 'bounce'].includes(effect.type)) {
        bugs.etbWithoutTargetValidation.push({
          card: cardName,
          type: effect.type,
          target: effect.target
        });
      }

      // Missing type
      if (!effect.type) {
        bugs.missingEffectType.push({
          card: cardName,
          location: 'etb',
          effect
        });
      }
    }
  }

  // === CAST EFFECTS ===
  if (entry.cast && Array.isArray(entry.cast)) {
    for (const effect of entry.cast) {
      // Track effect types
      if (!bugs.allEffectTypes[effect.type]) {
        bugs.allEffectTypes[effect.type] = [];
      }
      bugs.allEffectTypes[effect.type].push(cardName);

      // Modal without modes
      if (effect.type === 'modal' && !effect.modes) {
        bugs.modalWithoutModes.push({
          card: cardName,
          effect
        });
      }

      // Missing type
      if (!effect.type) {
        bugs.missingEffectType.push({
          card: cardName,
          location: 'cast',
          effect
        });
      }
    }
  }

  // === ADDITIONAL COSTS ===
  if (entry.additional_costs && Array.isArray(entry.additional_costs)) {
    for (const cost of entry.additional_costs) {
      if (!cost.type) {
        bugs.additionalCostsIssues.push({
          card: cardName,
          issue: 'missing type',
          cost
        });
      }
    }
  }
}

// === REPORT ===
console.log('📊 OVERALL STATISTICS\n');
console.log(`  Total cards: ${cards.length}`);
console.log(`  Card with most triggers: ${bugs.cardWithMostTriggers.name} (${bugs.cardWithMostTriggers.count})`);
console.log(`  Total unique trigger events: ${Object.keys(bugs.allTriggerEvents).length}`);
console.log(`  Total unique effect types: ${Object.keys(bugs.allEffectTypes).length}\n`);

// Bug summary
console.log('⚠️  BUG SUMMARY\n');
console.log(`  Self triggers without condition: ${bugs.triggersSelfWithoutCondition.length}`);
console.log(`  Triggers missing self but should have: ${bugs.triggersWithoutSelfButShouldHave.length}`);
console.log(`  ETB with target, no validation: ${bugs.etbWithoutTargetValidation.length}`);
console.log(`  Cast with target, no validation: ${bugs.castWithoutTargetValidation.length}`);
console.log(`  Modal without modes: ${bugs.modalWithoutModes.length}`);
console.log(`  Missing effect type: ${bugs.missingEffectType.length}`);
console.log(`  Additional cost issues: ${bugs.additionalCostsIssues.length}\n`);

// Top trigger events
console.log('🔔 TOP TRIGGER EVENTS\n');
const topEvents = Object.entries(bugs.allTriggerEvents)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 15);

for (const [event, cardList] of topEvents) {
  const isSelf = SELF_EVENTS.has(event) ? '(self)' : GLOBAL_EVENTS.has(event) ? '(global)' : '(unknown)';
  console.log(`  ${event} ${isSelf}: ${cardList.length} cards`);
}

// Top effect types
console.log('\n⚡ TOP EFFECT TYPES\n');
const topEffects = Object.entries(bugs.allEffectTypes)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 15);

for (const [type, cardList] of topEffects) {
  console.log(`  ${type}: ${cardList.length} cards`);
}

// CRITICAL BUGS
console.log('\n\n🔴 CRITICAL ISSUES FOUND\n');

if (bugs.missingEffectType.length > 0) {
  console.log(`MISSING EFFECT TYPE (${bugs.missingEffectType.length}):`);
  for (const item of bugs.missingEffectType.slice(0, 5)) {
    console.log(`  - ${item.card} (${item.location}): ${JSON.stringify(item.effect)}`);
  }
  if (bugs.missingEffectType.length > 5) {
    console.log(`  ... and ${bugs.missingEffectType.length - 5} more\n`);
  } else console.log('');
}

if (bugs.modalWithoutModes.length > 0) {
  console.log(`MODAL WITHOUT MODES (${bugs.modalWithoutModes.length}):`);
  for (const item of bugs.modalWithoutModes) {
    console.log(`  - ${item.card}`);
  }
  console.log('');
}

if (bugs.triggersSelfWithoutCondition.length > 0) {
  console.log(`SELF TRIGGERS WITHOUT CONDITION (${bugs.triggersSelfWithoutCondition.length}):`);
  for (const item of bugs.triggersSelfWithoutCondition.slice(0, 5)) {
    console.log(`  - ${item.card} (${item.event})`);
  }
  if (bugs.triggersSelfWithoutCondition.length > 5) {
    console.log(`  ... and ${bugs.triggersSelfWithoutCondition.length - 5} more\n`);
  } else console.log('');
}

console.log('='.repeat(80));
console.log(`\n✓ Deep scan complete\n`);
