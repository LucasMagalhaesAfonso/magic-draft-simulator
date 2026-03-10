#!/usr/bin/env npx tsx
// CLI: npx tsx tools/generate-card-tests.ts <set> [--card "Card Name"]
// Reads Scryfall JSON → oracle parser → test generator → writes .test.ts files

import * as fs from 'fs';
import * as path from 'path';
import { parseOracleText } from '../tests/helpers/oracle-parser';
import { generateTestCode, slugify } from '../tests/helpers/card-test-generator';
import type { CardInfo } from '../tests/helpers/card-test-generator';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: npx tsx tools/generate-card-tests.ts <set> [--card "Card Name"]');
  console.log('  set: ltr, tdm');
  console.log('  --card "Name": generate test for single card only');
  process.exit(1);
}

const setCode = args[0].toLowerCase();
const cardFilter = args.indexOf('--card') >= 0 ? args[args.indexOf('--card') + 1] : null;

// Find JSON file
const jsonPaths: Record<string, string> = {
  tdm: 'legacy-pure-js/js/data/scryfall-tdm.json',
  ltr: 'legacy-pure-js/js/data/scryfall-ltr.json',
};

const jsonPath = jsonPaths[setCode];
if (!jsonPath) {
  console.error(`Unknown set: ${setCode}. Available: ${Object.keys(jsonPaths).join(', ')}`);
  process.exit(1);
}

const fullPath = path.resolve(jsonPath);
if (!fs.existsSync(fullPath)) {
  console.error(`JSON file not found: ${fullPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
const cards: any[] = data.cards || [];

const outDir = path.resolve(`tests/cards/${setCode}`);
fs.mkdirSync(outDir, { recursive: true });

let generated = 0;
let skipped = 0;

for (const card of cards) {
  const name: string = card.name;
  const typeLine: string = card.type_line || '';
  const oracleText: string = card.oracle_text || '';
  const keywords: string[] = card.keywords || [];
  const manaCost: string = card.mana_cost || '';
  const power: string = card.power || '';
  const toughness: string = card.toughness || '';

  // Filter by card name if specified
  if (cardFilter && name.toLowerCase() !== cardFilter.toLowerCase()) continue;

  // Skip basic lands (they have mana ability text like "({T}: Add {G}.)")
  if (typeLine.includes('Basic Land')) {
    skipped++;
    continue;
  }

  // Skip vanilla creatures (no oracle text, no keywords beyond base)
  if (!oracleText.trim() && keywords.length === 0) {
    skipped++;
    continue;
  }

  // For double-faced / adventure cards, use front face oracle text
  let effectiveOracle = oracleText;
  if (card.card_faces && card.card_faces.length > 0) {
    effectiveOracle = card.card_faces.map((f: any) => f.oracle_text || '').join('\n');
  }

  const descriptors = parseOracleText(name, effectiveOracle, typeLine, keywords, power, toughness, manaCost);

  // Always generate at least the DB existence test
  const cardInfo: CardInfo = {
    name,
    typeLine,
    oracleText: effectiveOracle,
    manaCost,
    power,
    toughness,
    keywords,
    set: setCode,
  };

  const testCode = generateTestCode(cardInfo, descriptors);
  const slug = slugify(name);
  const outFile = path.join(outDir, `${slug}.test.ts`);

  // Fix import paths for nested test files
  const fixedCode = testCode
    .replace("from '../helpers/game-helper'", "from '../../helpers/game-helper'")
    .replace("from '../../src/engine/card-effects'", "from '../../../src/engine/card-effects'");

  fs.writeFileSync(outFile, fixedCode, 'utf-8');
  generated++;

  if (cardFilter) {
    console.log(`✅ Generated: ${outFile}`);
    console.log(`   ${descriptors.length} test(s) + DB existence check`);
  }
}

if (!cardFilter) {
  console.log(`\n📊 ${setCode.toUpperCase()} Test Generation Complete`);
  console.log(`   Generated: ${generated} test files`);
  console.log(`   Skipped:   ${skipped} (basic lands / vanilla)`);
  console.log(`   Output:    ${outDir}/`);
  console.log(`\nRun tests: npx vitest run tests/cards/${setCode}/`);
}
