/**
 * Console script to add a card to your starting hand after draft
 *
 * Usage:
 * 1. Complete draft, click "Keep Hand" in mulligan
 * 2. Game starts (you're in hand phase, waiting for opponent)
 * 3. Open DevTools (F12)
 * 4. Run in console:
 *    addCardToHand('Dispelling Exhale', 3)  // adds 3 copies
 * 5. Cards appear in your hand immediately
 *
 * Safe to call multiple times - just adds more cards
 */

function addCardToHand(cardName, copies = 1) {
  if (!window.gameState) {
    console.error('❌ Game not initialized. Start a game first.');
    return;
  }

  const playerId = 0; // Player is always 0
  const hand = gameState.players[playerId].zones.hand;

  // Find card in Scryfall DB
  fetch(`https://api.scryfall.com/cards/search?q=name:"${cardName}"`)
    .then(r => r.json())
    .then(data => {
      if (!data.data || data.data.length === 0) {
        console.error(`❌ Card not found: ${cardName}`);
        return;
      }

      const cardData = data.data[0];
      console.log(`✅ Found: ${cardData.name} (${cardData.set.toUpperCase()})`);

      // Create card instances
      for (let i = 0; i < copies; i++) {
        const card = {
          name: cardData.name,
          id: cardData.id,
          _uid: `console-add-${Date.now()}-${i}`,
          type_line: cardData.type_line,
          oracle_text: cardData.oracle_text || '',
          mana_cost: cardData.mana_cost || '',
          cmc: cardData.cmc || 0,
          power: cardData.power ? parseInt(cardData.power) : null,
          toughness: cardData.toughness ? parseInt(cardData.toughness) : null,
          rarity: cardData.rarity || 'common',
          set: cardData.set.toUpperCase(),
          image_uris: cardData.image_uris,
          card_faces: cardData.card_faces,
          player: playerId
        };

        hand.add(card);
      }

      console.log(`✅ Added ${copies} copy(ies) of ${cardName} to your hand`);

      // Refresh UI if available
      if (window.UIGame && window.UIGame.redrawHand) {
        UIGame.redrawHand();
      }
    })
    .catch(err => {
      console.error(`❌ Error fetching card: ${err.message}`);
    });
}

// Convenience aliases
window.addCard = addCardToHand;
console.log('✅ addCardToHand() ready. Usage: addCardToHand("Card Name", 3)');
