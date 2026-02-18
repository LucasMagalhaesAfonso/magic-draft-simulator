// @ts-check
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

test.describe('Rescue Leopard - Trigger Test', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await setupTestGame(page);
  });

  test('Rescue Leopard triggers when it becomes tapped', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Create Rescue Leopard
      const leopard = T.makeCreature('Rescue Leopard', '2', '1', {
        cost: '{1}{W}', cmc: 2, colors: ['W'],
        typeLine: 'Creature — Cat'
      });

      // Setup test state
      const state = T.createTestState({
        myBf: [leopard],
        activePlayer: 0
      });

      // Check if card has the trigger in CardEffectsDB
      const db = CardEffectsDB['rescue leopard'];
      const hasDB = !!db;
      const hasTriggered = db?.triggered?.length > 0;
      const triggerEvent = db?.triggered?.[0]?.event;
      const triggerEffects = db?.triggered?.[0]?.effects?.map(e => e.type);

      // Check if triggers are registered on the card
      const cardOnBf = state.players[0].zones.battlefield.cards[0];
      const triggersRegistered = state._triggers.filter(t => t.cardUid === cardOnBf._uid);

      // Manually tap the card and see if trigger fires
      const handBefore = state.players[0].zones.hand.count();
      cardOnBf._tapped = true;

      // Fire the becomes_tapped trigger manually
      const triggerLogs = GameState.fireTrigger(state, 'becomes_tapped', {
        cardUid: cardOnBf._uid,
        card: cardOnBf,
        controllerId: 0
      });

      const handAfter = state.players[0].zones.hand.count();
      const waitingForInput = state.waitingForInput?.type;
      const hasPendingRummage = !!state._pendingRummage;

      return {
        // DB checks
        hasDB,
        hasTriggered,
        triggerEvent,
        triggerEffects,

        // Runtime checks
        triggersRegistered: triggersRegistered.length,
        triggerLogCount: triggerLogs.length,
        triggerLogs,

        // Effect checks
        handBefore,
        handAfter,
        waitingForInput,
        hasPendingRummage,

        // Debug info
        cardUid: cardOnBf._uid,
        cardName: cardOnBf.name,
        cardTapped: cardOnBf._tapped,
        allTriggers: state._triggers.map(t => ({ event: t.event, cardUid: t.cardUid, self: t.self }))
      };
    });

    // Verify CardEffectsDB has the trigger
    expect(result.hasDB).toBe(true);
    expect(result.hasTriggered).toBe(true);
    expect(result.triggerEvent).toBe('becomes_tapped');
    expect(result.triggerEffects).toContain('rummage');

    // Verify trigger was registered
    expect(result.triggersRegistered).toBe(1);

    // Verify trigger fired when card became tapped
    expect(result.triggerLogCount).toBeGreaterThan(0);

    // For human player, should set up rummage choice
    expect(result.waitingForInput).toBe('rummage_discard');
    expect(result.hasPendingRummage).toBe(true);

    console.log('Rescue Leopard Test Results:', result);
  });

  test('Rescue Leopard works correctly for AI', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Create Rescue Leopard for AI
      const leopard = T.makeCreature('Rescue Leopard', '2', '1', {
        cost: '{1}{W}', cmc: 2, colors: ['W'],
        typeLine: 'Creature — Cat'
      });

      // Setup test state - AI has the Rescue Leopard
      const state = T.createTestState({
        oppBf: [leopard],
        activePlayer: 1
      });

      // Ensure AI is correctly identified
      state.players[1].isHuman = false;

      const cardOnBf = state.players[1].zones.battlefield.cards[0];
      const handBefore = state.players[1].zones.hand.count();

      // Tap the card and fire trigger
      cardOnBf._tapped = true;
      const triggerLogs = GameState.fireTrigger(state, 'becomes_tapped', {
        cardUid: cardOnBf._uid,
        card: cardOnBf,
        controllerId: 1
      });

      const handAfter = state.players[1].zones.hand.count();
      const waitingForInput = state.waitingForInput?.type;

      return {
        isAIHuman: state.players[1].isHuman,
        handBefore,
        handAfter,
        handDiff: handAfter - handBefore,
        triggerLogCount: triggerLogs.length,
        triggerLogs,
        waitingForInput,
        shouldAutoResolve: !state.waitingForInput // AI should auto-resolve
      };
    });

    // Verify AI is correctly identified
    expect(result.isAIHuman).toBe(false);

    // Verify trigger fired
    expect(result.triggerLogCount).toBeGreaterThan(0);

    // For AI, should auto-resolve (no waiting for input)
    expect(result.waitingForInput).toBeUndefined();
    expect(result.shouldAutoResolve).toBe(true);

    // AI might draw/discard depending on hand quality
    console.log('AI Rescue Leopard Test Results:', result);
  });

  test('Rescue Leopard triggers during combat when attacking', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Create Rescue Leopard
      const leopard = T.makeCreature('Rescue Leopard', '2', '1', {
        cost: '{1}{W}', cmc: 2, colors: ['W'],
        typeLine: 'Creature — Cat'
      });

      // Setup test state
      const state = T.createTestState({
        myBf: [leopard],
        activePlayer: 0,
        phase: 'combat_declare_attackers'
      });

      const cardOnBf = state.players[0].zones.battlefield.cards[0];

      // Ensure card is not already tapped
      cardOnBf._tapped = false;

      // Simulate attacking (which should tap the creature and trigger the ability)
      // This simulates what happens during declare attackers
      if (!CardEngine.hasKeyword(cardOnBf, 'Vigilance')) {
        const wasTapped = cardOnBf._tapped;
        cardOnBf._tapped = true;
        cardOnBf._tappedByAttack = true;

        // This should fire the becomes_tapped trigger
        const triggerLogs = !wasTapped ? GameState.fireTrigger(state, 'becomes_tapped', {
          cardUid: cardOnBf._uid,
          card: cardOnBf,
          controllerId: 0
        }) : [];

        return {
          wasTappedBefore: wasTapped,
          isTappedAfter: cardOnBf._tapped,
          triggerFired: triggerLogs.length > 0,
          triggerLogs,
          waitingForInput: state.waitingForInput?.type,
          hasPendingRummage: !!state._pendingRummage
        };
      }

      return { error: 'Vigilance prevented tapping' };
    });

    expect(result.error).toBeUndefined();
    expect(result.wasTappedBefore).toBe(false);
    expect(result.isTappedAfter).toBe(true);
    expect(result.triggerFired).toBe(true);
    expect(result.waitingForInput).toBe('rummage_discard');
    expect(result.hasPendingRummage).toBe(true);

    console.log('Combat Trigger Test Results:', result);
  });
});