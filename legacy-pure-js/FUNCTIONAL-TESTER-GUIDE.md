# Full Functional Tester Guide

## Overview

`full-functional-tester.js` is a comprehensive testing tool that validates Magic cards work correctly in the actual game engine. It tests all critical aspects of card functionality without requiring manual play.

**File**: `tools/full-functional-tester.js`

## Quick Start

### Test a Single Card
```bash
node tools/full-functional-tester.js "Card Name"
node tools/full-functional-tester.js "Sage of the Skies"
```

### Test a Batch
```bash
node tools/full-functional-tester.js batch1
node tools/full-functional-tester.js batch2
```

### Test All TDM Cards
```bash
node tools/full-functional-tester.js tdm          # All cards
node tools/full-functional-tester.js tdm 20       # First 20 cards
```

### Export Results as JSON
```bash
node tools/full-functional-tester.js batch1 --json
```

### View Help
```bash
node tools/full-functional-tester.js --help
node tools/full-functional-tester.js --batches    # List all batches
```

---

## Output Status Codes

| Status | Symbol | Meaning |
|--------|--------|---------|
| **FUNCTIONAL** | ✅ | Card works in all tested scenarios |
| **PARTIAL** | ⚠️ | Card works but has missing functionality |
| **BROKEN** | ❌ | Card has critical issues preventing use |
| **UNTESTABLE** | 📋 | Card requires complex human interaction |

---

## Test Coverage

The tester validates **7 core systems**:

### 1. **Castability**
- Card type recognition (Creature, Instant, Sorcery, Enchantment, Artifact, Planeswalker)
- Mana cost parsing
- Phase timing rules
- Flash/instant speed detection

### 2. **Mana System**
- Mana cost calculation
- Generic + colored mana split
- CMC (converted mana cost) parsing
- Fallback manual parsing if ManaSystem unavailable

### 3. **Effect Resolution**
- Spell effects (cast)
- ETB (enters-the-battlefield) effects
- Triggered abilities registration
- Stack resolution

### 4. **Database Completeness**
- Checks if card in CardEffectsDB
- Calculates coverage percentage:
  - Cast effects
  - ETB effects
  - Triggered abilities
  - Activated abilities
  - Static abilities
  - Additional costs

### 5. **AI Recognition**
- AI scoring system availability
- AI targeting capability
- Error detection

### 6. **Keywords & Statics**
Detects:
- **Keywords**: Flying, Haste, Lifelink, Menace, Vigilance, Deathtouch, Trample, First Strike, Double Strike, Reach, Flash, Hexproof, Shroud, Indestructible, Ward, Protection, Defender

- **Static Abilities**:
  - BUFF_OWN_CREATURES - "creatures you control"
  - BUFF_OTHER_CREATURES - "other creatures"
  - HINDER_OPPONENT - opponent effects
  - COST_REDUCTION - cost modification

### 7. **Combo Synergies**
Identifies:
- **TRIBAL** - Subtypes (Zombie, Vampire, Dragon, etc.)
- **SACRIFICE** - Sacrifice synergy
- **GRAVEYARD** - Graveyard interactions
- **CREATURE_COUNT** - Scales with board
- **TRIGGER** - Trigger potential

---

## Test Output Example

```
======================================================================
TESTING: Sage of the Skies
======================================================================
✅ Found on Scryfall: Sage of the Skies
   Type: Creature — Human Monk
   Cost: {2}{W}
   Oracle: When you cast this spell, if you've cast another spell...

📚 DATABASE:
   ✅ IN DB (33% complete)
      ✅ Triggered abilities
      ✅ Static abilities

🎯 CASTABILITY:
   ✅ Card is castable

💰 MANA SYSTEM:
   ✅ Mana cost parsed: {generic: 3, total: 3}

📥 CASTING TEST:
   ✅ Card added to hand
   ✅ Spell resolved (2 effects)
      └ Effect: buff

👁️  ETB EFFECTS:
   ✅ Has ETB effects (1)
      1. draw

⚡ TRIGGERED ABILITIES:
   ✅ Has triggered abilities (1)
      1. Event: second_spell

🤖 AI RECOGNITION:
   ✅ Card recognized by AI system
      ✅ AI can score effects
      ✅ AI can target

🏷️  KEYWORDS & STATICS:
   ✅ Keywords found (2)
      • FLYING
      • LIFELINK

🔗 COMBO SYNERGIES:
   ✅ Has combo potential (1)
      • TRIGGER: Has trigger potential

======================================================================
STATUS: ✅ FUNCTIONAL
REASON: All core systems working
======================================================================

======================================================================
FUNCTIONAL TEST REPORT
======================================================================

✅ FUNCTIONAL (1):
   • Sage of the Skies

⚠️  PARTIAL (0):

❌ BROKEN (0):

📋 UNTESTABLE (0):

======================================================================
OVERALL: 1/1 (100%) cards fully functional
======================================================================
```

---

## Predefined Batches

### batch1
Testing common card types and mechanics:
- Sage of the Skies (Creature with trigger)
- Embermouth Sentinel (ETB with condition)
- Molten Exhale (Instant with conditional cost)
- Focus the Mind (Cost reduction trigger)
- Dragon's Prey (Conditional cost)

### batch2
Testing advanced mechanics:
- Behold the Dragons (Behold keyword)
- Triumphant Parch (Multiple effects)
- Volcanic Sentry (Activated ability)
- Fist of the Falling Sun (Combat mechanic)
- Thunderous Ascent (Spell scaling)

---

## JSON Export

When using `--json` flag, results are saved to `test-results.json`:

