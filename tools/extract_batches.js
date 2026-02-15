#!/usr/bin/env node
const fs = require('fs');

const auditContent = fs.readFileSync('./TDM_COMPLETE_AUDIT.txt', 'utf8');

// Split by batch headers
const batchSections = auditContent.split(/BATCH \d+/);

// Extract batch numbers and card names
const batches = {};
const lines = auditContent.split('\n');

let currentBatch = null;
let cardCount = 0;

for (const line of lines) {
  const batchMatch = line.match(/^BATCH (\d+)/);
  if (batchMatch) {
    currentBatch = parseInt(batchMatch[1]);
    batches[`batch${currentBatch}`] = [];
    cardCount = 0;
    continue;
  }

  if (currentBatch && cardCount < 5) {
    const cardMatch = line.match(/^\s+\[\s*[^\]]*\]\s+([^|]+?)\s+\|/);
    if (cardMatch) {
      const cardName = cardMatch[1].trim();
      if (cardName && !cardName.startsWith('-')) {
        batches[`batch${currentBatch}`].push(cardName);
        cardCount++;
      }
    }
  }
}

// Output batches 17-56
console.log('const BATCHES = {');
for (let i = 17; i <= 56; i++) {
  const key = `batch${i}`;
  if (batches[key] && batches[key].length === 5) {
    const cards = batches[key].map(c => `'${c.replace(/'/g, "\\'")}'`).join(', ');
    console.log(`  ${key}: [${cards}],`);
  }
}
console.log('};');
