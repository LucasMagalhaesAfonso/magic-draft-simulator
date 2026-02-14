// Quick test to verify Evolving Wilds UI fix
const { expect } = require('@playwright/test');

async function testEvolvingWildsUI(page) {
  await page.goto('http://localhost:3000');

  // Navigate to game
  await page.click('text=Pular para Jogo');
  await page.waitForSelector('.game-container');

  // Force Evolving Wilds into hand
  await page.evaluate(() => {
    const gs = window.gameState;
    if (!gs) return false;

    // Add Evolving Wilds to battlefield
    const evolvingWilds = {
      name: "Evolving Wilds",
      type_line: "Land",
      oracle_text: "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
      image_small: "",
      _uid: "evolving_wilds_test",
      _tapped: false,
      _summoningSick: false
    };

    gs.players[0].zones.battlefield.addCard(evolvingWilds);
    window.UIGame.render();
    return true;
  });

  // Check if Evolving Wilds shows ability indicator
  const hasAbilityIndicator = await page.evaluate(() => {
    const evolvingWildsCard = document.querySelector('[data-uid="evolving_wilds_test"]');
    if (!evolvingWildsCard) return false;

    const hasAbilityClass = evolvingWildsCard.classList.contains('has-ability');
    const hasIndicator = evolvingWildsCard.querySelector('.ability-indicator');

    return {
      hasAbilityClass,
      hasIndicator: !!hasIndicator,
      clickAction: evolvingWildsCard.getAttribute('onclick') || evolvingWildsCard.outerHTML
    };
  });

  console.log("Evolving Wilds UI Test Results:", hasAbilityIndicator);

  if (hasAbilityIndicator.hasAbilityClass && hasAbilityIndicator.hasIndicator) {
    console.log("✅ SUCCESS: Evolving Wilds shows as having activated ability!");
  } else {
    console.log("❌ FAILED: Evolving Wilds not showing ability indicator");
  }

  return hasAbilityIndicator;
}

module.exports = { testEvolvingWildsUI };