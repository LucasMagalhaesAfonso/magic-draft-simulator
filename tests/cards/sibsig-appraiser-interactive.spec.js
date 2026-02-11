// @ts-check
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

test.describe('Sibsig Appraiser - Interactive Look Top Fix', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await setupTestGame(page);
  });

  test('Human player gets interactive choice when casting Sibsig Appraiser', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Create Sibsig Appraiser
      const sibsig = T.makeCreature('Sibsig Appraiser', '2', '1', {
        cost: '{2}{W}', cmc: 3, colors: ['W'],
        typeLine: 'Creature — Human Wizard'
      });

      // Setup test state - Human player plays Sibsig Appraiser
      const state = T.createTestState({
        myHand: [sibsig],
        activePlayer: 0
      });

      // Set up known cards in library
      state.players[0].zones.library.clear();
      const card1 = T.makeCreature('Lightning Bolt', '0', '0', { cost: '{R}', cmc: 1 });
      const card2 = T.makeSpell('Giant Growth', '{G}', 1, 'Instant', '+3/+3', ['G']);
      state.players[0].zones.library.add(card2);
      state.players[0].zones.library.add(card1);

      // Mark human player
      state.players[0].isHuman = true;

      T.addMana(state, 0, '2W'); // Give human player mana

      // Cast Sibsig Appraiser
      GameState.autoTapForSpell(state, 0, '{2}{W}', 3);
      GameState.castSpell(state, 0, sibsig._uid);

      return {
        onBattlefield: T.bfCreatureNames(state, 0).includes('Sibsig Appraiser'),
        waitingForInput: state.waitingForInput?.type,
        hasPendingLookTop: !!state._pendingLookTop,
        pendingType: state._pendingLookTop?.type,
        pendingCards: state._pendingLookTop?.cards?.length,
        pendingPickCount: state._pendingLookTop?.pickCount,
        choices: state._pendingLookTop?.choices,
        handCountBefore: state.players[0].zones.hand.count(),
        gyCountBefore: state.players[0].zones.graveyard.count()
      };
    });

    // Verify that the interactive system is working
    expect(result.onBattlefield).toBe(true);
    expect(result.waitingForInput).toBe('look_top_choice');
    expect(result.hasPendingLookTop).toBe(true);
    expect(result.pendingType).toBe('look_top_choice');
    expect(result.pendingCards).toBe(2); // Should have 2 cards to choose from
    expect(result.pendingPickCount).toBe(1); // Should pick 1 for hand
    expect(result.choices).toEqual(['graveyard', 'graveyard']); // All default to graveyard

    console.log('Interactive Look Top Test Results:', result);
  });

  test('AI player still gets automatic choice (backward compatibility)', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Create Sibsig Appraiser
      const sibsig = T.makeCreature('Sibsig Appraiser', '2', '1', {
        cost: '{2}{W}', cmc: 3, colors: ['W'],
        typeLine: 'Creature — Human Wizard'
      });

      // Setup test state - AI player plays Sibsig Appraiser
      const state = T.createTestState({
        oppHand: [sibsig],
        activePlayer: 1
      });

      // AI player should not be human
      state.players[1].isHuman = false;

      T.addMana(state, 1, '2W'); // Give AI mana

      const handBefore = state.players[1].zones.hand.count();
      const gyBefore = state.players[1].zones.graveyard.count();

      // Cast Sibsig Appraiser
      GameState.autoTapForSpell(state, 1, '{2}{W}', 3);
      GameState.castSpell(state, 1, sibsig._uid);

      const handAfter = state.players[1].zones.hand.count();
      const gyAfter = state.players[1].zones.graveyard.count();

      return {
        onBattlefield: T.bfCreatureNames(state, 1).includes('Sibsig Appraiser'),
        waitingForInput: state.waitingForInput?.type,
        hasPendingLookTop: !!state._pendingLookTop,
        handBefore,
        handAfter,
        gyBefore,
        gyAfter,
        handDiff: handAfter - handBefore,
        gyDiff: gyAfter - gyBefore
      };
    });

    // Verify AI gets automatic resolution (no pending choice)
    expect(result.onBattlefield).toBe(true);
    expect(result.hasPendingLookTop).toBe(false);
    expect(result.handAfter).toBe(1); // AI should have +1 card in hand
    expect(result.gyDiff).toBe(1); // AI should have +1 card in graveyard

    console.log('AI Automatic Look Top Test Results:', result);
  });
});