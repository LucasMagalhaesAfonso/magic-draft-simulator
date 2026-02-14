# Magic Draft Simulator

A Magic: The Gathering draft and gameplay simulator written in vanilla HTML/CSS/JavaScript.

## 🚀 Quick Start

```bash
# Start local dev server
npx http-server . -p 8080 -c-1

# Open in browser
# http://127.0.0.1:8080
```

## 📁 Project Structure

```
magic_draft/
├── 📄 index.html                    # Main entry point
├── 📄 CLAUDE.md                     # Development guide
├── 📄 package.json                  # Dependencies
│
├── css/                             # Stylesheets
│   ├── style.css                    # Main styles
│   └── game.css                     # Game UI styles
│
├── img/                             # Assets
│   ├── sprites/                     # VFX animations (~120 PNGs)
│   └── playmat.png
│
├── js/                              # Core engine
│   ├── app.js                       # Main router
│   ├── draft.js                     # Draft simulator
│   ├── deckbuilder.js               # Deck building UI
│   ├── card-zoom.js                 # Card popup viewer
│   ├── ui-game.js                   # Game screen rendering
│   ├── scryfall.js                  # Scryfall API integration
│   │
│   └── game/                        # Game engine
│       ├── game-state.js            # Main game loop + phase management
│       ├── game-ai.js               # AI decision making
│       ├── stack.js                 # Spell/effect resolution
│       ├── cards.js                 # Card data parsers (ETB, triggers, etc)
│       ├── combat.js                # Combat system
│       ├── combat-sim.js            # Combat AI simulation
│       ├── mana.js                  # Mana system
│       ├── zones.js                 # Hand/bf/gy/library/exile zones
│       └── vfx.js                   # Visual effects system
│
│   └── data/                        # Game data
│       └── card-effects.js          # Card definitions + effect configs
│
├── tools/                           # Development utilities
│   ├── test-card-generator.js       # Universal card test script generator
│   ├── analyze-card.js              # Card analyzer (Scryfall validation)
│   ├── static-validator.js          # Static code validation
│   ├── ai-validator.js              # AI-powered validation
│   └── validate-card.js             # CLI validator
│
├── tests/                           # Automated tests (17 layers, 761 tests)
│   ├── layer-a/
│   ├── layer-b/
│   └── ... (A-Q)
│
├── tests-dev/                       # Development test files
│   └── (temporary test scripts)
│
├── docs/                            # Documentation
│   ├── TDM_*.md                     # Tarkir Dragonstorm analysis
│   ├── CLAUDE.md → (moved to root)
│   └── ... (analysis reports)
│
├── prints/                          # Screenshots (ignored in git)
├── playwright-report/               # Test reports (ignored in git)
└── test-results/                    # Test artifacts (ignored in git)
```

## 🎮 Key Files

### Engine Core
- **`js/game/game-state.js`** - Phase management, spell casting, trigger firing
- **`js/game/stack.js`** - Effect resolution (⚠️ critical: all effects defined here)
- **`js/game/game-ai.js`** - AI strategy + decision making
- **`js/game/cards.js`** - Card data parsing (ETB, triggers, keywords)

### Data
- **`js/data/card-effects.js`** - Card definitions database (277 TDM cards)

### UI
- **`js/ui-game.js`** - Game screen rendering
- **`js/deckbuilder.js`** - Deck building interface
- **`js/draft.js`** - Draft simulator

## 🧪 Testing Cards

### Generate Test Script
```javascript
// In browser console:
generateCardTestScript("Card Name")
generateCardTestScript("Molten Exhale", {
  copies: 2,                    // 2x main card
  basicLandColor: 'R',          // Mountain
  companions: ["Lightning Bolt"] // Optional companions
})
```

The script will:
1. Fetch card data from Scryfall
2. Auto-calculate mana needed
3. Generate test setup script
4. Copy to clipboard → paste in console → Draft → Skip to Game

## 🐛 Known Systems

### Implemented Mechanics
- **Basic**: Damage, destroy, exile, draw, buff, bounce
- **Advanced**: ETB triggers, cast triggers, modal spells, scry, surveil
- **Complex**: Copy spells, champion, evoke, transform/DFC, sagas, modal choose-two
- **Triggers**: 18+ trigger events with conditions (see MEMORY.md)
- **Keywords**: Flying, hexproof, shroud, ward, indestructible, vigilance, etc.

### Critical Bug Fixes (Feb 14, 2026)
- ✅ **Sage of the Skies**: cast_spell self flag validation
  - Trigger now fires only when Sage is cast (not any spell)
  - Fixed in game-state.js:375-382

## 📚 Documentation

- **CLAUDE.md** - Development workflow + critical files
- **docs/TDM_DETAILED_ANALYSIS.md** - Card implementation status
- **memory/MEMORY.md** - Architecture + implemented systems
- **memory/bugs-fixed.md** - Past fixes + lessons learned

## ⚙️ Development Workflow

### Adding a Card
1. Get oracle text from Scryfall
2. Add to `CardEffectsDB` in `js/data/card-effects.js`
3. Include: cast effects, ETB, triggered abilities, static keywords
4. Test with card generator script
5. Check `memory/MEMORY.md` for supported mechanics

### Before Committing
- [ ] Game loads without console errors
- [ ] Key card abilities work as expected
- [ ] No UI breaks
- [ ] Run Sage test: `generateCardTestScript("Sage of the Skies")`

## 🎯 Stats

- **Cards Implemented**: 271 / 277 TDM (98%)
- **Card Effects**: 113 different effect types
- **Conditions**: 36 different condition evaluations
- **Triggers**: 18+ trigger events with conditions
- **Test Layers**: 17 (761 tests total, currently preserved)
- **VFX Sprites**: ~120 animated PNGs
- **Code Size**: ~15k lines of JS engine + 2k lines card data

## 🚦 Running Tests

```bash
# Run specific layer
npx playwright test --project=layer-a

# View test report
npx playwright show-report
```

> Tests are currently preserved but disabled (can be re-enabled)

## 🔗 External Resources

- **Scryfall API**: https://scryfall.com/docs/api
- **Magic Rules**: https://mtg.fandom.com

---

**Last Updated**: Feb 14, 2026
**Status**: 🟢 Playable (95% complete)
