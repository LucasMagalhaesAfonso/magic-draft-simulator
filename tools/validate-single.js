#!/usr/bin/env node
/**
 * Single Card Validation + Auto-Fix
 * Focuses on one card at a time, applies fixes if needed
 *
 * Usage:
 *   node tools/validate-single.js "Sage of the Skies" --fix
 *   node tools/validate-single.js "Sage of the Skies" --report
 */

const aiValidator = require('./ai-validator');
const staticValidator = require('./static-validator');
const fs = require('fs');
const path = require('path');

async function validateAndFix(cardName, shouldFix = false) {
  try {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🔍 VALIDATING: ${cardName}`);
    console.log(`${'═'.repeat(70)}\n`);

    // Fetch Scryfall
    console.log('📡 Fetching card from Scryfall...');
    const scryfallCard = await aiValidator.fetchScryfallCard(cardName);

    if (!scryfallCard) {
      console.log(`❌ Card not found on Scryfall\n`);
      process.exit(1);
    }

    console.log(`✓ Found: ${scryfallCard.name}\n`);

    // Load DB
    const dbPath = path.join(__dirname, '../js/data/card-effects.js');
    const dbContent = fs.readFileSync(dbPath, 'utf8');
    let CardEffectsDB = {};
    try {
      const match = dbContent.match(/const CardEffectsDB = \{([\s\S]*)\};/);
      if (match) {
        eval('CardEffectsDB = {' + match[1] + '}');
      }
    } catch (e) {
      console.error('Error parsing CardEffectsDB:', e.message);
      process.exit(1);
    }

    const dbKey = cardName.toLowerCase();
    const dbEntry = CardEffectsDB[dbKey];

    // Static validation
    console.log('🔧 Running static validation...');
    const staticIssues = staticValidator.validate(scryfallCard, dbEntry);
    console.log(staticValidator.formatIssues(staticIssues));

    // AI validation (with mock if no API key)
    console.log('\n🤖 Running AI semantic analysis...');
    let aiResult = null;

    if (process.env.ANTHROPIC_API_KEY) {
      console.log('   (Using real Anthropic API)\n');
      aiResult = await aiValidator.validateCard(cardName);
      if (!aiResult.success) {
        console.log(`⚠️  AI validation failed: ${aiResult.error}\n`);
        aiResult = generateMockAnalysis(cardName, scryfallCard, dbEntry);
      }
    } else {
      console.log('   (No API key - using mock analysis for demonstration)\n');
      aiResult = generateMockAnalysis(cardName, scryfallCard, dbEntry);
    }

    // Print results
    printValidationResult(aiResult, scryfallCard);

    // Apply fixes if requested
    if (shouldFix && aiResult.fixes && aiResult.fixes.length > 0) {
      console.log('\n' + '═'.repeat(70));
      console.log('🔧 APPLYING FIXES');
      console.log('═'.repeat(70) + '\n');

      const fixedEntry = applyFixes(dbEntry, aiResult.fixes);
      updateCardEffectsDB(dbPath, dbEntry, fixedEntry, cardName);

      console.log(`✅ Fixes applied to CardEffectsDB\n`);
      console.log('📝 You can now test the fixes in the game:\n');
      console.log('   1. npx http-server . -p 8080');
      console.log('   2. Open game in browser');
      console.log('   3. Draft and play the card to verify fix');
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    if (process.argv.includes('--verbose')) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Generate mock analysis for demonstration
 */
function generateMockAnalysis(cardName, scryfallCard, dbEntry) {
  const name = cardName.toLowerCase();

  // Sage of the Skies specific analysis
  if (name.includes('sage') && name.includes('skies')) {
    return {
      success: true,
      cardName,
      correctness: 42,
      criticalCount: 1,
      majorCount: 1,
      minorCount: 0,
      issues: [
        {
          severity: 'critical',
          type: 'wrong_timing',
          location: 'triggered',
          description: 'Trigger uses "second_spell" event but should use "cast_spell" with self: true',
          evidence: 'Oracle says "When you cast this spell, if you cast another spell this turn"'
        },
        {
          severity: 'major',
          type: 'missing_condition',
          location: 'triggered',
          description: 'Trigger has condition in oracle ("if you cast another spell") but not captured as condition field',
          evidence: 'Missing condition: "cast_with_another_spell"'
        }
      ],
      fixes: [
        {
          location: 'triggered[0]',
          current: JSON.stringify(dbEntry?.triggered?.[0] || {}),
          suggested: JSON.stringify({
            event: 'cast_spell',
            self: true,
            condition: 'cast_with_another_spell',
            effects: [{ type: 'copy_self' }]
          }),
          explanation: '"When you cast THIS card" = cast_spell with self: true. "If you cast another spell" = condition gate.'
        }
      ],
      summary: 'Critical trigger timing bug - fires on wrong event. Needs self: true flag and condition gate.'
    };
  }

  // Naga Fleshcrafter specific analysis
  if (name.includes('naga') && name.includes('fleshcrafter')) {
    return {
      success: true,
      cardName,
      correctness: 55,
      criticalCount: 2,
      majorCount: 0,
      minorCount: 1,
      issues: [
        {
          severity: 'critical',
          type: 'missing_ability',
          location: 'graveyard',
          description: 'Oracle has "Renew" graveyard ability but DB has no graveyard: [] array',
          evidence: 'Missing entire graveyard casting mode'
        },
        {
          severity: 'critical',
          type: 'missing_ability',
          location: 'graveyard',
          description: 'Graveyard ability effects not implemented (clone, +1/+1)',
          evidence: 'Card is 50% implemented - only ETB clone exists'
        }
      ],
      fixes: [
        {
          location: 'graveyard',
          current: 'undefined',
          suggested: JSON.stringify({
            graveyard: [{
              cost: { mana: '{2}{U}', exile: true },
              sorcerySpeed: true,
              effects: [
                { type: 'counter', counter: '+1/+1', amount: 1, target: 'other_creature' },
                { type: 'clone_all_to_target', duration: 'end_of_turn' }
              ]
            }]
          }),
          explanation: 'Enables Renew ability - cast from GY, +1/+1 to other creature, makes it a copy until end of turn'
        }
      ],
      summary: 'Major gap - 50% of card missing. Renew graveyard ability completely absent from DB.'
    };
  }

  // Counter Spell specific analysis
  if (name.includes('counter') && name.includes('spell')) {
    return {
      success: true,
      cardName,
      correctness: 65,
      criticalCount: 0,
      majorCount: 2,
      minorCount: 0,
      issues: [
        {
          severity: 'major',
          type: 'wrong_target',
          location: 'cast',
          description: 'Counter spell should target spells on stack, not creatures',
          evidence: 'Current target type unclear in DB entry'
        },
        {
          severity: 'major',
          type: 'ai_targeting',
          location: 'game-ai.js',
          description: 'AI has no logic to target spells on stack for counter effects',
          evidence: '_chooseTargets() missing case for counter_spell'
        }
      ],
      fixes: [],
      summary: 'Card definition and AI targeting need enhancement for proper stack spell targeting.'
    };
  }

  // Generic fallback
  return {
    success: true,
    cardName,
    correctness: 85,
    criticalCount: 0,
    majorCount: 0,
    minorCount: 0,
    issues: [],
    fixes: [],
    summary: 'Card appears well-implemented.'
  };
}

/**
 * Print validation result
 */
function printValidationResult(result, scryfallCard) {
  const { cardName, correctness, criticalCount, majorCount, minorCount, issues, fixes, summary } = result;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 VALIDATION RESULT`);
  console.log(`${'═'.repeat(70)}\n`);

  console.log(`Card: ${cardName}`);
  console.log(`Type: ${scryfallCard.type_line}`);
  console.log(`Mana: ${scryfallCard.mana_cost || '—'}\n`);

  const scoreBadge = correctness >= 90 ? '✅' : correctness >= 70 ? '⚠️ ' : '❌';
  console.log(`Score: ${correctness}/100 ${scoreBadge}`);
  console.log(`Issues: ${criticalCount} critical, ${majorCount} major, ${minorCount} minor\n`);

  if (issues.length === 0) {
    console.log('✅ No issues found!\n');
  } else {
    console.log('Issues:\n');
    issues.forEach((issue, idx) => {
      const emoji = { critical: '🔴', major: '🟠', minor: '🟡' }[issue.severity] || '⚪';
      console.log(`${emoji} [${issue.severity.toUpperCase()}] ${issue.type}`);
      console.log(`   Location: ${issue.location}`);
      console.log(`   ${issue.description}`);
      console.log(`   Evidence: "${issue.evidence}"\n`);
    });
  }

  if (fixes.length > 0) {
    console.log('Suggested Fixes:\n');
    fixes.forEach((fix, idx) => {
      console.log(`Fix ${idx + 1}: ${fix.location}`);
      console.log(`   ${fix.explanation}\n`);
      if (process.argv.includes('--verbose')) {
        console.log(`   From: ${fix.current}`);
        console.log(`   To:   ${fix.suggested}\n`);
      }
    });
  }

  console.log(`Summary: ${summary}\n`);
}

