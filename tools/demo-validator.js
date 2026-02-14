#!/usr/bin/env node
/**
 * Demonstration of AI Card Validator
 * Shows example validation results without needing API key
 *
 * This demonstrates what the AI validator would find
 */

console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║     MAGIC DRAFT VALIDATOR - DEMONSTRATION                           ║
║     Shows example validation results (no API key required)           ║
╚══════════════════════════════════════════════════════════════════════╝
`);

// Example 1: Sage of the Skies (has trigger timing bug)
console.log(`
📊 EXAMPLE 1: SAGE OF THE SKIES
════════════════════════════════════════════════════════════════════════

Card Details:
  Type: Creature — Human Monk
  Mana: {2}{W}
  CMC: 3
  DB Entry: ✅ Exists

Validation Score: 42/100 ❌
Issues: 1 critical, 1 major, 0 minor

Issues Found:

🔴 [CRITICAL] wrong_timing
   Location: triggered
   Card says "When you cast SAGE OF THE SKIES, if you've cast another spell this turn..."
   But DB uses event: "second_spell" which means "when ANY card is cast"
   This triggers for other cards too, not just Sage!

   Evidence: "When you cast this spell, if you cast another spell this turn"

   FIX: Change event from "second_spell" to "cast_spell" with self: true
        Add condition: "cast_with_another_spell"

🟠 [MAJOR] missing_condition
   Location: triggered
   The trigger has a condition in oracle text ("if you've cast another spell")
   but it's not captured in the DB as a condition field

   FIX: Add condition: "cast_with_another_spell" to the trigger
        This gates the ability to only fire when the condition is true

═══════════════════════════════════════════════════════════════════════════

🔧 SUGGESTED FIXES:

Fix 1: triggered event timing
  Fix current: event: "second_spell", effects: [{ type: "copy_self" }]
  Suggested: event: "cast_spell", self: true, condition: "cast_with_another_spell",
             effects: [{ type: "copy_self" }]

  Explanation: "When you cast THIS CARD" = cast_spell with self: true
               The condition gates the entire trigger

═══════════════════════════════════════════════════════════════════════════

💡 SUMMARY:
Trigger timing bug - uses "second_spell" which triggers on ANY spell cast,
not just when Sage is cast. Also missing the "if" condition gate.

Next steps:
1. Update CardEffectsDB entry in js/data/card-effects.js
2. If condition not in engine, add to game-state.js _checkTriggerCondition()
3. Re-run validator to confirm fix
`);

// Example 2: Naga Fleshcrafter (has missing graveyard ability)
console.log(`
\n📊 EXAMPLE 2: NAGA FLESHCRAFTER
════════════════════════════════════════════════════════════════════════

Card Details:
  Type: Creature — Naga
  Mana: {1}{U}
  CMC: 2
  DB Entry: ✅ Exists (but incomplete)

Validation Score: 55/100 ❌
Issues: 2 critical, 0 major, 1 minor

Issues Found:

🔴 [CRITICAL] missing_ability
   Location: graveyard
   Oracle text: "Renew — {2}{U}, {exile from graveyard}: Other target..."
   But DB has NO graveyard: [...] array or activated ability with zone: "graveyard"
   This card is 50% implemented!

🔴 [CRITICAL] missing_ability
   Location: graveyard / effects
   Graveyard ability grants clone effect but that's not in the effects
   Card should create a copy effect for target creature

🟡 [MINOR] documentation
   Need to verify clone mechanics are correctly implemented

═══════════════════════════════════════════════════════════════════════════

🔧 SUGGESTED FIXES:

Fix 1: Add graveyard ability
  Location: graveyard
  Current: (none - graveyard array missing)
  Suggested:
    graveyard: [{
      cost: { mana: "{2}{U}", exile: true },
      sorcerySpeed: true,
      effects: [
        { type: "counter", counter: "+1/+1", amount: 1, target: "other_creature" },
        { type: "clone_all_to_target", duration: "end_of_turn" }
      ]
    }]

  Explanation: Enables the Renew ability - cast from graveyard for {2}{U},
               targets other creature, gives +1/+1, makes it a copy

═══════════════════════════════════════════════════════════════════════════

💡 SUMMARY:
Major gap - Renew graveyard ability completely missing. Only ETB clone is
implemented. Need to add full graveyard cost and effects.

Next steps:
1. Add graveyard: [...] array to CardEffectsDB entry
2. Verify clone_all_to_target effect exists in engine
3. Test in browser: play Naga, mill it, activate Renew ability
4. Re-run validator
`);

// Example 3: Counter Spell (AI targeting issue)
console.log(`
\n📊 EXAMPLE 3: COUNTER SPELL
════════════════════════════════════════════════════════════════════════

Card Details:
  Type: Instant
  Mana: {U}{U}
  CMC: 2
  DB Entry: ✅ Exists

Validation Score: 65/100 ⚠️
Issues: 0 critical, 2 major, 0 minor

Issues Found:

🟠 [MAJOR] wrong_target / ai_targeting
   Location: cast effects
   Card counters target spell on stack
   But DB doesn't specify target type: "spell" or targeting strategy
   AI won't know how to pick spell to counter

🟠 [MAJOR] missing_condition
   AI script doesn't have logic to target spells on stack
   Game needs: _chooseTargets() case for counter spell to pick best spell

═══════════════════════════════════════════════════════════════════════════

🔧 SUGGESTED FIXES:

Fix 1: Card effect - specify spell targeting
  Location: cast
  Current: { type: "counter", target: "creature" }
  Suggested: { type: "counter", target: "spell", stackOnly: true }

  Explanation: Marks target as spell (not creature) and forces stack targeting

Fix 2: Engine - Add counter spell AI targeting (js/game/game-ai.js)
  Add case in _chooseTargets():
    case 'counter': {
      const oppSpells = state.stack.items
        .filter(item => item.controller === opponentId)
        .reverse(); // Most recent first

      if (oppSpells.length > 0) {
        targets.push({
          type: 'spell',
          stackIndex: state.stack.items.indexOf(oppSpells[0])
        });
      }
      break;
    }

  Explanation: Teaches AI to pick most recent opponent spell on stack

═══════════════════════════════════════════════════════════════════════════

💡 SUMMARY:
Card definition lacks specificity for stack targeting. AI also lacks code
to target spells. Need both DB fix + engine enhancement.

Next steps:
1. Update card effect to specify spell targeting
2. Add counter spell targeting to game-ai.js _chooseTargets()
3. Test in browser: cast spells, opponent plays counter
4. Verify AI chooses best spell to counter
`);

// Setup instructions
console.log(`
════════════════════════════════════════════════════════════════════════

🚀 TO USE THE REAL AI VALIDATOR:

1. Get Anthropic API key:
   https://console.anthropic.com/account/keys

2. Create .env file:
   cp .env.example .env
   # Edit .env and paste your API key

3. Run validator:
   node tools/validate-card.js "Card Name"
   node tools/validate-card.js "Card Name" --verbose

4. Batch validate set:
   node tools/validate-set.js tdm

════════════════════════════════════════════════════════════════════════
`);
