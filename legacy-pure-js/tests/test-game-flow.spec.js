/**
 * AI Turn Flow Test - Verify no thinking timeout bug
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

test.describe('AI Turn Flow - No Thinking Timeout', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('AI plays without thinking timeout after human passes turn', async () => {
    await page.goto('http://localhost:8000');
    await page.waitForTimeout(1000);

    // Start a new game
    await page.click('text=Novo Jogo');
    await page.waitForTimeout(1000);

    // Skip to game (bypass draft)
    await page.click('text=Pular Draft');
    await page.waitForTimeout(1000);

    // Wait for game to start
    await page.waitForSelector('.game-layout', { timeout: 10000 });

    // Handle mulligan
    const mulliganBtn = page.locator('text=Manter');
    if (await mulliganBtn.isVisible()) {
      await mulliganBtn.click();
      await page.waitForTimeout(2000);
    }

    // Wait for our turn
    await page.waitForSelector('.phase-main1.active', { timeout: 15000 });

    // Verify no AI thinking at start
    const aiThinking = page.locator('text=Oponente pensando');
    await expect(aiThinking).not.toBeVisible();

    // Try to play a land
    const handCards = page.locator('.hand-card');
    const handCount = await handCards.count();

    for (let i = 0; i < handCount; i++) {
      const card = handCards.nth(i);
      const cardText = await card.getAttribute('title');
      if (cardText && (cardText.includes('Land') || cardText.includes('Basic'))) {
        await card.click();
        break;
      }
    }

    // Pass the turn - this is the critical test
    const passBtn = page.locator('text=Passar');
    if (await passBtn.isVisible()) {
      await passBtn.click();
    } else {
      await page.keyboard.press('Space');
    }

    // CRITICAL TEST: verify AI thinking NEVER appears during opponent turn
    await page.waitForTimeout(2000);
    for (let i = 0; i < 15; i++) {
      const isThinking = await aiThinking.isVisible();
      if (isThinking) {
        throw new Error(`❌ AI thinking appeared at check ${i + 1} - BUG NOT FIXED`);
      }
      await page.waitForTimeout(200);
    }

    // Verify we get back to our turn (AI finished without timeout)
    await page.waitForSelector('.turn-player:has-text("Voce")', { timeout: 10000 });

    // Final verification - still no thinking indicator
    await expect(aiThinking).not.toBeVisible();
  });
});