/**
 * Test Helper - Simple testing interface
 *
 * Usage in console:
 *   testCard("Dispelling Exhale", 3, ["Lightning Bolt"])
 *   testCard("Molten Exhale")
 *   testCard("Sage of the Skies", 2)
 */

async function testCard(cardName, copies = 3, companions = []) {
  // If no companions, fetch a random dragon from Scryfall
  if (companions.length === 0) {
    console.log(`🐉 Buscando dragão aleatório...`);
    try {
      const dragonRes = await fetch(`https://api.scryfall.com/cards/random?q=type:dragon`);
      const dragonData = await dragonRes.json();
      if (dragonData && dragonData.name) {
        companions = [dragonData.name];
      }
    } catch (err) {
      console.warn(`⚠️ Não conseguiu buscar dragão aleatório: ${err.message}`);
      companions = [];
    }
  }
  console.log(`🧪 Configurando teste para: ${cardName}`);

  try {
    // Fetch main card
    const mainRes = await fetch(`https://api.scryfall.com/cards/search?q=name:"${cardName}"&unique=prints`);
    const mainData = await mainRes.json();

    if (!mainData.data || mainData.data.length === 0) {
      console.error(`❌ Carta não encontrada: ${cardName}`);
      return;
    }

    const mainCard = mainData.data[0];
    console.log(`✅ Carta encontrada: ${mainCard.name}`);

    // Fetch companions
    const companionList = [];
    for (const compName of companions) {
      const compRes = await fetch(`https://api.scryfall.com/cards/search?q=name:"${compName}"&unique=prints`);
      const compData = await compRes.json();
      if (compData.data && compData.data.length > 0) {
        companionList.push(compData.data[0]);
        console.log(`✅ Acompanhante: ${compData.data[0].name}`);
      }
    }

    // Calculate lands needed
    const manaCost = mainCard.mana_cost || '';
    let generic = 0;
    const colors = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    (manaCost.match(/\{([^}]+)\}/g) || []).forEach(m => {
      const inner = m.slice(1, -1);
      if (/^\d+$/.test(inner)) generic += parseInt(inner);
      else if (colors[inner]) colors[inner]++;
    });

    let landCount = generic + Object.values(colors).reduce((a, b) => a + b, 0);
    landCount = Math.max(landCount, 3);
    landCount = Math.min(landCount, 25);

    // Detect best land color (primary color needed)
    let primaryColor = 'U'; // Default to blue
    const colorCounts = Object.entries(colors).filter(([_, count]) => count > 0).sort((a, b) => b[1] - a[1]);
    if (colorCounts.length > 0) primaryColor = colorCounts[0][0];

    // Setup global test config
    window._testConfig = {
      mainCard,
      copies,
      companions: companionList,
      lands: landCount,
      landColor: primaryColor,
      clearHand: true
    };

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📋 TESTE CONFIGURADO`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`Carta Principal: ${mainCard.name} (${copies}x)`);
    console.log(`Acompanhantes: ${companionList.length > 0 ? companionList.map(c => c.name).join(', ') : 'Nenhum'}`);
    console.log(`Terras: ${landCount}x ${['W','U','B','R','G'].includes(primaryColor) ? {W:'Plains',U:'Island',B:'Swamp',R:'Mountain',G:'Forest'}[primaryColor] : 'Coluna'}`);
    console.log(`Mana: ${manaCost || '0'}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`\n⚠️  IMPORTANTE:`);
    console.log(`   1. Draft até o final`);
    console.log(`   2. Na tela de Mulligan: CLIQUE EM "KEEP HAND" (não faça mulligan!)`);
    console.log(`   3. Espere opponent atacar/castear`);
    console.log(`   4. Responda com a carta de teste!\n`);

  } catch (err) {
    console.error(`❌ Erro: ${err.message}`);
  }
}

// Make it available globally
window.testCard = testCard;

console.log('✅ Test helper carregado! Use: testCard("Card Name", copies, ["companion1", "companion2"])');
