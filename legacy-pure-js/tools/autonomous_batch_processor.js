#!/usr/bin/env node
/**
 * AUTONOMOUS BATCH PROCESSOR v2
 * Processes batches 17-56 without stopping
 * Tracks all issues resolved
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Extract batch definitions from audit file
function extractBatchesFromAudit() {
  const auditPath = path.join(__dirname, '../TDM_COMPLETE_AUDIT.txt');
  const auditContent = fs.readFileSync(auditPath, 'utf8');

  const batches = {};
  const batchRegex = /BATCH (\d+) \(Cards \d+-\d+\):\s*\n-+\n([\s\S]*?)(?=BATCH|\Z)/g;
  const cardLineRegex = /\s+\[\s*[\[\]!?xX ]*\]\s+([^|]+?)\s+\|/;

  let match;
  while ((match = batchRegex.exec(auditContent)) !== null) {
    const batchNum = parseInt(match[1]);
    const batchContent = match[2];
    const cardLines = batchContent.split('\n').filter(l => l.includes('|'));

    const cards = [];
    for (const line of cardLines) {
      const cardMatch = cardLineRegex.exec(line);
      if (cardMatch) {
        const cardName = cardMatch[1].trim();
        if (cardName && !cardName.startsWith('-')) {
          cards.push(cardName);
        }
      }
    }

    if (cards.length >= 5) {
      batches[`batch${batchNum}`] = cards;
    }
  }

  return batches;
}

async function processBatch(batchNum, cards) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`BATCH ${batchNum}: Processing ${cards.length} cards`);
  console.log(`${'='.repeat(80)}`);

  try {
    const batchKey = `batch${batchNum}`;
    const output = execSync(`node tools/full-stack-analyzer.js ${batchKey} 2>&1`, {
      encoding: 'utf-8',
      timeout: 30000
    });

    // Parse results
    const completeMatch = output.match(/✅ Complete: (\d+)\/(\d+)/);
    const complete = completeMatch ? parseInt(completeMatch[1]) : 0;
    const total = completeMatch ? parseInt(completeMatch[2]) : cards.length;

    console.log(`✅ Pass rate: ${complete}/${total}`);

    if (complete === total) {
      console.log(`✅ BATCH ${batchNum} PASSED - All cards valid!`);
      return { batch: batchNum, status: 'PASS', issues: 0 };
    } else {
      const issues = total - complete;
      console.log(`⚠️  BATCH ${batchNum} has ${issues} cards with issues`);
      return { batch: batchNum, status: 'REVIEW', issues };
    }
  } catch (e) {
    console.error(`❌ Error processing batch ${batchNum}: ${e.message.substring(0, 100)}`);
    return { batch: batchNum, status: 'ERROR', issues: -1 };
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║           AUTONOMOUS TDM BATCH PROCESSOR - BATCHES 17-56                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  const batches = extractBatchesFromAudit();
  const results = [];

  // Process batches 17-56 sequentially
  for (let i = 17; i <= 56; i++) {
    const batchKey = `batch${i}`;
    if (batches[batchKey]) {
      const result = await processBatch(i, batches[batchKey]);
      results.push(result);
    } else {
      console.log(`⚠️  Batch ${i} not found in audit file`);
    }

    // Small delay between batches
    await new Promise(r => setTimeout(r, 200));
  }

  // Final summary
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('FINAL SUMMARY - BATCHES 17-56');
  console.log(`${'='.repeat(80)}\n`);

  const passed = results.filter(r => r.status === 'PASS').length;
  const review = results.filter(r => r.status === 'REVIEW').length;
  const errors = results.filter(r => r.status === 'ERROR').length;

  console.log(`✅ Batches passed:    ${passed}/40`);
  console.log(`⚠️  Batches to review: ${review}/40`);
  console.log(`❌ Batches with errors: ${errors}/40\n`);

  const totalIssues = results.reduce((sum, r) => sum + (r.issues >= 0 ? r.issues : 0), 0);
  console.log(`Total cards with issues: ${totalIssues}`);
  console.log(`Total cards processed: ${40 * 5} (Batches 17-56)\n`);

  if (review > 0) {
    console.log('Batches needing review:');
    results.filter(r => r.status === 'REVIEW').forEach(r => {
      console.log(`  - Batch ${r.batch} (${r.issues} issues)`);
    });
  }
}

main().catch(console.error);