```json
{
  "timestamp": "2026-02-15T10:30:00.000Z",
  "summary": {
    "functional": 5,
    "total": 5,
    "percentage": 100
  },
  "byStatus": {
    "FUNCTIONAL": ["Card1", "Card2", ...],
    "PARTIAL": [...],
    "BROKEN": [...],
    "UNTESTABLE": [...]
  },
  "results": {
    "Card Name": {
      "status": "FUNCTIONAL",
      "reason": "All core systems working",
      "database": { ... },
      "castability": { ... },
      "mana": { ... },
      "etb": { ... },
      "triggered": { ... },
      "ai": { ... },
      "keywords": [...],
      "statics": [...]
    }
  }
}
```

---

## How It Works

### 1. Card Fetching
- Fetches card data from Scryfall API
- Caches results to avoid repeated API calls
- Returns oracle text, type line, mana cost, etc.

### 2. Mock Game State
- Creates lightweight game state with 2 players
- Each player has: library (20 forest tokens), hand, battlefield, graveyard, exile
- Initializes mana pools with generous amounts (5 of each color + 10 generic)

### 3. Card Object Creation
- Converts Scryfall card to game card object
- Initializes all game-state properties:
  - Damage counter
  - Power/toughness mods
  - Counters
  - Keywords
  - Attachment tracking
  - Zone tracking

### 4. Test Execution
For each card, runs **in sequence**:
1. **Castability** - Can the card type be recognized and cast?
2. **Mana System** - Can mana cost be parsed?
3. **Casting** - Can the spell be added to hand and cast?
4. **ETB** - Do enter-the-battlefield effects resolve?
5. **Triggers** - Can triggered abilities be registered?
6. **AI** - Does AI recognize the card?
7. **Keywords** - Are keyword abilities detected?
8. **Combos** - Are synergies identified?

### 5. Result Aggregation
- Collects all test results
- Determines overall status based on:
  - Castability ✓
  - Database presence (encouraged but not required)
  - Effect resolution success
  - AI recognition
  - No errors during testing

### 6. Report Generation
- Displays summary by status
- Shows detailed breakdowns
- Calculates percentage functional
- Optionally exports JSON

---

## Integration with Game Engine

The tester **loads the actual game engine files**:

| File | Purpose | Loaded As |
|------|---------|-----------|
| `js/game/zones.js` | Zone system | Zone class |
| `js/game/mana.js` | Mana parsing & payment | ManaSystem |
| `js/game/cards.js` | Card effects parsing | CardEngine |
| `js/game/combat.js` | Combat system | CombatSystem |
| `js/game/stack.js` | Effect resolution | GameStack |
| `js/game/game-state.js` | Game state management | GameState |
| `js/game/game-ai.js` | AI decision making | GameAI |
| `js/data/card-effects.js` | Card database | CardEffectsDB |

This means tests use the **exact same code** that runs in the browser.

---

## Common Test Scenarios

### Test a New Card Added to Database
```bash
node tools/full-functional-tester.js "My New Card"
```
The script will:
1. Fetch from Scryfall
2. Check CardEffectsDB for entry
3. Test all effects in the actual engine
4. Report any issues

### Test All Cards in a Set
```bash
node tools/full-functional-tester.js tdm
```
Generates comprehensive report showing which cards are fully functional.

### Find Broken Cards
```bash
node tools/full-functional-tester.js tdm 50 --json
# Then check test-results.json for "BROKEN" status
```

### Test Cards Before Committing
```bash
# Before committing changes to CardEffectsDB
node tools/full-functional-tester.js "Modified Card"

# If BROKEN, fix the card effects
# If FUNCTIONAL, safe to commit
```

---

## Limitations & Future Enhancements

### Current Limitations
- Doesn't test human interactive choices (modal selection, target picking)
- Doesn't test multi-turn game scenarios
- Doesn't test card interactions with specific board states
- Doesn't validate visual feedback (animations, toast messages)

### Potential Enhancements
- Simulate combat scenarios
- Test trigger chains
- Test card interactions (e.g., "all creatures get +1/+1")
- Test phase transitions
- Test mulligan system
- Test mana tapping strategies
- Record test runs for performance benchmarking

---

## Troubleshooting

### "Card not found on Scryfall"
- Check card name spelling
- Use exact Scryfall name
- Try without special characters

### "Could not parse mana cost"
- ManaSystem may not be loaded
- Tester uses fallback parsing
- Check if mana cost is valid format: `{2}{W}{U}`

### "AI recognition issues"
- GameAI module may have errors
- Check game-ai.js for syntax issues
- Verify CardEffectsDB entry format

### "No triggered abilities"
- Card may not have triggers in oracle text
- Check parseTriggeredAbilities in cards.js
- Verify regex patterns match oracle text

---

## Advanced Usage

### Test Specific Mechanics
Modify the `testCard()` function to focus on specific mechanics:

```javascript
// In full-functional-tester.js:
// Add custom test for specific scenario
testComboWithBoard(state, card, playerId) {
  // Create specific board state
  // Add supporting creatures
  // Test card interaction
}
```

### Performance Analysis
The tester could be extended to measure:
- Time to parse card effects
- Time to resolve stack items
- Memory usage per card test

### Validation Against Scryfall
Compare CardEffectsDB entries against Scryfall oracle text for accuracy.

---

## Related Tools

- **`full-stack-analyzer.js`** - Analyzes cards against implementation (Scryfall, DB, code)
- **`test-card-generator.js`** - Generates console test scripts for manual testing
- **`card-completeness-auditor.js`** - Audits CardEffectsDB completeness

---

## See Also

- **CLAUDE.md** - Project guide and quick start
- **MEMORY.md** - Architecture and implemented systems
- **bugs-fixed.md** - Past fixes and lessons learned
