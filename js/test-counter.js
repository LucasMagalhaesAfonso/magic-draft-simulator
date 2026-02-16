/**
 * Test Counter Spells - Force opponent to cast spell so we can counter
 *
 * Usage: testCounter("Dispelling Exhale")
 */

async function testCounter(counterName) {
  console.log(`🎯 Setting up counter spell test: ${counterName}`);

  try {
    // Fetch counter card
    const counterRes = await fetch(`https://api.scryfall.com/cards/search?q=name:"${counterName}"&unique=prints`);
    const counterData = await counterRes.json();
    if (!counterData.data || counterData.data.length === 0) {
      console.error(`❌ Counter card not found: ${counterName}`);
      return;
    }
    const counterCard = counterData.data[0];

    // Fetch a simple spell for opponent to cast
    const spellRes = await fetch(`https://api.scryfall.com/cards/random?q=type:instant OR type:sorcery cmc<4`);
    const spellData = await spellRes.json();
    const opponentSpell = spellData && spellData.name ? spellData : null;

    console.log(`✅ Counter card: ${counterCard.name}`);
    console.log(`✅ Opponent spell: ${opponentSpell ? opponentSpell.name : 'Random spell'}`);

    // Setup interceptor in GameState.playTurn
    const origPlayTurn = GameState.playTurn;
    GameState.playTurn = function(state) {
      if (state.activePlayer === 1 && state.phase === 'main1') {
        console.log(`[TEST] Opponent in main1, forcing spell cast...`);
        // Let opponent play normally - they should cast a spell if they have one
      }
      return origPlayTurn.call(this, state);
    };

    // Setup game state injection
    window._testConfig = {
      mainCard: counterCard,
      copies: 3,
      companions: [],
      lands: 20,
      landColor: 'U',
      clearHand: true
    };

    // Intercept game creation to add opponent spell to their hand
    const origCreate = GameState.create;
    GameState.create = function(deck1, deck2) {
      const state = origCreate.call(this, deck1, deck2);

      // Add opponent spell to opponent's hand
      if (opponentSpell) {
        const oppHand = state.players[1].zones.hand;
        const oppSpell = {
          name: opponentSpell.name,
          id: opponentSpell.id,
          _uid: 'opp-spell-' + Date.now(),
          type_line: opponentSpell.type_line || 'Instant',
          oracle_text: opponentSpell.oracle_text || '',
          mana_cost: opponentSpell.mana_cost || '{1}',
          cmc: opponentSpell.cmc || 1,
          rarity: opponentSpell.rarity || 'common',
          set: opponentSpell.set ? opponentSpell.set.toUpperCase() : 'TST',
          image_uris: opponentSpell.image_uris,
          colors: opponentSpell.colors || [],
          player: 1
        };
        oppHand.add(oppSpell);
        console.log(`✅ Added ${opponentSpell.name} to opponent's hand`);
      }

      return state;
    };

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📋 COUNTER SPELL TEST SETUP`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`Your hand: 3x ${counterCard.name} + 20x Islands`);
    console.log(`Opponent will have a spell to cast in main phase`);
    console.log(`When opponent casts, you'll see counter options!`);
    console.log(`${'═'.repeat(60)}\n`);

    console.log(`✅ Ready! Draft → Skip to Game → Keep Hand → Wait for opponent main phase`);

  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
  }
}

window.testCounter = testCounter;
console.log(`✅ testCounter loaded! Usage: testCounter("Dispelling Exhale")`);
