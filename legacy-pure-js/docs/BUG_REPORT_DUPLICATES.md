# BUG REPORT: Duplicate Cards with Same Name Causing Issues

## Problem Description
When two cards with the same name exist (same card in hand/battlefield of different players), the game confuses them:
- Blocking behavior is incorrect
- When one creature with a name dies, other creatures with the same name may also be affected
- Name-based lookups instead of UID-based lookups

## Root Causes Found

### 1. **UI - Basic Land Lookup (ui-game.js:6707)**
```javascript
const landIdx = lib.cards.findIndex(c => c.name === landName && CardEngine.isBasicLand(c));
```
**Issue**: Uses `name` instead of `_uid`. If multiple lands with same name exist, finds the wrong one.
**Fix**: Should use `_uid` parameter

### 2. **Search Library Effect (game-state.js:2610, stack.js:2237)**
```javascript
filter = c => c.name === effect.name;
```
**Issue**: When searching library for named card, finds first match by name.
**Impact**: If library has duplicate names, picks wrong card
**Fix**: Should verify search target is specific to effect requirements

### 3. **Legendary Rule Check (cards.js:1225)**
```javascript
c => this.isLegendary(c) && c.name === cardName
```
**Issue**: Uses name comparison for legendary rule checking
**Fix**: Should use `_uid` for comparison

## Secondary Issue - Combat Cleanup
In `combat.js:_cleanupDead()`, when multiple creatures die:
```javascript
const dead = bf.cards.filter(c => CardEngine.isCreature(c) && (c._damage >= CardEngine.getToughness(c)));
dead.forEach(c => GameState.creatureDies(gameState, c, playerId));
```
If two creatures have same name and same stats, potential confusion during iteration.

## Recommendations

1. **Audit all card comparisons** - Replace all `.name ===` with `._uid` comparisons
2. **Test with duplicate cards** - Play two copies of same creature card to verify fix
3. **Add UID validation** - Ensure every place identifying a card uses `_uid`, not `name`

## Cards to Test
- Two Skirmish Rhino (same name)
- One attacking, one blocking
- One your side, one opponent's side
- Verify they are handled independently
