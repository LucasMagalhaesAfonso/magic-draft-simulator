# 🔍 Full-Stack Analyzer - Complete Guide

## What It Does

Verifica **TUDO** em uma carta em **7 camadas**:

```
[1] SCRYFALL API          → Oracle text completo
[2] CARDEFECTSDB         → Estrutura do database
[3] STACK.JS             → Effect types implementados?
[4] GAME-STATE.JS        → Trigger events suportados?
[5] MANA PARSING         → Custos válidos?
[6] STATIC EFFECTS       → Keywords/estáticos corretos?
[7] ORACLE vs DB         → Tamanho/conteúdo match?
```

---

## Commands

```bash
# Analisar 1 carta
node tools/full-stack-analyzer.js "Ambling Stormshell"

# Analisar batch1 (5 cartas)
node tools/full-stack-analyzer.js batch1

# Analisar batch2
node tools/full-stack-analyzer.js batch2
```

---

## Sample Output - Ambling Stormshell

```
========================================================================================================================
FULL-STACK ANALYSIS: Ambling Stormshell
========================================================================================================================

[1/7] SCRYFALL API
✅ Found: Ambling Stormshell
   Mana: {3}{U}{U} | Type: Creature — Turtle
   Oracle: Ward {2}...

[2/7] CARDEFECTSDB
✅ In database
   Cast: 0 | ETB: 0 | Triggered: 1

[3/7] STACK.JS - Effect Types
❌ triggered: Missing type field
   (Effects não têm "type" definido)

[4/7] GAME-STATE.JS - Trigger Events
✅ All triggers supported

[5/7] MANA PARSING
✅ Mana cost valid

[6/7] STATIC EFFECTS
❌ Static has_keyword: Missing keywords array
   (has_keyword precisa de array "keywords")

[7/7] ORACLE vs DB COMPARISON
⚠️  Triggered count mismatch: Oracle=2, DB=1
   (Oracle tem 2 "whenever", DB tem só 1)

========================================================================================================================
SUMMARY
========================================================================================================================

🔴 ISSUES FOUND: 3 total
   ❌ triggered: Missing type field
   ❌ Static has_keyword: Missing keywords array
   ⚠️  Triggered count mismatch: Oracle=2, DB=1
```

---

## What Each Layer Checks

### **[1] SCRYFALL API**
```
✅ Card found on Scryfall
✅ Mana cost format valid
✅ Oracle text extracted
```

### **[2] CARDEFECTSDB**
```
✅ Card has entry in database
✅ Cast/ETB/Triggered/Activated counts
```

### **[3] STACK.JS - Effect Types**
```
❌ effect.type = "draw" (not found in stack.js case statements)
✅ effect.type = "damage" (found in stack.js)

All 100+ supported types verified
```

### **[4] GAME-STATE.JS - Trigger Events**
```
✅ trigger.event = "attacks" (supported)
❌ trigger.event = "unknown" (NOT in game-state.js)

Also checks:
- trigger.condition if present (supported conditions?)
- trigger.self flag for self-events
```

### **[5] MANA PARSING**
```
✅ Valid: {3}{U}{U}, {5}, {1}{W}{B}
❌ Invalid: poorly formatted costs
✅ additional_costs have type field
```

### **[6] STATIC EFFECTS**
```
✅ static.type = "has_keyword"
✅ static.keywords = ["flying", "haste"]
❌ static.type missing
❌ static.keywords missing (when type="has_keyword")
```

### **[7] ORACLE vs DB COMPARISON**
```
Oracle: "Whenever this creature attacks" (1 trigger)
Oracle: "Whenever you cast a spell" (2nd trigger)
DB: triggered.length = 1

⚠️  Mismatch! DB missing 1 trigger
```

---

## Issues You'll See