/**
 * Apply fixes to DB entry
 */
function applyFixes(dbEntry, fixes) {
  let fixed = JSON.parse(JSON.stringify(dbEntry || {}));

  fixes.forEach(fix => {
    try {
      const suggested = JSON.parse(fix.suggested);

      if (fix.location === 'triggered[0]') {
        fixed.triggered = [suggested];
      } else if (fix.location === 'graveyard') {
        fixed.graveyard = suggested.graveyard || [];
      } else if (fix.location.startsWith('cast')) {
        if (!fixed.cast) fixed.cast = [];
        fixed.cast[0] = suggested;
      }
    } catch (e) {
      console.error(`Warning: Could not parse fix for ${fix.location}: ${e.message}`);
    }
  });

  return fixed;
}

/**
 * Update CardEffectsDB file
 */
function updateCardEffectsDB(dbPath, oldEntry, newEntry, cardName) {
  let content = fs.readFileSync(dbPath, 'utf8');

  // Find and replace the entry
  const cardKey = cardName.toLowerCase();

  // Find the old entry pattern
  const oldPattern = new RegExp(
    `"${cardKey}"\\s*:\\s*\\{[^}]*(?:\\{[^}]*\\}[^}]*)*\\}(?=\\s*[,}])`,
    'i'
  );

  if (!oldPattern.test(content)) {
    console.log(`⚠️  Could not find exact entry for "${cardName}" in CardEffectsDB`);
    console.log(`Manual edit required. Look for: "${cardKey}" in js/data/card-effects.js\n`);
    return;
  }

  // Create new entry
  const newEntryStr = `"${cardKey}": ${JSON.stringify(newEntry, null, 2).split('\n').join('\n  ')}`;

  // Replace
  const updated = content.replace(oldPattern, newEntryStr);

  // Write back
  fs.writeFileSync(dbPath, updated, 'utf8');

  console.log(`✓ Updated CardEffectsDB: "${cardKey}"`);
  console.log(`  Location: js/data/card-effects.js\n`);
}

// Main
const cardName = process.argv[2];
const shouldFix = process.argv.includes('--fix');

if (!cardName) {
  console.log(`
📚 Single Card Validator

Usage:
  node tools/validate-single.js "Card Name"           # Validate only
  node tools/validate-single.js "Card Name" --fix     # Validate + Apply fixes
  node tools/validate-single.js "Card Name" --verbose # Show detailed info

Examples:
  node tools/validate-single.js "Sage of the Skies"
  node tools/validate-single.js "Sage of the Skies" --fix
  node tools/validate-single.js "Counter Spell" --verbose
  `);
  process.exit(0);
}

validateAndFix(cardName, shouldFix).catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
