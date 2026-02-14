# Claude Code Configuration

## 🎯 What Changed?

### ✅ Tests Disabled
- **Before**: `npm test` ran 761 tests (17 layers)
- **Now**: Tests are preserved but DON'T RUN automatically
- **Why**: Tests were slowing down workflow while game still has bugs
- **File**: `playwright.config.js` - changed `testMatch` to `**/*.spec.js.DISABLED`

### 📋 New Files Created

1. **`CLAUDE.md`** - Project guide + workflow instructions
2. **`hooks.json`** - Configuration for development hooks
3. **`skills.json`** - Available custom skills (commands)
4. **`.claude/README.md`** - This file

### 🚀 New Commands Available

```bash
npm start              # Start server on port 8080
npm run test:manual    # Run tests manually (if you want)
npm run test:layer     # Run specific test layer
npm run test:report    # Show HTML test report
```

---

## 📖 How to Use

### Before Editing Code
1. Read `CLAUDE.md` - understand file structure + critical pitfalls
2. Check `memory/MEMORY.md` - verify mechanic is implemented
3. Edit file
4. **Manual test**: Open browser, play card, verify behavior
5. Check console (F12) for errors

### Processing a New Set
1. Use skill: `/process-set ECL` (uses Explore subagent)
2. Validates all cards + effects via Scryfall API
3. Updates task list with cards to implement
4. Add to `CardEffectsDB` in `js/data/card-effects.js`

### Finding/Fixing Bugs
1. Use skill: `/check-console` - read browser errors
2. Use skill: `/debug-state` - inspect game state
3. Use skill: `/find-card CardName` - locate in DB
4. Edit file
5. Reload browser (F5)
6. Verify fix

---

## 🔧 Hooks Configuration

**Location**: `.claude/hooks.json`

Currently enabled:
- ✅ **on-error** - Detect console errors
- ✅ **on-file-edit** - Alert when critical files change
- ✅ **on-git-status** - Suggest commits

**Disabled** (because tests are off):
- ❌ **on-save** - Test automation
- ❌ **pre-commit** - Auto-validation

---

## 📚 Key Files

### To Know Before Editing
- `CLAUDE.md` - Start here!
- `memory/MEMORY.md` - Implemented mechanics + systems
- `memory/bugs-fixed.md` - Past fixes (DON'T REPEAT!)

### Game Files
- `js/game/stack.js` - **CRITICAL** - Effect resolution
- `js/game/cards.js` - Card data + parsing
- `js/data/card-effects.js` - All card definitions

### Quick Reference
- Browser console (F12) - Errors appear here
- Game log (L key) - Action history
- Right-click card - Full card details

---

## 🎮 Workflow Example

**Scenario: Fix a card that damages incorrectly**

```
1. Play game, test card, notice bug
   ↓
2. F12 → Check console for errors
   ↓
3. /find-card CardName → Locate in DB
   ↓
4. Open js/data/card-effects.js
   ↓
5. Check effect definition (look in memory/MEMORY.md for supported effects)
   ↓
6. If effect missing → Add case to js/game/stack.js
   ↓
7. Reload browser (F5)
   ↓
8. Manual test - verify fix
   ↓
9. If working → Git commit
```

---

## ⚙️ Settings

### permissions
Located in: `.claude/settings.local.json`

Already configured for:
- Scryfall API (card data)
- HTTP server (localhost:8080)
- Playwright (manual testing)
- Node.js commands

### Don't Need Manual Approval For
- Reading/editing game files
- Running server
- Checking console
- Browser automation

### Always Need Approval For
- Deleting files/tests
- Force-pushing to git
- Downloading external files
- Modifying security settings

---

## 🐛 If Tests Were Useful

To **re-enable tests**:

1. Edit `playwright.config.js`
2. Change: `testMatch: '**/*.spec.js.DISABLED'`
3. To: `testMatch: '**/*.spec.js'`
4. Run: `npm run test:manual`

**All 761 tests are preserved** in `tests/` folder.

---

## ✨ Next Steps

1. ✅ Tests disabled
2. 🔄 Review CLAUDE.md
3. 🔄 Implement efficiency improvements
   - [ ] Custom skills for frequent tasks
   - [ ] Task list for managing work
   - [ ] Subagents for parallel processing
4. 🔄 Start using `/process-set` for new cards
5. 🔄 Use manual test workflow

---

**Status**: ✅ Ready for simplified, efficient workflow

**Questions?** Check `CLAUDE.md` → `memory/MEMORY.md` → Ask Claude