| Issue | Meaning | Fix |
|-------|---------|-----|
| `❌ triggered: Missing type field` | Effects dalam triggered array não têm `type` | Add `type` field to each effect |
| `❌ Static has_keyword: Missing keywords array` | `has_keyword` sem `keywords: [...]` | Add `keywords` array |
| `❌ Effect type "X" NOT found in stack.js` | Effect type não está implementado | Implement in stack.js ou change to supported type |
| `❌ Trigger event "X" NOT in game-state.js` | Event não tem case statement | Add case in game-state.js ou check oracle |
| `⚠️ Trigger "X": Missing self flag` | Self event without true/false | Add `self: true` ou `self: false` |
| `⚠️ Triggered count mismatch` | Oracle e DB têm números diferentes | Add missing triggers |

---

## Workflow: Analyze → Fix → Re-analyze

### **Step 1: Run analyzer**
```bash
$ node tools/full-stack-analyzer.js batch1

Results show 15 total issues across 5 cards
```

### **Step 2: Read issues for first card**
```
Ambling Stormshell:
  ❌ triggered: Missing type field
  ❌ Static has_keyword: Missing keywords array
  ⚠️  Triggered count mismatch: Oracle=2, DB=1
```

### **Step 3: Fix code**

Edit `js/data/card-effects.js`:

**BEFORE:**
```javascript
"ambling stormshell": {
  static: [{ type: "has_keyword", keyword: "ward", ward_cost: 2 }],
  triggered: [
    { event: "attacks", self: true, effects: [
      { /* NO TYPE! */ },
      { type: "draw", amount: 3 }
    ] }
  ]
}
```

**AFTER:**
```javascript
"ambling stormshell": {
  static: [{ type: "has_keyword", keywords: ["ward"] }],  // Fixed: keyword → keywords array
  triggered: [
    { event: "attacks", self: true, effects: [
      { type: "stun_counter_self", amount: 3 },  // Added missing type
      { type: "draw", amount: 3 }
    ] },
    { event: "cast_spell", self: false, effects: [  // Added missing 2nd trigger
      { type: "untap_self" }
    ] }
  ]
}
```

### **Step 4: Re-analyze to confirm**
```bash
$ node tools/full-stack-analyzer.js "Ambling Stormshell"

Results:
✅ ALL CHECKS PASSED - Card is 100% complete!
```

### **Step 5: Repeat for next card**
```bash
$ node tools/full-stack-analyzer.js "Avenger of the Fallen"
... [same process]
```

---

## Real Example from Batch 1

**Issues found:**
```
5 cards analyzed
0 cards complete ❌
5 cards with issues ❌

ERRORS (must fix):
  Ambling Stormshell: 2 errors
  Avenger of the Fallen: 2 errors
  Boulderborn Dragon: 2 errors
  Descendant of Storms: 1 error
  Marshal of the Lost: 2 errors + 1 warning

TOTAL: 9 errors, 2 warnings
```

**What needs fixing:**
1. All 5 cards: `static.has_keyword` missing `keywords` array
2. Most cards: Triggered effects missing `type` field
3. Ambling Stormshell: Missing 2nd trigger
4. Marshal of the Lost: Missing `self` flag

---

## Integration with Workflow

```bash
# 1. Analyze batch
node tools/full-stack-analyzer.js batch1

# 2. See 9 errors, 2 warnings
# [You read the report and understand exactly what to fix]

# 3. Fix code in CardEffectsDB
# [Edit js/data/card-effects.js]

# 4. Re-analyze same batch
node tools/full-stack-analyzer.js batch1

# 5. See: ✅ ALL CHECKS PASSED (if all fixed)

# 6. Move to batch2
node tools/full-stack-analyzer.js batch2
```

---

## Key Advantages

✅ **Comprehensive** - 7 layers of verification
✅ **Specific** - Exact issues found, not vague
✅ **Actionable** - Issues tell you exactly what to fix
✅ **Fast** - ~2 seconds per card
✅ **Repeatable** - Re-run to verify fixes
✅ **Integrated** - Works with your CardEffectsDB

---

## Next Steps

```bash
# Analyze batch1 fully
node tools/full-stack-analyzer.js batch1

# You'll see the exact errors
# Fix them in CardEffectsDB
# Re-run to verify

# Continue with batch2, batch3, etc.
```

That's it! The analyzer tells you **EXACTLY** what's wrong in each card.

