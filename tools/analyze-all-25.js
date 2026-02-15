#!/usr/bin/env node
/**
 * analyze-all-25.js
 * Analisa todas as 25 cartas em ordem alfabética
 * Busca Scryfall + verifica DB + gera relatório
 */

const https = require('https');

const cards25 = [
  'ambling stormshell',
  'avenger of the fallen',
  'becomes_tapped issue - searching...',
  'boulderborn dragon',
  'descendant of storms',
  'dragonback lancer',
  'dalkovan packbeasts',
  'equilibrium adept',
  'jeskai devotee',
  'jeskai shrinekeeper',
  'kotis, the fangkeeper',
  'nightblade brigade',
  'marshal of the lost',
  'mardu siegebreaker',
  'reputable merchant',
  'rescue leopard',
  'reigning victor',
  'shock brigade',
  'sinkhole surveyor',
  'stadium headliner',
  'starry-eyed skyrider',
  'tempest hawk',
  'traveling botanist',
  'voice of victory',
  'veteran ice climber',
  'zurgo\'s vanguard',
  'zurgo, thunder\'s decree'
].filter(c => !c.includes('issue')).sort();

async function fetchCard(cardName) {
  return new Promise((resolve) => {
    const url = 'https://api.scryfall.com/cards/search?q=name:\"' + encodeURIComponent(cardName) + '\"&unique=prints';
    https.get(url, { headers: { 'User-Agent': 'Analyzer' } }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const card = json.data?.[0];
          const oracle = card?.oracle_text || '(not found)';

          // Determine trigger type from oracle
          let triggerPattern = 'unknown';
          if (oracle.includes('Whenever this creature attacks')) triggerPattern = 'THIS attacks → self:true';
          else if (oracle.includes('Whenever you attack')) triggerPattern = 'YOU attack → self:false';
          else if (oracle.includes('Whenever you cast')) triggerPattern = 'YOU cast → self:false';
          else if (oracle.includes('Whenever this creature')) triggerPattern = 'THIS creature → self:true';
          else if (oracle.includes('Whenever this') && oracle.includes('dies')) triggerPattern = 'THIS dies → self:true';
          else if (oracle.includes('Whenever this') && oracle.includes('tapped')) triggerPattern = 'THIS tapped → self:true';
          else if (oracle.includes('Whenever')) triggerPattern = 'OTHER pattern';

          resolve({
            name: card?.name || cardName,
            oracle: oracle.split('\n')[0], // First line only
            triggerPattern
          });
        } catch(e) { resolve({ name: cardName, oracle: '(error)', triggerPattern: 'error' }); }
      });
    });
  });
}

(async () => {
  console.log('\n=== ANALYZING 25 CARDS (ALPHABETICAL) ===\n');
  console.log('Card | Trigger Pattern | Expected self | Notes');
  console.log('-'.repeat(80));

  for (const card of cards25) {
    const data = await fetchCard(card);
    console.log(`${data.name.padEnd(30)} | ${data.triggerPattern}`);
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n✓ Analysis complete\n');
})();
