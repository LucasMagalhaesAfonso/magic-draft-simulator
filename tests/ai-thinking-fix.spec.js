/**
 * Test to verify AI thinking timeout bug is fixed
 */
const { test, expect } = require('@playwright/test');

test.describe('AI Thinking Fix Verification', () => {

  test('AI should NOT show "Oponente pensando" when playing', async ({ page }) => {
    // Start the game
    await page.goto('http://localhost:8000');
    await page.waitForTimeout(1000);

    // Start new game
    await page.click('text=Novo Jogo');
    await page.waitForTimeout(1000);

    // Skip draft
    await page.click('text=Pular Draft');
    await page.waitForTimeout(1000);

    // Wait for game layout
    await page.waitForSelector('.game-layout', { timeout: 10000 });

    // Handle mulligan if appears
    const keepBtn = page.locator('text=Manter');
    if (await keepBtn.isVisible({ timeout: 5000 })) {
      await keepBtn.click();
      await page.waitForTimeout(2000);
    }

    // Wait for our turn - main phase
    await page.waitForSelector('.phase-main1.active, .phase-main2.active', { timeout: 15000 });

    console.log('✓ Game started, player turn active');

    // Verify AI thinking is NOT shown initially
    const aiThinking = page.locator('text=Oponente pensando');
    await expect(aiThinking).not.toBeVisible();
    console.log('✓ No AI thinking at start');

    // Pass the turn to trigger AI
    const passBtn = page.locator('text=Passar');
    if (await passBtn.isVisible()) {
      await passBtn.click();
      console.log('✓ Clicked Pass button');
    } else {
      await page.keyboard.press('Space');
      console.log('✓ Pressed Space to pass');
    }

    // CRITICAL TEST: Monitor for AI thinking indicator for 5 seconds
    // If it appears, the bug is NOT fixed
    console.log('Monitoring for AI thinking bug...');

    let thinkingAppeared = false;
    const startTime = Date.now();

    while (Date.now() - startTime < 5000) { // Monitor for 5 seconds
      if (await aiThinking.isVisible()) {
        thinkingAppeared = true;
        break;
      }
      await page.waitForTimeout(100);
    }

    if (thinkingAppeared) {
      throw new Error('❌ BUG NOT FIXED: "Oponente pensando" appeared during AI turn');
    }

    console.log('✓ No AI thinking appeared during 5-second monitoring period');

    // Verify we eventually get back to our turn
    await page.waitForSelector('.turn-player:has-text("Voce")', { timeout: 10000 });
    console.log('✓ Turn successfully returned to player');

    // Final check - still no thinking indicator
    await expect(aiThinking).not.toBeVisible();
    console.log('✅ AI THINKING BUG FIXED - Game flows normally without timeout');
  });

});