/**
 * Playwright test helpers for card-by-card testing.
 * Injects TestHelper into the browser context mirroring test-game.js patterns.
 */

async function setupTestGame(page) {
  await page.goto('/index.html', { waitUntil: 'load', timeout: 15000 });

  // Wait for all game engine globals to be available
  await page.waitForFunction(() =>
    typeof GameState !== 'undefined' &&
    typeof CardEngine !== 'undefined' &&
    typeof GameStack !== 'undefined' &&
    typeof ManaSystem !== 'undefined' &&
    typeof CombatSystem !== 'undefined' &&
    typeof PlayerZones !== 'undefined' &&
    typeof CardEffectsDB !== 'undefined',
    { timeout: 10000 }
  );

  // Inject TestHelper into browser context
  await page.evaluate(() => {
    window.TestHelper = {
      _uid() {
        return 'tc_' + Math.random().toString(36).slice(2, 8);
      },

      makeCreature(name, power, toughness, opts = {}) {
        return {
          id: name,
          _uid: this._uid(),
          name,
          type_line: opts.typeLine || 'Creature — Test',
          mana_cost: opts.cost || '',
          cmc: opts.cmc || 0,
          oracle_text: opts.oracle || '',
          colors: opts.colors || [],
          keywords: opts.keywords || [],
          power: String(power),
          toughness: String(toughness),
          image_small: null,
          image_normal: null,
          image_large: null,
          rarity: opts.rarity || 'common',
          subtypes: opts.subtypes || [],
          color_identity: opts.colors || []
        };
      },

      makeLand(name, color) {
        return {
          id: name,
          _uid: this._uid(),
          name,
          type_line: `Basic Land — ${name}`,
          mana_cost: '',
          cmc: 0,
          oracle_text: `{T}: Add {${color}}.`,
          colors: [color],
          keywords: [],
          power: null,
          toughness: null,
          rarity: 'common',
          subtypes: [name],
          color_identity: [color]
        };
      },

      makeSpell(name, cost, cmc, typeLine, oracle, colors) {
        return {
          id: name,
          _uid: this._uid(),
          name,
          type_line: typeLine || 'Instant',
          mana_cost: cost || '',
          cmc: cmc || 0,
          oracle_text: oracle || '',
          colors: colors || [],
          keywords: [],
          power: null,
          toughness: null,
          rarity: 'common',
          subtypes: [],
          color_identity: colors || []
        };
      },

      createTestState(opts = {}) {
        const state = {
          players: [
            { id: 0, life: opts.myLife || 20, isHuman: true, zones: new PlayerZones() },
            { id: 1, life: opts.oppLife || 20, isHuman: false, zones: new PlayerZones() }
          ],
          activePlayer: opts.activePlayer || 0,
          phase: opts.phase || 'main1',
          phaseIndex: 3,
          turn: opts.turn || 2,
          combat: CombatSystem.createCombatState(),
          stack: GameStack.create(),
          manaPool: [ManaSystem.createPool(), ManaSystem.createPool()],
          landPlayedThisTurn: false,
          winner: null,
          log: [],
          waitingForInput: null,
          turnHistory: [],
          mulliganCount: [0, 0],
          mulliganDone: [true, true],
          _triggers: [],
          _spellsThisTurn: [0, 0],
          _beholding: [null, null]
        };

        // Add hand cards
        (opts.myHand || []).forEach(c => state.players[0].zones.hand.add(c));
        (opts.oppHand || []).forEach(c => state.players[1].zones.hand.add(c));

        // Add battlefield cards + register triggers
        (opts.myBf || []).forEach(c => {
          state.players[0].zones.battlefield.add(c);
          GameState._registerCardTriggers(state, c, 0);
        });
        (opts.oppBf || []).forEach(c => {
          state.players[1].zones.battlefield.add(c);
          GameState._registerCardTriggers(state, c, 1);
        });

        // Fill libraries with filler cards
        for (let i = 0; i < 30; i++) {
          state.players[0].zones.library.add(this.makeCreature('Filler Bear ' + i, '2', '2', { cost: '{1}{G}', cmc: 2, colors: ['G'] }));
          state.players[1].zones.library.add(this.makeCreature('Filler Wolf ' + i, '2', '2', { cost: '{1}{R}', cmc: 2, colors: ['R'] }));
        }

        return state;
      },

      addMana(state, playerId, manaStr) {
        // Parse mana string like "2RR", "UU", "3WBG"
        const colors = { W: 0, U: 0, B: 0, R: 0, G: 0 };
        let generic = 0;
        for (const ch of manaStr) {
          if (ch in colors) colors[ch]++;
          else if (!isNaN(ch)) generic += parseInt(ch);
        }
        for (const [c, n] of Object.entries(colors)) {
          if (n > 0) state.manaPool[playerId][c] = (state.manaPool[playerId][c] || 0) + n;
        }
        // Generic goes as colorless or just generic
        if (generic > 0) {
          state.manaPool[playerId].generic = (state.manaPool[playerId].generic || 0) + generic;
        }
      },

      addLandsUntapped(state, playerId, lands) {
        lands.forEach(l => {
          const land = this.makeLand(l.name, l.color);
          const bl = CardEngine.prepareForBattlefield(land);
          bl._summoningSick = false;
          state.players[playerId].zones.battlefield.add(bl);
        });
      },

      snapshot(state) {
        const p0 = state.players[0];
        const p1 = state.players[1];
        const bf0 = p0.zones.battlefield.cards || [];
        const bf1 = p1.zones.battlefield.cards || [];
        return {
          myLife: p0.life,
          oppLife: p1.life,
          myBfCreatures: bf0.filter(c => CardEngine.isCreature(c)),
          oppBfCreatures: bf1.filter(c => CardEngine.isCreature(c)),
          myBfLands: bf0.filter(c => CardEngine.isLand(c)),
          myHandCount: p0.zones.hand.count(),
          oppHandCount: p1.zones.hand.count(),
          myGYCount: p0.zones.graveyard.count(),
          oppGYCount: p1.zones.graveyard.count(),
          myExileCount: p0.zones.exile.count(),
          oppExileCount: p1.zones.exile.count(),
          myBfAll: bf0,
          oppBfAll: bf1,
          log: state.log
        };
      },

      getCreatureByName(state, playerId, name) {
        const bf = state.players[playerId].zones.battlefield.cards || [];
        return bf.find(c => CardEngine.isCreature(c) && c.name === name);
      },

      countCreatures(state, playerId) {
        const bf = state.players[playerId].zones.battlefield.cards || [];
        return bf.filter(c => CardEngine.isCreature(c)).length;
      },

      countLands(state, playerId) {
        const bf = state.players[playerId].zones.battlefield.cards || [];
        return bf.filter(c => CardEngine.isLand(c)).length;
      },

      bfCreatureNames(state, playerId) {
        const bf = state.players[playerId].zones.battlefield.cards || [];
        return bf.filter(c => CardEngine.isCreature(c)).map(c => c.name);
      }
    };
  });
}

async function getAllTDMCards(page) {
  return await page.evaluate(() => {
    const cards = [];
    const tdmSection = true; // We read all keys
    for (const key of Object.keys(CardEffectsDB)) {
      if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
      if (typeof CardEffectsDB[key] === 'function') continue;
      const entry = CardEffectsDB[key];
      cards.push({
        name: key,
        hasCast: !!entry.cast,
        hasEtb: !!entry.etb,
        hasTriggered: !!entry.triggered,
        hasActivated: !!entry.activated,
        hasStatic: !!entry.static,
        hasModal: !!entry.modal,
        hasSaga: !!entry.saga,
        hasChapters: !!entry.chapters,
        effects: entry
      });
    }
    return cards;
  });
}

module.exports = { setupTestGame, getAllTDMCards };
