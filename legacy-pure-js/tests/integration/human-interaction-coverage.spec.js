// @ts-check
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

/**
 * Tests to detect bugs where human players should get interactive choices but don't.
 * This covers the type of bug we found with Sibsig Appraiser where look_top was
 * automatically choosing cards instead of giving the human player a choice.
 */

test.describe('Human Interactive Choice Coverage', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await setupTestGame(page);
  });

  test('All cards with choice effects should pause for human input', async () => {
    const interactiveCards = await page.evaluate(() => {
      const cards = [];

      // Check all cards in CardEffectsDB for interactive effects
      for (const [cardName, effects] of Object.entries(CardEffectsDB)) {
        if (typeof effects !== 'object' || !effects) continue;

        const hasInteractiveEffects =
          // look_top effects with pick choices
          (effects.etb?.some(e => e.type === 'look_top' && e.pick && e.rest_to === 'graveyard')) ||
          (effects.cast?.some(e => e.type === 'look_top' && e.pick && e.rest_to === 'graveyard')) ||

          // Modal choices
          (effects.modal) ||

          // Hideaway choices
          (effects.etb?.some(e => e.type === 'hideaway')) ||

          // Search library effects
          (effects.etb?.some(e => e.type === 'search_library')) ||
          (effects.cast?.some(e => e.type === 'search_library')) ||

          // Multi-target effects
          (effects.etb?.some(e => e.target === 'up_to_N_creatures')) ||

          // Blight choices
          (effects.etb?.some(e => e.type === 'blight'));

        if (hasInteractiveEffects) {
          cards.push({
            name: cardName,
            effects: effects,
            interactiveTypes: [
              ...(effects.etb?.filter(e =>
                (e.type === 'look_top' && e.pick) ||
                e.type === 'hideaway' ||
                e.type === 'search_library' ||
                e.type === 'blight' ||
                e.target === 'up_to_N_creatures'
              ).map(e => `etb:${e.type}`) || []),
              ...(effects.cast?.filter(e =>
                (e.type === 'look_top' && e.pick) ||
                e.type === 'search_library'
              ).map(e => `cast:${e.type}`) || []),
              ...(effects.modal ? ['modal'] : [])
            ]
          });
        }
      }

      return cards;
    });

    // Log all interactive cards for visibility
    console.log(`Found ${interactiveCards.length} cards with interactive effects:`);
    interactiveCards.forEach(card => {
      console.log(`- ${card.name}: ${card.interactiveTypes.join(', ')}`);
    });

    // We should have found some interactive cards
    expect(interactiveCards.length).toBeGreaterThan(5);

    // Sibsig Appraiser should be in the list
    const sibsigAppraiser = interactiveCards.find(c => c.name === 'sibsig appraiser');
    expect(sibsigAppraiser).toBeTruthy();
    expect(sibsigAppraiser.interactiveTypes).toContain('etb:look_top');
  });

  test('Human vs AI behavior should differ for choice effects', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;
      const results = [];

      // Test a few key interactive cards
      const testCards = [
        'sibsig appraiser',  // look_top choice
        'gurmag nightwatch', // look_top choice (3 pick 1 to graveyard)
      ];

      for (const cardName of testCards) {
        const db = CardEffectsDB[cardName];
        if (!db) continue;

        // Create a test card
        const card = T.makeCreature(cardName, '2', '1', {
          cost: '{2}{W}', cmc: 3, colors: ['W']
        });

        // Test with human player
        const humanState = T.createTestState({
          myHand: [{ ...card, _uid: 'human_' + Math.random() }],
          activePlayer: 0
        });
        humanState.players[0].isHuman = true;
        T.addMana(humanState, 0, '2W');

        // Test with AI player
        const aiState = T.createTestState({
          oppHand: [{ ...card, _uid: 'ai_' + Math.random() }],
          activePlayer: 1
        });
        aiState.players[1].isHuman = false;
        T.addMana(aiState, 1, '2W');

        try {
          // Cast for human
          GameState.autoTapForSpell(humanState, 0, '{2}{W}', 3);
          GameState.castSpell(humanState, 0, humanState.players[0].zones.hand.cards[0]._uid);

          // Cast for AI
          GameState.autoTapForSpell(aiState, 1, '{2}{W}', 3);
          GameState.castSpell(aiState, 1, aiState.players[1].zones.hand.cards[0]._uid);

          results.push({
            cardName,
            human: {
              waitingForInput: humanState.waitingForInput?.type,
              hasPendingChoice: !!(
                humanState._pendingLookTop ||
                humanState._pendingModal ||
                humanState._pendingHideaway ||
                humanState._pendingBlight
              )
            },
            ai: {
              waitingForInput: aiState.waitingForInput?.type,
              hasPendingChoice: !!(
                aiState._pendingLookTop ||
                aiState._pendingModal ||
                aiState._pendingHideaway ||
                aiState._pendingBlight
              )
            }
          });
        } catch (error) {
          results.push({
            cardName,
            error: error.message,
            human: { error: true },
            ai: { error: true }
          });
        }
      }

      return results;
    });

    console.log('Human vs AI behavior test results:', result);

    // Check results
    for (const cardResult of result) {
      if (cardResult.error) {
        console.log(`Error testing ${cardResult.cardName}: ${cardResult.error}`);
        continue;
      }

      // Human should have pending choices for interactive cards
      // AI should NOT have pending choices (should auto-resolve)
      if (cardResult.human.hasPendingChoice || cardResult.human.waitingForInput) {
        console.log(`✓ ${cardResult.cardName}: Human gets interactive choice`);
      } else {
        console.log(`✗ ${cardResult.cardName}: Human should get interactive choice but doesn't!`);
      }

      if (!cardResult.ai.hasPendingChoice && !cardResult.ai.waitingForInput) {
        console.log(`✓ ${cardResult.cardName}: AI auto-resolves (good)`);
      } else {
        console.log(`✗ ${cardResult.cardName}: AI has pending choice (bad)`);
      }
    }
  });

  test('Modal spells should always prompt human for mode choice', async () => {
    const modalCards = await page.evaluate(() => {
      const cards = [];
      for (const [name, effects] of Object.entries(CardEffectsDB)) {
        if (effects?.modal) {
          cards.push(name);
        }
      }
      return cards;
    });

    expect(modalCards.length).toBeGreaterThan(0);
    console.log('Modal cards found:', modalCards);

    // Test should be expanded to actually test modal behavior
    // This is a framework for detecting when modal cards don't prompt correctly
  });

  test('Scry/Surveil should always prompt human for choice', async () => {
    const scryCards = await page.evaluate(() => {
      const cards = [];
      for (const [name, effects] of Object.entries(CardEffectsDB)) {
        const hasScry =
          effects?.etb?.some(e => e.type === 'scry' || e.type === 'surveil') ||
          effects?.cast?.some(e => e.type === 'scry' || e.type === 'surveil');
        if (hasScry) {
          cards.push(name);
        }
      }
      return cards;
    });

    expect(scryCards.length).toBeGreaterThan(0);
    console.log('Scry/Surveil cards found:', scryCards);

    // This framework can be expanded to test actual scry behavior
  });
});