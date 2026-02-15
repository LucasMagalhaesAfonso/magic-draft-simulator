#!/usr/bin/env node
const https = require('https');

const cards = [
  "Fangkeeper's Familiar",
  "Felothar, Dawn of the Abzan",
  "Feral Deathgorger",
  "Fire-Rim Form",
  "Flamehold Grappler"
];

async function fetchCard(cardName) {
  return new Promise(resolve => {
    const query = encodeURIComponent(cardName);
    const url = `https://api.scryfall.com/cards/search?q=!"${query}" set:tdm`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.data && json.data.length > 0) {
            const card = json.data[0];
            resolve({
              name: card.name,
              mana: card.mana_cost || '',
              oracle: card.oracle_text || '',
              type: card.type_line || '',
              cmc: card.cmc || 0
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          console.error('Parse error:', e.message);
          resolve(null);
        }
      });
    }).on('error', (e) => {
      console.error('Request error:', e.message);
      resolve(null);
    });
  });
}

async function main() {
  console.log('Fetching Batch 16 cards...\n');

  for (const cardName of cards) {
    const card = await fetchCard(cardName);
    if (card) {
      console.log(`✅ ${card.name}`);
      console.log(`   Mana: ${card.mana}`);
      console.log(`   Type: ${card.type}`);
      console.log(`   Oracle: ${card.oracle.substring(0, 80)}...`);
      console.log();
    } else {
      console.log(`❌ ${cardName} not found`);
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

main();
