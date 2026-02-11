/**
 * AI Thinking Bug Fix Test
 * Verifies that the AI doesn't get stuck in "Oponente pensando..." state
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

test.describe('AI Thinking Bug Fix', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('_continueIfAI function does not enable thinking', async () => {
    const result = await page.evaluate(() => {
      // Test that the _continueIfAI function doesn't set _aiThinking to true

      // Verify the function exists
      if (typeof UIGame._continueIfAI !== 'function') {
        return { success: false, error: '_continueIfAI function not found' };
      }

      // Create a minimal game state
      const mockGameState = {
        players: [
          { isHuman: true, zones: { battlefield: { cards: [] } } },
          { isHuman: false, zones: { battlefield: { cards: [] } } }
        ],
        waitingForInput: { playerId: 1 }, // AI needs to act
        winner: null
      };

      UIGame.gameState = mockGameState;

      // Ensure thinking is initially false
      UIGame._aiThinking = false;

      // Call the function multiple times to test for loops
      for (let i = 0; i < 10; i++) {
        UIGame._continueIfAI();

        // Check if thinking got enabled (this was the bug)
        if (UIGame._aiThinking) {
          return {
            success: false,
            error: `_aiThinking became true on iteration ${i + 1}`
          };
        }
      }

      // Verify thinking is still false after all calls
      if (UIGame._aiThinking) {
        return { success: false, error: '_aiThinking is true after test' };
      }

      return {
        success: true,
        message: '_continueIfAI correctly keeps _aiThinking false'
      };
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`AI Thinking Bug: ${result.error}`);
    }
  });
});