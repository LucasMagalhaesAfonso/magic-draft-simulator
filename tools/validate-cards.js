#!/usr/bin/env node

/**
 * Card Validation Script
 * Validates all cards in CardEffectsDB for common errors
 * Run: node tools/validate-cards.js
 */

const fs = require('fs');
const path = require('path');

// Load CardEffectsDB
const dbPath = path.join(__dirname, '../js/data/card-effects.js');
const dbContent = fs.readFileSync(dbPath, 'utf8');

// Extract CardEffectsDB object (hacky but works)
const cardDBMatch = dbContent.match(/const CardEffectsDB = ({[\s\S]*?^};/m);
if (!cardDBMatch) {
  console.error('❌ Could not parse CardEffectsDB');
  process.exit(1);
}

// Load actual DB by requiring it
delete require.cache[require.resolve(dbPath)];
const CardEffectsDB = require(dbPath).CardEffectsDB || require(dbPath);

// Known valid effect types
const VALID_EFFECT_TYPES = [
  'damage', 'destroy', 'exile', 'draw', 'gainLife', 'loseLife', 'buff', 'debuff', 'bounce',
  'scry', 'surveil', 'mill', 'ramp', 'search_library', 'create_token', 'destroy_all',
  'exile_all', 'damage_all_creatures', 'counter', 'counter_self', 'counter_all',
  'discard', 'fight', 'tap', 'untap', 'drain', 'prevent_damage', 'loot', 'bounce_self',
  'look_top', 'damage_all', 'untap_all', 'discard_hand', 'reveal_hand', 'exile_graveyard',
  'exile_from_graveyard', 'exile_top', 'double_counters', 'bounce_to_library_top',
  'return_land_from_mill', 'regenerate', 'counter_self_if_no_draw', 'remove_counters',
  'grant', 'grant_all', 'grant_counter', 'grant_counters', 'exile_top_play',
  'search_library_to_graveyard', 'create_token_copy', 'clone', 'copy_self',
  'gain_control', 'anthem', 'move_counters', 'distribute_counters', 'become_creature',
  'become_dragon', 'attach', 'exile_top_opponent', 'copy_spell', 'copy_next_spell',
  'extra_combat', 'exile_graveyard_cast_copy', 'modal', 'threaten', 'stun',
  'clash', 'hideaway', 'return_from_graveyard', 'debuff_all', 'blight', 'blight_opponent',
  'wither', 'persist', 'transform', 'flash_grant'
];

const VALID_KEYWORDS = [
  'flying', 'flash', 'haste', 'trample', 'menace', 'deathtouch', 'lifelink',
  'vigilance', 'reach', 'defender', 'indestructible', 'hexproof', 'shroud',
  'first_strike', 'double_strike', 'ward', 'evoke', 'changeling', 'convoke',
  'cycling', 'kicker', 'behold', 'stun', 'channel'
];

let errors = [];
let warnings = [];
let cardCount = 0;
let cardErrors = 0;

console.log('🔍 Validating CardEffectsDB...\n');

for (const [cardName, cardDef] of Object.entries(CardEffectsDB)) {
  cardCount++;
  let hasCardError = false;

  // Check cast effects
  if (cardDef.cast && Array.isArray(cardDef.cast)) {
    for (let i = 0; i < cardDef.cast.length; i++) {
      const effect = cardDef.cast[i];
      if (effect.type && !VALID_EFFECT_TYPES.includes(effect.type)) {
        errors.push(`❌ ${cardName}: Unknown cast effect type "${effect.type}"`);
        hasCardError = true;
      }
      if (effect.keywords && Array.isArray(effect.keywords)) {
        for (const kw of effect.keywords) {
          if (!VALID_KEYWORDS.includes(kw)) {
            warnings.push(`⚠️  ${cardName}: Unknown keyword "${kw}" in cast`);
          }
        }
      }
    }
  }

  // Check ETB effects
  if (cardDef.etb && Array.isArray(cardDef.etb)) {
    for (const effect of cardDef.etb) {
      if (effect.type && !VALID_EFFECT_TYPES.includes(effect.type)) {
        errors.push(`❌ ${cardName}: Unknown ETB effect type "${effect.type}"`);
        hasCardError = true;
      }
    }
  }

  // Check triggered abilities
  if (cardDef.triggered && Array.isArray(cardDef.triggered)) {
    for (const trigger of cardDef.triggered) {
      if (trigger.effects && Array.isArray(trigger.effects)) {
        for (const effect of trigger.effects) {
          if (effect.type && !VALID_EFFECT_TYPES.includes(effect.type)) {
            errors.push(`❌ ${cardName}: Unknown triggered effect type "${effect.type}"`);
            hasCardError = true;
          }
        }
      }
    }
  }

  // Check static abilities
  if (cardDef.static && Array.isArray(cardDef.static)) {
    for (const stat of cardDef.static) {
      if (stat.type === 'has_keyword' && stat.keywords) {
        for (const kw of stat.keywords) {
          if (!VALID_KEYWORDS.includes(kw)) {
            warnings.push(`⚠️  ${cardName}: Unknown static keyword "${kw}"`);
          }
        }
      }
    }
  }

  if (hasCardError) cardErrors++;
}

// Report
console.log(`\n📊 VALIDATION REPORT`);
console.log(`─────────────────────`);
console.log(`Total cards: ${cardCount}`);
console.log(`Errors: ${errors.length}`);
console.log(`Warnings: ${warnings.length}`);

if (errors.length > 0) {
  console.log(`\n${errors.slice(0, 20).join('\n')}`);
  if (errors.length > 20) console.log(`... and ${errors.length - 20} more errors`);
}

if (warnings.length > 0 && errors.length === 0) {
  console.log(`\n${warnings.slice(0, 10).join('\n')}`);
  if (warnings.length > 10) console.log(`... and ${warnings.length - 10} more warnings`);
}

process.exit(errors.length > 0 ? 1 : 0);
