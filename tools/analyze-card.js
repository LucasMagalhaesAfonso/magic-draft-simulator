#!/usr/bin/env node
/**
 * Analyze Magic card from Scryfall and validate/fix CardEffectsDB entry
 * Usage: node tools/analyze-card.js "Card Name"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Load CardEffectsDB
const dbPath = path.join(__dirname, '../js/data/card-effects.js');
let CardEffectsDB = {};
try {
  const dbContent = fs.readFileSync(dbPath, 'utf8');
  const match = dbContent.match(/const CardEffectsDB = \{([\s\S]*)\};/);
  if (match) {
    // Simple eval (not ideal but works for this use case)
    eval('CardEffectsDB = {' + match[1] + '}');
  }
} catch (e) {
  console.error('Error loading CardEffectsDB:', e.message);
}

const cardName = process.argv[2];
if (!cardName) {
  console.log('Usage: node tools/analyze-card.js "Card Name"');
  process.exit(1);
}

// Fetch from Scryfall
const encodedName = encodeURIComponent(cardName);
const url = `https://api.scryfall.com/cards/search?q=name:"${cardName}"&unique=prints`;

const options = {
  headers: {
    'User-Agent': 'Magic-Draft-Analyzer/1.0',
    'Accept': 'application/json'
  }
};

https.get(url, options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      const card = json.data?.[0];

      if (!card) {
        console.log(`❌ Card not found: ${cardName}`);
        process.exit(1);
      }

      analyzeCard(card);
    } catch (e) {
      console.error('Error parsing Scryfall response:', e.message);
      process.exit(1);
    }
  });
}).on('error', err => {
  console.error('Network error:', err.message);
  process.exit(1);
});

function analyzeCard(card) {
  const name = card.name;
  const oracleText = card.oracle_text || '';
  const typeLine = card.type_line || '';
  const manaCost = card.mana_cost || '';
  const cmc = card.cmc || 0;
  const isInstant = typeLine.includes('Instant');
  const isSorcery = typeLine.includes('Sorcery');
  const isCreature = typeLine.includes('Creature');

  console.log(`\n📋 ANALYZING: ${name}`);
  console.log(`Type: ${typeLine} | Mana: ${manaCost} | CMC: ${cmc}`);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  let dbKey = name.toLowerCase();
  let dbEntry = CardEffectsDB[dbKey];

  // Fallback for adventure cards: try front face name only
  if (!dbEntry && name.includes('//')) {
    const frontFace = name.split('//')[0].trim().toLowerCase();
    dbEntry = CardEffectsDB[frontFace];
    if (dbEntry) dbKey = frontFace;
  }

  // Check 1: Card in DB?
  console.log(`[1] CardEffectsDB Entry: ${dbEntry ? '✅ EXISTS' : '❌ MISSING'}`);
  if (!dbEntry) {
    console.log(`    → Add entry for "${name}"\n`);
    return; // Can't analyze further without DB entry
  }

  console.log(`    Found: ${JSON.stringify(dbEntry).slice(0, 100)}...\n`);

  const issues = [];
  const suggestions = [];

  // Check 2: ETB Effects
  if (isCreature && oracleText.toLowerCase().includes('enters')) {
    if (!dbEntry.etb || dbEntry.etb.length === 0) {
      issues.push('Missing ETB effects for creature that "enters"');
      suggestions.push(`Add: etb: [{ type: "...", ... }]`);
    } else {
      console.log(`[2] ETB Effects: ✅ ${dbEntry.etb.length} effect(s) defined`);
    }
  }

  // Check 3: Cast/Spell Effects
  if ((isInstant || isSorcery) && oracleText) {
    if (!dbEntry.cast || dbEntry.cast.length === 0) {
      issues.push('Missing cast effects for instant/sorcery');
      suggestions.push(`Add: cast: [{ type: "...", ... }]`);
    } else {
      console.log(`[3] Cast Effects: ✅ ${dbEntry.cast.length} effect(s) defined`);
    }
  }

  // Check 4: Triggered Abilities
  const triggerKeywords = ['whenever', 'when ', 'each time'];
  const hasTrigger = triggerKeywords.some(kw => oracleText.toLowerCase().includes(kw));
  if (hasTrigger) {
    if (!dbEntry.triggered || dbEntry.triggered.length === 0) {
      issues.push('Missing triggered abilities');
      suggestions.push(`Add: triggered: [{ event: "...", effects: [...] }]`);
    } else {
      console.log(`[4] Triggered Abilities: ✅ ${dbEntry.triggered.length} ability(ies) defined`);
    }
  }

  // Check 5: Multiple Targets
  const targetMatches = (oracleText.match(/target/gi) || []).length;
  if (targetMatches > 1) {
    const hasTargetIndex = dbEntry.cast?.some(e => e.target_index !== undefined);
    if (!hasTargetIndex && targetMatches > 1) {
      issues.push(`Multiple targets (${targetMatches}) but no target_index markers`);
      suggestions.push(`Add target_index: 0, 1, 2... to each effect with different target type`);
    } else {
      console.log(`[5] Multi-Target: ✅ Targets indexed properly`);
    }
  }

  // Check 6: Hybrid Mana
  if (manaCost.includes('/')) {
    console.log(`[6] Hybrid Mana: ✅ Detected ${(manaCost.match(/\//g) || []).length} hybrid symbol(s)`);
  }

  // Check 7: Modal/Choice
  if (oracleText.toLowerCase().includes('choose one')) {
    if (!dbEntry.cast?.some(e => e.type === 'modal')) {
      issues.push('Has "choose one" but no modal effect');
      suggestions.push(`Add: { type: "modal", modes: [...] }`);
    } else {
      console.log(`[7] Modal/Choice: ✅ Configured`);
    }
  }

  // Check 8: Keywords
  const keywords = ['flying', 'hexproof', 'shroud', 'indestructible', 'vigilance', 'trample', 'menace', 'lifelink', 'deathtouch', 'flash', 'haste'];
  const foundKeywords = keywords.filter(kw => typeLine.toLowerCase().includes(kw) || oracleText.toLowerCase().includes(kw));
  if (foundKeywords.length > 0) {
    const hasStaticKeywords = dbEntry.static?.some(s => s.type === 'has_keyword');
    if (!hasStaticKeywords) {
      issues.push(`Keywords found (${foundKeywords.join(', ')}) but not in static effects`);
      suggestions.push(`Add: static: [{ type: "has_keyword", keywords: [${foundKeywords.map(k => `"${k}"`).join(', ')}] }]`);
    } else {
      console.log(`[8] Keywords: ✅ ${foundKeywords.length} keyword(s) in static effects`);
    }
  }

  // Check 9: Cost Requirements
  if (oracleText.toLowerCase().includes('sacrifice') && !dbEntry.additional_costs?.some(c => c.type === 'sacrifice')) {
    if (!dbEntry.cast?.some(e => e.type === 'sacrifice')) {
      suggestions.push(`Add sacrifice cost to additional_costs or cast effects`);
    }
  }

  // Check 10: Fight Mechanics
  if (oracleText.toLowerCase().includes('fight')) {
    const hasFight = dbEntry.cast?.some(e => e.type === 'fight' || e.type === 'fight_with');
    if (!hasFight) {
      issues.push('Has "fight" mechanic but no fight effect defined');
      suggestions.push(`Add: { type: "fight", target: "opponent_creature" }`);
    } else {
      console.log(`[10] Fight: ✅ Configured`);
    }
  }

  // Print results
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (issues.length === 0) {
    console.log('✅ ALL CHECKS PASSED!\n');
  } else {
    console.log(`⚠️  ${issues.length} ISSUE(S) FOUND:\n`);
    issues.forEach((issue, i) => {
      console.log(`${i + 1}. ${issue}`);
      if (suggestions[i]) console.log(`   → ${suggestions[i]}`);
    });
    console.log('');
  }

  // Print summary
  console.log('📊 SUMMARY:');
  console.log(`  • Card: ${name}`);
  console.log(`  • Type: ${typeLine}`);
  console.log(`  • Effects in DB: ${(dbEntry.cast?.length || 0)} cast, ${(dbEntry.etb?.length || 0)} etb, ${(dbEntry.triggered?.length || 0)} triggered`);
  console.log(`  • Issues: ${issues.length}\n`);

  if (issues.length > 0) {
    console.log('💡 TIP: Run /fix-card to apply auto-fixes\n');
  }
}
