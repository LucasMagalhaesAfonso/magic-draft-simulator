# Quick Debug Guide

## 🚨 Game Won't Load?

```bash
# 1. Start server
npm start

# 2. Open browser to http://127.0.0.1:8080
# 3. Press F12 → Console tab
# 4. Look for red error messages
```

**Common errors**:
- `Cannot read property 'x' of undefined` → File has syntax error
- `Uncaught SyntaxError` → JS file has invalid syntax
- `Card not found` → CardEffectsDB missing card entry

---

## 🎮 Game Loads But Card Doesn't Work

```
1. F12 → Console tab
2. Type in console:
   gameState.players[0].hand[0]  // First card in hand
   gameState.players[0].battlefield[0]  // First creature
3. Look for card properties
4. Check: _abilityType, cast, etb, triggered, static
```

**Checklist**:
- [ ] Card in `CardEffectsDB`?
- [ ] Effect type matches stack.js case?
- [ ] ETB regex in cards.js matches oracle text?
- [ ] Keyword detected in hasKeyword()?

---

## 🔍 Finding a Card in Code

```bash
# In VS Code:
# Ctrl+Shift+F → Search "card name"

# Or grep command:
grep -r "Zurgo" js/data/
```

**File locations**:
- Card effect definition → `js/data/card-effects.js` (search DB)
- Effect resolution → `js/game/stack.js` (look in switch)
- Keyword detection → `js/game/cards.js` (hasKeyword function)

---

## 🐛 Creature Dies Wrong / Doesn't Die

**Check order**:
1. Is creature indestructible? → Check `hasKeyword(card, 'Indestructible')`
2. Does it have -1/-1 counters? → Check `getToughness()` calculation
3. Is damage being applied? → Check combat.js `_dealDamageToCreature()`

**Common bug**:
```javascript
// WRONG - only modifies temp, not displayed
card._tempPowerMod = -2;

// RIGHT - modify both
card._powerMod = -2;
card._tempToughnessMod = -2; // if temp

// Then check death
if (card.getToughness() <= 0) {
    creatureDies(card);
}
```

---

## ⚡ AI Makes Wrong Decision

**In browser console**:
```javascript
// Check AI scores
game.gameAI._scoreCard(card);      // Card evaluation
game.gameAI._scoreInstant(spell);  // Spell quality
game.gameAI._threatScore(target);  // Target priority
```

**Common issues**:
- AI doesn't know about card ability → Add to CardEffectsDB `activated`
- AI picks bad targets → Check `_chooseTargets()` in game-ai.js
- AI doesn't play removal → Check threat score logic

---

## 📊 Game State Dump

```javascript
// In browser console:
console.log(JSON.stringify(gameState, null, 2));

// Or specific:
gameState.players[0]     // Your side
gameState.players[1]     // Opponent
gameState.currentPhase   // Current phase
gameState._stack         // Spells being cast
gameState._activePlayerId // Whose turn
```

---

## 🎨 Styling Issues / UI Broken

**Check**:
1. CSS file loaded? → F12 → Network tab → css/game.css
2. Z-index correct? → Check css/game.css for z-index conflicts
3. Layout broken? → CSS grid in game.css line ~50

**Common fixes**:
```css
/* Cards not visible? Check z-index */
.game-my-bf { z-index: 10; }

/* Text too small? Check font-size */
.card-name { font-size: 12px; }

/* Wrong colors? Check color values */
--color-red: #ff4444;
```

---

## 🔄 Undo a Bad Edit

```bash
# See what changed
git status

# Revert one file
git checkout js/game/cards.js

# See what you deleted
git log --oneline -10
git show <commit-hash>
```

---

## 💾 Save Your Work

```bash
# Check status
git status

# Add changed files
git add js/game/cards.js js/data/card-effects.js

# Commit
git commit -m "Fix: Card name ability description"

# Push
git push origin main
```

---

## 🧪 Manual Test Checklist

**For each card ability:**
- [ ] Card casts/enters correctly
- [ ] Effect resolves (spell goes to graveyard)
- [ ] Game log shows action
- [ ] Console has no errors
- [ ] AI can use card
- [ ] Undo works (if implemented)

---

## 📱 Browser DevTools Tips

| Key | Action |
|-----|--------|
| F12 | Open DevTools |
| Ctrl+Shift+J | Console |
| Ctrl+Shift+I | Inspector |
| Ctrl+Shift+K | Close DevTools |
| L (in game) | Toggle game log |

**Console commands**:
```javascript
// List all cards on battlefield
gameState.players[0].battlefield.forEach(c => console.log(c.name));

// Check mana pool
gameState.players[0].manaPool;

// Check if AI thinking
gameState._aiThinking;

// Current hand
gameState.players[0].hand;
```

---

## 🎯 When All Else Fails

1. **Check console first** (F12)
2. **Restart browser** (Ctrl+Shift+Delete cache)
3. **Clear localStorage** (game state might be corrupted)
   ```javascript
   localStorage.clear();
   location.reload();
   ```
4. **Kill server, restart** (`npm start`)
5. **Check recent commits** (might have introduced bug)

---

**Need help?** Check `CLAUDE.md` → `memory/MEMORY.md` → Read source code
