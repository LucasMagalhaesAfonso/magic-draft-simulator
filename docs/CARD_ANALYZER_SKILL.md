# 🔍 Card Analyzer Skill - Complete Guide

## Quick Start

```bash
node tools/analyze-card.js "Card Name"
```

### Example Usage

```bash
# Single card analysis
node tools/analyze-card.js "Dragonclaw Strike"

# Output:
# 📋 ANALYZING: Dragonclaw Strike
# Type: Sorcery | Mana: {2/G}{2/U}{2/R} | CMC: 6
#
# [1] CardEffectsDB Entry: ✅ EXISTS
# [2] Cast Effects: ✅ 2 effect(s) defined
# [5] Multi-Target: ✅ Targets indexed properly
# ...
# ✅ ALL CHECKS PASSED!
```

## What It Checks

| # | Check | Detects | Suggests |
|----|-------|---------|----------|
| 1 | DB Entry | Card missing from CardEffectsDB | Add full entry |
| 2 | ETB Effects | Creatures that "enter" without ETB | `etb: [...]` array |
| 3 | Cast Effects | Instants/sorceries without cast | `cast: [...]` array |
| 4 | Triggered | "Whenever/when/each time" without trigger | `triggered: [...]` array |
| 5 | Multi-Target | Multiple targets without `target_index` | Add `target_index: 0, 1, 2...` |
| 6 | Hybrid Mana | `{2/G}` style mana costs | Hybrid cost detected |
| 7 | Modal | "Choose one/two" without modal | `type: "modal", modes: [...]` |
| 8 | Keywords | flying, hexproof, etc. without static | `static: [{ type: "has_keyword", keywords: [...] }]` |
| 9 | Costs | Sacrifice/tap/discard costs | Add to `additional_costs` |
| 10 | Fight | "Fight" mechanic without effect | `type: "fight", target: "opponent_creature"` |

## Bug Fix Workflow Integration

### Before (Manual)
1. User: "Card X doesn't work"
2. Claude: Grep CardEffectsDB, read Scryfall, explore code, find issue (many steps, many tokens)

### After (With Analyzer)
1. User: "Card X doesn't work"
2. Claude: `node tools/analyze-card.js "Card X"` → Get 10-point checklist
3. Fix the specific issue identified
4. Verify: `node tools/analyze-card.js "Card X"` → ✅ ALL CHECKS PASSED!

## Common Issues & Fixes

### Issue 1: "Card doesn't trigger when enters"
```
⚠️  Missing ETB effects for creature that "enters"
→ Add: etb: [{ type: "draw", amount: 1 }]
```
**Example**: Temur Tawnyback
```js
"temur tawnyback": {
  etb: [{ type: "loot", draw: 1, discard: 1 }]  // ✅ Fixed
}
```

### Issue 2: "Spell accepts wrong targets"
```
⚠️  Multiple targets (2) but no target_index markers
→ Add target_index: 0, 1, 2... to each effect with different target type
```
**Example**: Dragonclaw Strike
```js
"dragonclaw strike": {
  cast: [
    { type: "buff", target: "own_creature", target_index: 0 },     // ✅ Added index
    { type: "fight", target: "opponent_creature", target_index: 1 } // ✅ Added index
  ]
}
```

### Issue 3: "Hybrid mana doesn't work"
```
[6] Hybrid Mana: ✅ Detected 3 hybrid symbol(s)
```
**Note**: Analyzer detects hybrid mana. Code fixes needed in:
- `mana.js`: `payMana()` and `autoTapForSpell()` must handle hybrids
- Check if bug is in UI targeting or mana payment logic

### Issue 4: "Keywords not showing"
```
⚠️  Keywords found (flying, haste) but not in static effects
→ Add: static: [{ type: "has_keyword", keywords: ["flying", "haste"] }]
```
**Example**: Sagu Wildling
```js
"sagu wildling": {
  static: [{ type: "has_keyword", keywords: ["flying"] }]  // ✅ Fixed
}
```

## Output Format Explained

```
📋 ANALYZING: [Card Name]
Type: [Card Type] | Mana: [Mana Cost] | CMC: [CMC]

[1] CardEffectsDB Entry: ✅ EXISTS / ❌ MISSING
    (Shows excerpt of current entry or suggests adding one)

[2] ETB Effects: ✅ 2 effect(s) defined
    (Only shows if creature has "enters" in oracle text)

[3] Cast Effects: ✅ 2 effect(s) defined
    (Only shows for instants/sorceries)

[5] Multi-Target: ⚠️  Multiple targets (2) but no target_index markers
    → Add target_index: 0, 1, 2... to each effect with different target type

✅ ALL CHECKS PASSED!
   OR
⚠️  3 ISSUE(S) FOUND:
1. Issue A
   → Fix suggestion
2. Issue B
   → Fix suggestion
```

## Token Efficiency Gains

### Before Analyzer
- User reports bug
- Claude greps CardEffectsDB (~200 tokens)
- Claude fetches Scryfall (~300 tokens)
- Claude reads relevant code files (~500 tokens)
- Claude finds issue and suggests fix (~300 tokens)
- **Total: ~1300 tokens per bug**

### After Analyzer
- User reports bug
- Claude runs: `node tools/analyze-card.js "Card Name"` (~50 tokens)
- Analyzer outputs 10-point checklist
- Claude reads output and fixes issue (~200 tokens)
- Claude verifies: `node tools/analyze-card.js "Card Name"` again (~50 tokens)
- **Total: ~300 tokens per bug = 77% reduction!**

## Integration with Claude Code

### Option 1: Manual Invocation
```bash
# When debugging a card
node tools/analyze-card.js "Problem Card"
```

### Option 2: As a Skill (Future)
```
/analyze-card "Card Name"
```

### Option 3: Batch Processing
```bash
# Validate multiple cards
node tools/analyze-card.js "Dragonclaw Strike"
node tools/analyze-card.js "Temur Tawnyback"
node tools/analyze-card.js "Breaching Dragonstorm"
```

## See Also
- `MEMORY.md` - Project knowledge base
- `card-effects.js` - Database location
- `stack.js` - Effect resolution
- `ui-game.js` - UI targeting logic
