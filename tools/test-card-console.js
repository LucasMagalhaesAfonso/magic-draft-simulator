/**
 * Console script: testCard("Card Name")
 *
 * Busca a carta no Scryfall, adiciona na mão do jogador humano,
 * e flutua mana suficiente para castá-la.
 *
 * Uso no console do browser:
 *   testCard("Herd Heirloom")
 *   testCard("Lightning Bolt", 3)        // 3 cópias
 *   testCard("Tersa, Lightshatter", 1, true)  // 1 cópia + adiciona no battlefield do oponente também
 */
window.testCard = async function testCard(name, copies = 1, alsoOpponent = false) {
  const gs = window.__gsRef?.current;
  const refresh = window.__gsRefresh;
  if (!gs) { console.error('Game state not found! Start a game first.'); return; }
  if (!refresh) { console.error('Refresh not found!'); return; }

  // Fetch from Scryfall
  console.log(`🔍 Buscando "${name}" no Scryfall...`);
  const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
  if (!res.ok) { console.error('Carta não encontrada no Scryfall!'); return; }
  const data = await res.json();

  // Parse mana cost colors
  const manaCost = data.mana_cost || '';
  const colors = new Set();
  const colorRegex = /\{([WUBRG])\}/gi;
  let m;
  while ((m = colorRegex.exec(manaCost)) !== null) colors.add(m[1].toUpperCase());
  // Hybrid mana
  const hybridRegex = /\{([WUBRG])\/([WUBRG])\}/gi;
  while ((m = hybridRegex.exec(manaCost)) !== null) { colors.add(m[1].toUpperCase()); }

  if (colors.size === 0 && data.cmc > 0) colors.add('C'); // colorless but has cost

  const cmc = data.cmc || 0;
  const landNames = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

  for (let i = 0; i < copies; i++) {
    const card = {
      id: data.id,
      name: data.name,
      mana_cost: data.mana_cost || '',
      cmc: data.cmc || 0,
      type_line: data.type_line || '',
      oracle_text: data.oracle_text || '',
      power: data.power,
      toughness: data.toughness,
      loyalty: data.loyalty,
      colors: data.colors || [],
      color_identity: data.color_identity || [],
      keywords: data.keywords || [],
      rarity: data.rarity || 'common',
      set: data.set || 'tdm',
      collector_number: data.collector_number || '0',
      image_uris: data.image_uris || undefined,
      card_faces: data.card_faces || undefined,
      layout: data.layout || 'normal',
      _uid: `test-inject-${Date.now()}-${i}`,
    };
    gs.players[0].zones.hand.add(card);
    console.log(`✅ ${card.name} adicionado à mão (${i + 1}/${copies})`);

    if (alsoOpponent) {
      const oppCard = JSON.parse(JSON.stringify(card));
      oppCard._uid = `test-inject-opp-${Date.now()}-${i}`;
      gs.players[1].zones.hand.add(oppCard);
      console.log(`✅ ${card.name} adicionado à mão do oponente`);
    }
  }

  // Add lands to hand + float mana for the cost
  const landsNeeded = Math.ceil(cmc);
  const colorArr = [...colors].filter(c => c !== 'C');

  if (landsNeeded > 0) {
    // Parse exact color requirements from mana cost
    const colorCounts = {};
    const singleColorRegex = /\{([WUBRG])\}/gi;
    while ((m = singleColorRegex.exec(manaCost)) !== null) {
      const c = m[1].toUpperCase();
      colorCounts[c] = (colorCounts[c] || 0) + 1;
    }

    // Calculate generic mana needed
    const genericMatch = manaCost.match(/\{(\d+)\}/);
    const genericNeeded = genericMatch ? parseInt(genericMatch[1]) : 0;

    // Add colored lands and tap them
    let landsAdded = 0;
    for (const [color, count] of Object.entries(colorCounts)) {
      for (let i = 0; i < count; i++) {
        const landName = landNames[color] || 'Island';
        const land = {
          id: `test-land-inject-${Date.now()}-${landsAdded}`,
          name: landName,
          type_line: `Basic Land — ${landName}`,
          mana_cost: '',
          cmc: 0,
          colors: [color],
          oracle_text: `{T}: Add {${color}}.`,
          _uid: `test-land-inject-${Date.now()}-${landsAdded}`,
        };
        gs.players[0].zones.battlefield.add(land);
        // Tap and add mana to pool
        land._tapped = true;
        gs.manaPool[0][color] = (gs.manaPool[0][color] || 0) + 1;
        landsAdded++;
      }
    }

    // Add generic lands (use first color or Mountain)
    const genericColor = colorArr[0] || 'R';
    const genericLandName = landNames[genericColor] || 'Mountain';
    for (let i = 0; i < genericNeeded; i++) {
      const land = {
        id: `test-land-inject-${Date.now()}-${landsAdded}`,
        name: genericLandName,
        type_line: `Basic Land — ${genericLandName}`,
        mana_cost: '',
        cmc: 0,
        colors: [genericColor],
        oracle_text: `{T}: Add {${genericColor}}.`,
        _uid: `test-land-inject-${Date.now()}-${landsAdded}`,
      };
      gs.players[0].zones.battlefield.add(land);
      land._tapped = true;
      gs.manaPool[0][genericColor] = (gs.manaPool[0][genericColor] || 0) + 1;
      landsAdded++;
    }

    console.log(`🏔️ ${landsAdded} lands adicionados ao battlefield (tapados) + mana flutuando`);
    console.log(`💧 Mana pool:`, JSON.stringify(gs.manaPool[0]));
  }

  refresh();
  console.log(`\n🎮 Pronto! Clique em "${data.name}" na mão para jogar.`);
  return data.name;
};

console.log('✅ testCard() carregado! Uso: testCard("Card Name") ou testCard("Card Name", 2)');
