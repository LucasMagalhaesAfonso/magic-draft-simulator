#!/usr/bin/env node
/**
 * Card Validation CLI
 * Complete card validation using AI + static checks
 *
 * Usage:
 *   node tools/validate-card.js "Card Name"
 *   node tools/validate-card.js "Card Name" --static-only
 *   node tools/validate-card.js "Card Name" --auto-fix
 */

const aiValidator = require('./ai-validator');
const staticValidator = require('./static-validator');
const fs = require('fs');
const path = require('path');

async function main() {
  const cardName = process.argv[2];
  const flags = process.argv.slice(3);

  if (!cardName) {
    console.log(`
📚 Magic Card Validator v1.0

Usage:
  node tools/validate-card.js "Card Name"        # Full validation (AI + static)
  node tools/validate-card.js "Card Name" --static-only  # Fast validation only
  node tools/validate-card.js "Card Name" --verbose      # Show more details

Examples:
  node tools/validate-card.js "Sage of the Skies"
  node tools/validate-card.js "Naga Fleshcrafter" --static-only
    `);
    process.exit(0);
  }

  const staticOnly = flags.includes('--static-only');
  const verbose = flags.includes('--verbose');

  try {
    console.log(`\n🔍 Validating: ${cardName}\n`);

    // Step 1: Fetch Scryfall data
    console.log('📡 Fetching Scryfall data...');
    const scryfallCard = await aiValidator.fetchScryfallCard(cardName);

    if (!scryfallCard) {
      console.log(`❌ Card not found: ${cardName}`);
      process.exit(1);
    }

    const dbKey = cardName.toLowerCase();
    const path = require('path');
    const fs = require('fs');
    const dbPath = path.join(__dirname, '../js/data/card-effects.js');
    let CardEffectsDB = {};
    try {
      const dbContent = fs.readFileSync(dbPath, 'utf8');
      const match = dbContent.match(/const CardEffectsDB = \{([\s\S]*)\};/);
      if (match) {
        eval('CardEffectsDB = {' + match[1] + '}');
      }
    } catch (e) {
      console.error('Error loading CardEffectsDB:', e.message);
    }

    const dbEntry = CardEffectsDB[dbKey] || null;

    // Step 2: Static validation (always do this)
    console.log('✓ Scryfall data loaded\n');
    console.log('🔧 Running static checks...');
    const staticIssues = staticValidator.validate(scryfallCard, dbEntry);
    console.log(`✓ Static checks complete (${staticIssues.length} issues)\n`);

    // Step 3: AI validation (unless --static-only)
    let aiResult = null;
    if (!staticOnly) {
      console.log('🤖 Running AI semantic analysis...');
      console.log('   (This may take 10-20 seconds)\n');

      aiResult = await aiValidator.validateCard(cardName);

      if (!aiResult.success) {
        console.log(`⚠️  AI validation skipped: ${aiResult.error}\n`);
      } else {
        console.log('✓ AI analysis complete\n');
      }
    }

    // Step 4: Merge and report
    const mergedIssues = mergeIssues(staticIssues, aiResult?.issues || []);
    const score = calculateScore(mergedIssues, aiResult?.correctness);

    // Print report
    printReport({
      cardName,
      scryfallCard,
      dbEntry,
      staticIssues,
      aiResult,
      mergedIssues,
      score,
      verbose
    });

    // Exit with appropriate code
    const criticalCount = mergedIssues.filter(i => i.severity === 'critical').length;
    process.exit(criticalCount > 0 ? 1 : 0);

  } catch (error) {
    console.error(`\n❌ Validation failed:`, error.message);
    if (verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function mergeIssues(staticIssues, aiIssues) {
  // Merge and deduplicate issues
  const issueMap = new Map();

  [...staticIssues, ...aiIssues].forEach(issue => {
    const key = `${issue.type}:${issue.location}`;
    if (!issueMap.has(key) || issue.severity > issueMap.get(key).severity) {
      issueMap.set(key, issue);
    }
  });

  return Array.from(issueMap.values()).sort((a, b) => {
    const severityOrder = { critical: 3, major: 2, minor: 1 };
    return severityOrder[b.severity] - severityOrder[a.severity];
  });
}

function calculateScore(issues, aiScore) {
  if (aiScore !== undefined) {
    return aiScore;
  }

  let score = 100;
  issues.forEach(issue => {
    if (issue.severity === 'critical') score -= 40;
    else if (issue.severity === 'major') score -= 15;
    else if (issue.severity === 'minor') score -= 5;
  });

  return Math.max(0, score);
}

function printReport(data) {
  const {
    cardName,
    scryfallCard,
    dbEntry,
    staticIssues,
    aiResult,
    mergedIssues,
    score,
    verbose
  } = data;

  const criticalCount = mergedIssues.filter(i => i.severity === 'critical').length;
  const majorCount = mergedIssues.filter(i => i.severity === 'major').length;
  const minorCount = mergedIssues.filter(i => i.severity === 'minor').length;

  // Header
  console.log(`${'═'.repeat(70)}`);
  console.log(`📊 VALIDATION REPORT: ${cardName}`);
  console.log(`${'═'.repeat(70)}\n`);

  // Card info
  console.log(`Card Details:`);
  console.log(`  Type: ${scryfallCard.type_line}`);
  console.log(`  Mana: ${scryfallCard.mana_cost || '—'}`);
  console.log(`  CMC: ${scryfallCard.cmc}`);
  console.log(`  DB Entry: ${dbEntry ? '✅ Exists' : '❌ Missing'}`);
  console.log();

  // Validation score
  const scoreBadge = score >= 90 ? '✅' : score >= 70 ? '⚠️ ' : '❌';
  console.log(`Validation Score: ${score}/100 ${scoreBadge}`);
  console.log(`Issues: ${criticalCount} critical, ${majorCount} major, ${minorCount} minor`);
  console.log();

  // Issues
  if (mergedIssues.length === 0) {
    console.log(`✅ No issues found! Card appears correctly implemented.\n`);
  } else {
    console.log(`Issues Found:\n`);
    mergedIssues.forEach((issue, idx) => {
      const emoji = {
        critical: '🔴',
        major: '🟠',
        minor: '🟡'
      }[issue.severity] || '⚪';

      console.log(`${emoji} [${issue.severity.toUpperCase()}] ${issue.type}`);
      console.log(`   Location: ${issue.location}`);
      console.log(`   ${issue.description}`);

      if (issue.evidence && verbose) {
        console.log(`   Evidence: "${issue.evidence}"`);
      }
      console.log();
    });
  }

  // AI Results
  if (aiResult?.success && aiResult.fixes.length > 0) {
    console.log(`${'─'.repeat(70)}`);
    console.log(`🔧 SUGGESTED FIXES:\n`);

    aiResult.fixes.forEach((fix, idx) => {
      console.log(`Fix ${idx + 1}: ${fix.location}`);
      console.log(`  ${fix.explanation}\n`);

      if (verbose) {
        console.log(`  Current: ${fix.current}`);
        console.log(`  Suggested: ${fix.suggested}\n`);
      }
    });
  }

  // Summary
  console.log(`${'═'.repeat(70)}\n`);

  if (score >= 90) {
    console.log(`✅ Card is well-implemented. No critical issues.\n`);
  } else if (score >= 70) {
    console.log(`⚠️  Card has issues that should be reviewed and fixed.\n`);
  } else {
    console.log(`❌ Card has critical issues. Fix before using in game.\n`);
  }

  // Suggested next step
  if (criticalCount > 0) {
    console.log(`💡 Next steps:`);
    console.log(`   1. Review the critical issues above`);
    console.log(`   2. Fix CardEffectsDB entry (js/data/card-effects.js)`);
    console.log(`   3. Re-run: node tools/validate-card.js "${cardName}"\n`);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { main };
