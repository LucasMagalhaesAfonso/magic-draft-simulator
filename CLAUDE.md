# Magic Draft Simulator - Claude Code Project Guide

## 🚀 Quick Start

**Working Directory**: `C:\Users\lucas\OneDrive\Área de Trabalho\magic_draft`

### Essential Commands
```bash
# Start local server (http://127.0.0.1:8080)
npx http-server . -p 8080 -c-1

# Open game in browser
start "" "index.html"

# View test reports (if needed later)
npx playwright show-report
```

---

## 📁 Project Structure

### Core Game Engine
- `js/game/game-state.js` - Main game loop, phase management
- `js/game/game-ai.js` - AI decision making, strategy
- `js/game/stack.js` - **CRITICAL** - Effect resolution, spell casting
- `js/game/cards.js` - Card data, parser helpers (ETB, triggers, etc)
- `js/game/combat.js` - Combat simulation, damage calculation
- `js/game/combat-sim.js` - Advanced combat analysis
- `js/game/mana.js` - Mana system, tapping lands
- `js/game/zones.js` - Zones (hand, bf, gy, library, exile)

### Data
- `js/data/card-effects.js` - Card definitions + effect configs
- `.mcp.json` - MCP server config (if using)

### UI
- `js/ui-game.js` - Game screen rendering
- `js/deckbuilder.js` - Deck building + auto-build
- `js/draft.js` - Draft simulator
- `js/card-zoom.js` - Right-click card zoom

### Assets
- `img/sprites/` - ~120 VFX sprites (see memory/MEMORY.md)
- `css/game.css` - Game styling

### Tests (CURRENTLY DISABLED)
- `tests/` - 17 test layers (761 tests total)
  - Each layer in its own folder
  - Tests stay but DON'T RUN via `npm test`
  - Manually inspect if needed: `npx playwright test --project=<name>`

---

## 🎮 Game Development Workflow

### 1. **Adding a Card**
1. Get card from Scryfall API
2. Add to `CardEffectsDB` in `js/data/card-effects.js`
3. Include: `cast` effects, `etb` effects, `triggered` abilities, `static` keywords
4. Check `memory/MEMORY.md` for supported mechanics

### 2. **Implementing a Card Mechanic**
**Checklist**:
- [ ] Oracle text parsed correctly (regex in `parseSpellEffects`, `parseETBEffects`, `parseTriggeredAbilities`)
- [ ] Effect added to `_resolveSimpleEffect()` in `js/game/stack.js`
- [ ] AI can score/use it (`game-ai.js`)
- [ ] Keywords detected + UI badge shown (if keyword mechanic)
- [ ] Manual test in browser (play card, verify behavior)

### 3. **Debugging**
```bash
# Open DevTools in browser: F12
# Check console for errors

# Useful logs:
# - Type 'L' in game to toggle action log
# - Right-click card for full details
# - Hover over mana symbols for costs

# AI thinking indicator shows with animated dots
```

### 4. **Before Committing**
- [ ] Game loads without console errors
- [ ] Key card abilities work as expected
- [ ] No UI breaks (resolution, layout)
- [ ] Git status clean (only intentional changes)

---

## 🛠️ Critical Files (Don't Break These!)

| File | Why Critical | Common Mistakes |
|------|-------------|-----------------|
| `stack.js` | Effect resolution | Missing case in switch, wrong effect type |
| `game-state.js` | Phase management | Phase order wrong, missing cleanup |
| `game-ai.js` | AI strategy | Bad scoring, infinite loops |
| `cards.js` | Card parsing | Regex doesn't match new oracle text |
| `card-effects.js` | Card data | Wrong effect name, typos in cost |

### Before Editing
```javascript
// ALWAYS check:
// 1. Effect type exists in stack.js switch
// 2. ETB triggers via parseETBEffects() regex
// 3. Keyword detection in hasKeyword()
// 4. If temp buffs: write BOTH _powerMod AND _tempPowerMod
// 5. After debuff: check toughness <= 0
```

See `memory/MEMORY.md` for full critical pitfalls list.

---

## 📊 Available Skills (via `/skill-name`)

```
/test-layer <name>         - Run specific test layer (if re-enabled)
/process-set <code>        - Analyze set, validate cards + effects
/find-card <name>          - Search CardEffectsDB, show status
/validate-effects          - Validate all effect definitions
/build-deck <strategy>     - Generate deck (BREAD scoring)
/run-game                  - Start browser + load game
```

*(Skills auto-load from hooks.json)*

---

## 🐛 Known Issues & Workarounds

### Game Bugs (See `memory/bugs-fixed.md`)
- Temp P/T mods: write to BOTH `_powerMod` and `_tempPowerMod`
- Death check: always after debuff (toughness <= 0)
- Boolean coercion: use `!!()` not truthy checks
- Duplicate switch cases: second case is dead code

### Browser Issues
- Chrome sometimes blocks local file access
- Use `npx http-server` instead of opening HTML directly
- Clear localStorage if draft state corrupted: `localStorage.clear()`

---

## 📚 References

- **Memory**: `C:\Users\lucas\.claude\projects\C--Users-lucas-OneDrive--rea-de-Trabalho-magic-draft\memory\`
  - `MEMORY.md` - Architecture + implemented systems
  - `bugs-fixed.md` - Past fixes + lessons learned
  - `test-system.md` - Test layer details

- **Card Data**: Scryfall API (`api.scryfall.com`)
- **Mechanics Reference**: `memory/MEMORY.md` - "Card Effects Implemented" section

---

## ⚙️ Hooks Configuration

**Location**: `.claude/hooks.json`

Active hooks:
- ✅ None currently (tests disabled)
- 🔄 Error detection hooks (for console errors)
- 🔄 File watcher (alert on critical file edits)

---

## 🎯 Current Focus

**User Priorities**:
1. ✅ Simplify workflow (tests disabled)
2. 🔄 Implement efficiency tools (hooks + skills)
3. Fix bugs as discovered (manual testing)

**Tests are DISABLED but preserved** in `tests/` folder.
- Manual inspection available: `npx playwright test --project=<name>`
- Re-enable anytime: change `testMatch` back to `'**/*.spec.js'`

---

## 🚦 Status Dashboard

| System | Status | Notes |
|--------|--------|-------|
| Game Engine | ✅ Running | Some bugs remain |
| AI | ✅ Working | Can be slow on complex boards |
| Draft Simulator | ✅ Working | BREAD scoring good |
| Deck Building | ✅ Working | Auto-build reliable |
| Card DB | ⚠️ ~80% complete | ECL set needs work |
| VFX System | ✅ Polished | 120+ sprite animations |
| Tests | 🔴 DISABLED | 761 tests preserved |

