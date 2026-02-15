#!/usr/bin/env node
/**
 * analyze-25-cards.js
 * Busca as 25 cartas no Scryfall para verificar oracle_text correto
 */

const https = require('https');

const cards25 = [
  'ambling stormshell',
  'boulderborn dragon',
  'descendant of storms',
  'marshal of the lost',
  'avenger of the fallen',
  'bone-cairn butcher',
  'dalkovan packbeasts',
  'dragonback lancer',
  'nightblade brigade',
  'reigning victor',
  'shock brigade',
  'mardu siegebreaker',
  'starry-eyed skyrider',
  'voice of victory',
  'veteran ice climber',
  'sinkhole surveyor',
  'stadium headliner',
  'zurgo\'s vanguard',
  'zurgo, thunder\'s decree',
  'jeskai shrinekeeper',
  'kotis, the fangkeeper',
  'tempest hawk',
  'reputable merchant',
  'rescue leopard',
  'traveling botanist'
];

async function fetchCardOracle(cardName) {
  return new Promise((resolve, reject) => {
    const encodedName = encodeURIComponent(cardName);
    const url = `https://api.scryfall.com/cards/search?q=name:"${cardName}"&unique=prints`;

    const options = {
      headers: { 'User-Agent': 'Magic-Analyzer/1.0' }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const card = json.data?.[0];
          if (card) {
            resolve({
              name: card.name,
              oracle_text: card.oracle_text || '',
              type_line: card.type_line || ''
            });
          } else {
            resolve({ name: cardName, oracle_text: '(not found)', type_line: '' });
          }
        } catch (e) {
          resolve({ name: cardName, oracle_text: '(error)', type_line: '' });
        }
      });
    }).on('error', () => {
      resolve({ name: cardName, oracle_text: '(network error)', type_line: '' });
    });
  });
}

async function main() {
  console.log('\n=== FETCHING 25 CARDS FROM SCRYFALL ===\n');

  for (let i = 0; i < cards25.length; i++) {
    const cardName = cards25[i];
    console.log(`${i + 1}/${cards25.length} ${cardName}...`);

    const card = await fetchCardOracle(cardName);

    console.log(`  Type: ${card.type_line}`);
    console.log(`  Oracle: ${card.oracle_text.substring(0, 150)}`);
    console.log('');

    // Rate limit
    if (i < cards25.length - 1) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log('=== ANALYSIS COMPLETE ===\n');
  console.log('Review oracle_text above to determine EXACT conditions for each card\n');
}

main().catch(console.error);
