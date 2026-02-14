/**
 * TEST CARD GENERATOR - Universal Card Testing Script
 *
 * Usage:
 *   generateCardTestScript("Sage of the Skies")
 *   generateCardTestScript("Molten Exhale", { copies: 2, companions: ["Lightning Bolt"] })
 */

async function generateCardTestScript(cardName, options = {}) {
  options = {
    copies: 3,           // How many copies of main card
    companions: [],      // Other cards to add
    basicLandColor: 'W', // Land color (W, U, B, R, G)
    extraTesting: null,  // Custom test scenario text
    ...options
  };

  console.log(`🔧 Generating test script for: ${cardName}\n`);

  // Fetch main card
  const mainRes = await fetch(`https://api.scryfall.com/cards/search?q=name:"${cardName}"&unique=prints`);
  const mainData = await mainRes.json();
  if (!mainData.data || mainData.data.length === 0) throw new Error(`Card not found: ${cardName}`);
  const mainCard = mainData.data[0];

  // Fetch companion cards
  const companions = [];
  for (const compName of options.companions) {
    const compRes = await fetch(`https://api.scryfall.com/cards/search?q=name:"${compName}"&unique=prints`);
    const compData = await compRes.json();
    if (compData.data && compData.data.length > 0) {
      companions.push(compData.data[0]);
    }
  }

  // Calculate mana needed
  const manaCost = mainCard.mana_cost || '';
  const { generic, colors } = parseMana(manaCost);

  // Determine land colors and count
  const landCount = calculateLandCount(manaCost, generic, colors, options.basicLandColor);

  console.log(`✅ Fetched: ${mainCard.name}`);
  if (companions.length > 0) console.log(`✅ Companions: ${companions.map(c => c.name).join(', ')}`);
  console.log(`💰 Mana cost: ${manaCost} (${generic}G + ${Object.entries(colors).map(([c,n]) => n+c).join('')})`);
  console.log(`🏞️  Lands: ${landCount} (${options.basicLandColor})\n`);

  // Generate script
  const script = generateScript(mainCard, companions, options, landCount, manaCost);

  // Copy to clipboard
  copyToClipboard(script);

  console.log('═'.repeat(70));
  console.log('✅ SCRIPT GENERATED AND COPIED TO CLIPBOARD');
  console.log('═'.repeat(70));
  console.log('\n📋 PASTE INTO BROWSER CONSOLE:');
  console.log('─'.repeat(70));
  console.log(script);
  console.log('─'.repeat(70));
  console.log('\nThen: Draft → Skip to Game → Keep Hand\n');
}

function parseMana(manaCost) {
  let generic = 0;
  const colors = { W: 0, U: 0, B: 0, R: 0, G: 0 };

  const matches = manaCost.match(/\{([^}]+)\}/g) || [];
  matches.forEach(match => {
    const inner = match.slice(1, -1);
    if (/^\d+$/.test(inner)) {
      generic += parseInt(inner);
    } else if (inner.length === 1 && colors[inner]) {
      colors[inner]++;
    }
  });

  return { generic, colors };
}

function calculateLandCount(manaCost, generic, colors, primaryColor) {
  let total = generic + Object.values(colors).reduce((a, b) => a + b, 0);
  total = Math.max(total, 3); // Min 3 lands

  // If no colored mana, all basics
  if (Object.values(colors).every(c => c === 0)) {
    return total;
  }

  // If has colors, ensure primary is available
  const coloredCount = Object.values(colors).reduce((a, b) => a + b, 0);
  const primaryNeeded = colors[primaryColor] || 0;

  // Allocate: primary color + others + generics
  return Math.min(total, 25); // Cap at 25
}

function getLandName(color) {
  const landMap = {
    W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest'
  };
  return landMap[color] || 'Plains';
}

function generateScript(mainCard, companions, options, landCount, manaCost) {
  const companionFetches = options.companions
    .map(name => `  fetch('https://api.scryfall.com/cards/search?q=name:"${name}"&unique=prints').then(r => r.json())`)
    .join(',\n');

  const companionProcessing = companions.length > 0
    ? `\n    // Add companions\n    ${companions.map((card, i) =>
        `const comp${i} = JSON.parse(JSON.stringify(companionCards[${i}]));\n    comp${i}._uid = 'companion-${i}';\n    state.players[0].zones.hand.add(comp${i});`
      ).join('\n    ')}\n    console.log('✅ ${companions.length}x Companions added');`
    : '';

  const script = `
fetch('https://api.scryfall.com/cards/search?q=name:"${mainCard.name}"&unique=prints').then(r => r.json()).then(mainRes => {
  const mainCard = mainRes.data[0];

  ${companionFetches ? `
  // Fetch companions
  Promise.all([${companionFetches}
  ]).then(companionResults => {
    const companionCards = companionResults.map(r => r.data[0]);
    setupTest(mainCard, companionCards);
  });` : `
  setupTest(mainCard, []);`}
}).catch(e => console.error('Error:', e));

function setupTest(mainCard, companions) {
  const origCreate = GameState.create;
  GameState.create = function(deck1, deck2) {
    const state = origCreate.call(this, deck1, deck2);

    // Clear hand
    const hand = state.players[0].zones.hand.getAll();
    hand.forEach(c => state.players[0].zones.hand.remove(c._uid));

    // Add ${options.copies}x main card
    for (let i = 0; i < ${options.copies}; i++) {
      const card = JSON.parse(JSON.stringify(mainCard));
      card._uid = 'main-' + i;
      state.players[0].zones.hand.add(card);
    }
    console.log('✅ ${options.copies}x ${mainCard.name} added');
    ${companionProcessing}

    // Add lands (${landCount}x ${getLandName(options.basicLandColor)})
    for (let i = 0; i < ${landCount}; i++) {
      state.players[0].zones.hand.add({
        id: 'land-' + i,
        name: '${getLandName(options.basicLandColor)}',
        type_line: 'Basic Land — ${getLandName(options.basicLandColor)}',
        mana_cost: '',
        cmc: 0,
        colors: ['${options.basicLandColor}'],
        oracle_text: '{T}: Add {${options.basicLandColor}}.',
        _uid: 'land-' + i
      });
    }
    console.log('✅ ${landCount}x ${getLandName(options.basicLandColor)} added\\n');

    console.log('═'.repeat(60));
    console.log('📋 TEST: ${mainCard.name}');
    console.log('═'.repeat(60));
    console.log('Mana: ${manaCost}');
    console.log('Lands: ${landCount}x ${getLandName(options.basicLandColor)}');
    console.log('═'.repeat(60) + '\\n');

    return state;
  };

  console.log('✅ Test setup ready! Draft → Skip to Game → Keep Hand\\n');
}
`;

  return script.trim();
}

function copyToClipboard(text) {
  // Browser environment
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text);
    return;
  }
  // Node.js or fallback
  console.log('(Copy-paste manually if clipboard unavailable)');
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateCardTestScript };
}
