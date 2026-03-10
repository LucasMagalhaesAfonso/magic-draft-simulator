// @ts-nocheck
// stress-test.ts — AI vs AI stress test orchestrator
// Runs each game in a child process with hard OS-level timeout
// Usage: npx tsx tools/stress-test.ts [--games=50] [--timeout=8000] [--verbose]

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const NUM_GAMES = parseInt(args.find(a => a.startsWith('--games='))?.split('=')[1] || '50');
const TIMEOUT_MS = parseInt(args.find(a => a.startsWith('--timeout='))?.split('=')[1] || '8000');
const VERBOSE = args.includes('--verbose');

const workerPath = resolve(__dirname, 'stress-test-worker.ts');

interface GameResult {
  gameNum: number;
  ok: boolean;
  winner: number | null;
  turns: number;
  phases: number;
  error: string | null;
  duration: number;
}

function runOneGame(gameNum: number): GameResult {
  const start = Date.now();
  try {
    const output = execSync(`npx tsx "${workerPath}" ${gameNum}`, {
      timeout: TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: resolve(__dirname, '..'),
    }).trim();

    const duration = Date.now() - start;

    // Parse last line as JSON (worker might print warnings before)
    const lines = output.split('\n');
    const jsonLine = lines[lines.length - 1];
    try {
      const data = JSON.parse(jsonLine);
      return { gameNum, ok: data.ok, winner: data.winner ?? null, turns: data.turns ?? 0, phases: data.phases ?? 0, error: data.error ?? null, duration };
    } catch {
      return { gameNum, ok: false, winner: null, turns: 0, phases: 0, error: `Bad output: ${jsonLine.substring(0, 100)}`, duration };
    }
  } catch (e: any) {
    const duration = Date.now() - start;
    if (e.killed || e.signal === 'SIGTERM') {
      return { gameNum, ok: false, winner: null, turns: 0, phases: 0, error: `TIMEOUT (${TIMEOUT_MS}ms)`, duration };
    }
    return { gameNum, ok: false, winner: null, turns: 0, phases: 0, error: `PROCESS_ERROR: ${e.message?.substring(0, 100)}`, duration };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║          Magic Draft — AI vs AI Stress Test                 ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`Running ${NUM_GAMES} games (timeout ${TIMEOUT_MS}ms each)...\n`);

const results: GameResult[] = [];
let completed = 0, crashes = 0, timeouts = 0, stucks = 0, nans = 0;
let totalTurns = 0;

for (let i = 0; i < NUM_GAMES; i++) {
  const r = runOneGame(i + 1);
  results.push(r);

  if (r.ok) {
    completed++;
    totalTurns += r.turns;
    if (VERBOSE) console.log(`  ✅ Game ${r.gameNum}: P${r.winner} wins, turn ${r.turns} (${r.duration}ms)`);
  } else {
    if (r.error?.startsWith('TIMEOUT')) timeouts++;
    else if (r.error?.startsWith('CRASH')) crashes++;
    else if (r.error === 'NaN life') nans++;
    else stucks++;
    console.log(`  ❌ Game ${r.gameNum}: ${r.error} (${r.duration}ms)`);
  }

  if ((i + 1) % 10 === 0) {
    console.log(`  [${i + 1}/${NUM_GAMES}] ok=${completed} crash=${crashes} timeout=${timeouts} stuck=${stucks} nan=${nans}`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('                       RESULTS SUMMARY');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Total games:     ${NUM_GAMES}`);
console.log(`Completed OK:    ${completed} (${(completed / NUM_GAMES * 100).toFixed(1)}%)`);
console.log(`Crashes:         ${crashes}`);
console.log(`Timeouts:        ${timeouts}`);
console.log(`Stuck/other:     ${stucks}`);
console.log(`NaN:             ${nans}`);
console.log(`Avg turns:       ${completed > 0 ? (totalTurns / completed).toFixed(1) : 'N/A'}`);
console.log(`Avg duration:    ${(results.reduce((s, r) => s + r.duration, 0) / NUM_GAMES / 1000).toFixed(1)}s`);

// Win rate by player
const p0Wins = results.filter(r => r.ok && r.winner === 0).length;
const p1Wins = results.filter(r => r.ok && r.winner === 1).length;
if (completed > 0) {
  console.log(`\nWIN RATE:`);
  console.log(`  P0 (goes first): ${p0Wins} wins (${(p0Wins / completed * 100).toFixed(1)}%)`);
  console.log(`  P1 (goes second): ${p1Wins} wins (${(p1Wins / completed * 100).toFixed(1)}%)`);
  const balance = Math.min(p0Wins, p1Wins) / Math.max(p0Wins, p1Wins, 1);
  console.log(`  Balance score:   ${(balance * 100).toFixed(0)}% ${balance >= 0.4 ? '✅' : '⚠️  IMBALANCED'}`);
}

// Unique errors
const errorMap = new Map<string, number>();
for (const r of results) {
  if (r.error) {
    const key = r.error.substring(0, 100);
    errorMap.set(key, (errorMap.get(key) || 0) + 1);
  }
}
if (errorMap.size > 0) {
  console.log('\nERROR BREAKDOWN:');
  for (const [err, count] of [...errorMap.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  [${count}x] ${err}`);
  }
}

console.log(crashes > 0 || nans > 0 ? '\n⚠️  Critical issues found!' : '\n✅ No critical issues!');
