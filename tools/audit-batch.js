#!/usr/bin/env node
/**
 * audit-batch.js
 * Versão simplificada para auditar cartas em lotes
 *
 * USO:
 *   node tools/audit-batch.js batch1        # Audita batch 1 (5 cartas)
 *   node tools/audit-batch.js batch2        # Audita batch 2 (5 cartas)
 *   node tools/audit-batch.js all25         # Audita todas as 25
 *   node tools/audit-batch.js "Card Name"   # Audita 1 carta
 */

const { spawn } = require('child_process');
const path = require('path');

const BATCHES = {
  batch1: [
    'Ambling Stormshell',
    'Avenger of the Fallen',
    'Boulderborn Dragon',
    'Descendant of Storms',
    'Marshal of the Lost'
  ],
  batch2: [
    'Bone-Cairn Butcher',
    'Dalkovan Packbeasts',
    'Dragonback Lancer',
    'Equilibrium Adept',
    'Jeskai Devotee'
  ],
  batch3: [
    'Jeskai Shrinekeeper',
    'Kotis, the Fangkeeper',
    'Mardu Siegebreaker',
    'Nightblade Brigade',
    'Reputable Merchant'
  ],
  batch4: [
    'Rescue Leopard',
    'Reigning Victor',
    'Shock Brigade',
    'Sinkhole Surveyor',
    'Stadium Headliner'
  ],
  batch5: [
    'Starry-Eyed Skyrider',
    'Tempest Hawk',
    'Traveling Botanist',
    'Voice of Victory',
    'Veteran Ice Climber',
    'Zurgo\'s Vanguard',
    'Zurgo, Thunder\'s Decree'
  ]
};

BATCHES.all25 = Object.values(BATCHES).flat();

function printUsage() {
  console.log(`\n📋 CARD AUDITOR - Simplified Usage\n`);
  console.log(`USAGE:`);
  console.log(`  node tools/audit-batch.js <batch|card>\n`);
  console.log(`BATCHES (5 cartas cada):`);
  console.log(`  batch1  - Ambling Stormshell, Avenger, Boulderborn, Descendant, Marshal`);
  console.log(`  batch2  - Bone-Cairn, Dalkovan, Dragonback, Equilibrium, Jeskai Devotee`);
  console.log(`  batch3  - Jeskai Shrinekeeper, Kotis, Mardu, Nightblade, Reputable`);
  console.log(`  batch4  - Rescue, Reigning, Shock Brigade, Sinkhole, Stadium`);
  console.log(`  batch5  - Starry-Eyed, Tempest, Traveling, Voice, Veteran, Zurgo x2\n`);
  console.log(`FULL:`);
  console.log(`  all25   - Audita todas as 25 cartas\n`);
  console.log(`SINGLE:`);
  console.log(`  "Card Name"  - Audita 1 carta específica\n`);
  console.log(`EXAMPLES:`);
  console.log(`  node tools/audit-batch.js batch1`);
  console.log(`  node tools/audit-batch.js all25`);
  console.log(`  node tools/audit-batch.js "Sage of the Skies"\n`);
}

async function runAudit(cards) {
  return new Promise((resolve) => {
    const auditor = path.join(__dirname, 'card-completeness-auditor.js');
    const args = cards;

    console.log(`\n🔍 Starting audit for ${cards.length} card(s)...\n`);

    const child = spawn('node', [auditor, ...args]);

    child.stdout.on('data', (data) => {
      process.stdout.write(data);
    });

    child.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ Audit complete!\n`);
      }
      resolve();
    });
  });
}

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    printUsage();
    process.exit(1);
  }

  let cards;

  if (arg === 'batch1' || arg === 'batch2' || arg === 'batch3' || arg === 'batch4' || arg === 'batch5') {
    cards = BATCHES[arg];
    console.log(`\n📊 BATCH: ${arg.toUpperCase()}`);
    console.log(`Cards: ${cards.join(', ')}`);
  } else if (arg === 'all25') {
    cards = BATCHES.all25;
    console.log(`\n📊 AUDITING ALL 25 CARDS`);
  } else {
    cards = [arg];
    console.log(`\n📊 AUDITING: ${arg}`);
  }

  await runAudit(cards);
}

main().catch(console.error);
