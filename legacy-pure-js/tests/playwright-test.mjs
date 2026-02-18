import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = `file:///${path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/')}`;

console.log('🎮 Magic Draft Simulator - Playwright Test');
console.log('==========================================\n');

const browser = await chromium.launch({ headless: false, slowMo: 150 });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

// Collect console messages
const logs = [];
page.on('console', msg => {
  const text = msg.text();
  if (msg.type() === 'error') console.log('  ❌ CONSOLE ERROR:', text);
  logs.push({ type: msg.type(), text });
});

page.on('pageerror', err => {
  console.log('  💥 PAGE ERROR:', err.message);
});

async function step(name, fn) {
  process.stdout.write(`⏳ ${name}...`);
  try {
    const result = await fn();
    console.log(` ✅`);
    return result;
  } catch (e) {
    console.log(` ❌ FAILED: ${e.message}`);
    throw e;
  }
}

let screenshotCount = 0;
async function screenshot(label) {
  screenshotCount++;
  const fname = `tests/screenshots/${screenshotCount}-${label}.png`;
  await page.screenshot({ path: fname, fullPage: false });
  console.log(`  📸 Screenshot: ${fname}`);
}

import fs from 'fs';
const ssDir = path.resolve(__dirname, 'screenshots');
if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });

try {
  // ========== 1. OPEN APP ==========
  await step('Opening index.html', async () => {
    await page.goto(indexPath, { waitUntil: 'load', timeout: 15000 });
  });

  await step('Waiting for home screen', async () => {
    await page.waitForSelector('#screen-home:not(.hidden)', { timeout: 5000 });
  });

  await screenshot('home-screen');

  // ========== 2. SELECT A SET ==========
  await step('Waiting for sets to load', async () => {
    await page.waitForSelector('#sets-grid .set-card', { timeout: 30000 });
  });

  const setCount = await page.locator('#sets-grid .set-card').count();
  console.log(`  📦 Sets available: ${setCount}`);

  await step('Searching for a set', async () => {
    await page.fill('#set-search', 'Foundations');
    await page.waitForTimeout(500);
  });

  let setCards = await page.locator('#sets-grid .set-card:visible').count();
  if (setCards === 0) {
    console.log('  ⚠️ "Foundations" not found, clicking first available set');
    await page.fill('#set-search', '');
    await page.waitForTimeout(300);
  }

  await step('Clicking on set', async () => {
    const firstSet = page.locator('#sets-grid .set-card:visible').first();
    const setName = await firstSet.textContent();
    console.log(` [${setName.trim().substring(0, 40)}]`);
    await firstSet.click();
  });

  await screenshot('set-selected');

  // ========== 3. WAIT FOR CARDS TO LOAD ==========
  await step('Waiting for cards to load', async () => {
    await page.waitForSelector('#start-draft-section:not(.hidden)', { timeout: 120000 });
  });

  const loadingText = await page.textContent('#loading-progress');
  console.log(`  📊 ${loadingText}`);
  await screenshot('cards-loaded');

  // ========== 4. START DRAFT & SKIP TO GAME ==========
  await step('Starting draft', async () => {
    await page.click('button:has-text("Iniciar Draft")');
    await page.waitForSelector('#screen-draft:not(.hidden)', { timeout: 10000 });
  });

  await screenshot('draft-started');

  await step('Skipping to game (Draft.skipToGame)', async () => {
    await page.evaluate(() => Draft.skipToGame());
    await page.waitForFunction(() => {
      return UIGame && UIGame.gameState && UIGame.gameState.turn >= 1;
    }, { timeout: 20000 });
  });

  await screenshot('game-started');

  // ========== 5. HANDLE MULLIGAN ==========
  await step('Checking for mulligan phase', async () => {
    const phase = await page.evaluate(() => UIGame.gameState.phase);

    if (phase === 'mulligan') {
      console.log(' (keeping hand)');
      const keepBtn = page.locator('button:has-text("Manter")');
      if (await keepBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await keepBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(1500);
    } else {
      console.log(` (phase: ${phase})`);
    }
  });

  await screenshot('after-mulligan');

  // ========== 6. PLAY SOME TURNS ==========
  const MAX_TURNS = 30;
  const MAX_ACTIONS = 200;
  let actionCount = 0;
  let lastTurn = 0;
  let gameOver = false;
  let stuckCounter = 0;

  console.log('\n🎲 Starting gameplay loop...\n');

  for (let i = 0; i < MAX_ACTIONS && !gameOver; i++) {
    actionCount++;

    // Get game state snapshot
    const state = await page.evaluate(() => {
      try {
        const gs = UIGame.gameState;
        if (!gs) return null;
        const p0 = gs.players[0];
        const p1 = gs.players[1];
        const wi = gs.waitingForInput;

        const bf0 = p0.zones.battlefield.cards || [];
        const bf1 = p1.zones.battlefield.cards || [];
        const hand0 = p0.zones.hand.getAll ? p0.zones.hand.getAll() : (p0.zones.hand.cards || []);

        return {
          turn: gs.turn,
          phase: gs.phase,
          activePlayer: gs.activePlayer,
          life: [p0.life, p1.life],
          waitingForInput: wi,
          myCreatures: bf0.filter(c => c.types && c.types.includes('Creature')).length,
          oppCreatures: bf1.filter(c => c.types && c.types.includes('Creature')).length,
          myLands: bf0.filter(c => c.types && c.types.includes('Land')).length,
          handSize: hand0.length,
          winner: gs.winner
        };
      } catch(e) {
        return { error: e.message };
      }
    });

    if (!state || state.error) {
      console.log(`  ⚠️ ${state?.error ? 'Error: ' + state.error : 'No game state'}, waiting...`);
      await page.waitForTimeout(1000);
      stuckCounter++;
      if (stuckCounter > 10) {
        console.log('  ❌ Game state stuck, aborting.');
        break;
      }
      continue;
    }

    stuckCounter = 0;

    // Check for winner
    if (state.winner !== undefined && state.winner !== null) {
      gameOver = true;
      const winnerText = state.winner === 0 ? 'PLAYER WINS! 🎉' : 'AI WINS! 🤖';
      console.log(`\n🏆 GAME OVER - ${winnerText}`);
      console.log(`   Final Life: Player ${state.life[0]} | AI ${state.life[1]}`);
      console.log(`   Turn: ${state.turn}`);
      await screenshot('game-over');
      break;
    }

    // Log turn changes
    if (state.turn !== lastTurn) {
      lastTurn = state.turn;
      console.log(`\n--- Turn ${state.turn} | Life: P${state.life[0]} vs AI${state.life[1]} | Board: ${state.myCreatures}c ${state.myLands}l vs ${state.oppCreatures}c | Hand: ${state.handSize} ---`);

      if (state.turn > MAX_TURNS) {
        console.log('  ⏰ Max turns reached, stopping.');
        break;
      }

      if (state.turn % 5 === 0) {
        await screenshot(`turn-${state.turn}`);
      }
    }

    const wi = state.waitingForInput;

    // AI turn or no input needed - just wait
    if (!wi || wi.playerId === 1) {
      await page.waitForTimeout(300);
      continue;
    }

    const wiType = wi.type;

    if (wiType === 'mulligan') {
      console.log('  🃏 Keeping hand');
      const keepBtn = page.locator('button:has-text("Manter")');
      if (await keepBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await keepBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(800);
    }
    else if (wiType === 'main_phase') {
      // Try to play a land first
      const playedLand = await page.evaluate(() => {
        const gs = UIGame.gameState;
        if (gs.landPlayedThisTurn) return false;
        const hand = gs.players[0].zones.hand.getAll ? gs.players[0].zones.hand.getAll() : (gs.players[0].zones.hand.cards || []);
        const land = hand.find(c => c.types && c.types.includes('Land'));
        if (land) {
          UIGame.playCard(land._uid);
          return true;
        }
        return false;
      });

      if (playedLand) {
        console.log('  🌍 Played a land');
        await page.waitForTimeout(500);
        continue;
      }

      // Try to play a spell (cheapest first)
      const playedSpell = await page.evaluate(() => {
        const gs = UIGame.gameState;
        const hand = gs.players[0].zones.hand.getAll ? gs.players[0].zones.hand.getAll() : (gs.players[0].zones.hand.cards || []);
        const spells = hand
          .filter(c => !(c.types && c.types.includes('Land')) && ManaSystem.canAfford(gs, 0, c))
          .sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
        if (spells.length > 0) {
          UIGame.playCard(spells[0]._uid);
          return spells[0].name;
        }
        return null;
      });

      if (playedSpell) {
        console.log(`  🪄 Cast: ${playedSpell}`);
        await page.waitForTimeout(700);
        continue;
      }

      // Nothing to play, pass
      console.log('  ➡️ Pass priority');
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
    }
    else if (wiType === 'declare_attackers') {
      const attacked = await page.evaluate(() => {
        const gs = UIGame.gameState;
        const bf0 = gs.players[0].zones.battlefield.cards || [];
        const creatures = bf0.filter(c =>
          c.types && c.types.includes('Creature') &&
          !c._summoningSick &&
          !c._tapped
        );
        creatures.forEach(c => UIGame.toggleAttacker(c._uid));
        return creatures.length;
      });

      if (attacked > 0) {
        console.log(`  ⚔️ Attacking with ${attacked} creature(s)`);
      }

      await page.evaluate(() => UIGame.confirmAttackers());
      await page.waitForTimeout(500);
    }
    else if (wiType === 'declare_blockers') {
      const blocked = await page.evaluate(() => {
        const gs = UIGame.gameState;
        const attackers = gs.combat.attackers || [];
        const bf0 = gs.players[0].zones.battlefield.cards || [];
        const blockers = bf0.filter(c =>
          c.types && c.types.includes('Creature') && !c._tapped
        );

        let blockCount = 0;
        if (attackers.length > 0 && blockers.length > 0) {
          const sortedA = [...attackers].sort((a, b) => (b.power || 0) - (a.power || 0));
          const sortedB = [...blockers].sort((a, b) => (b.toughness || 0) - (a.toughness || 0));

          const bigA = sortedA[0];
          const bigB = sortedB[0];
          if (bigB && bigA) {
            if ((bigB.toughness || 0) > (bigA.power || 0) || (bigB.power || 0) >= (bigA.toughness || 0)) {
              UIGame.selectBlocker(bigB._uid);
              if (typeof UIGame.selectAttackerToBlock === 'function') {
                UIGame.selectAttackerToBlock(bigA._uid);
              }
              blockCount = 1;
            }
          }
        }
        return blockCount;
      });

      if (blocked > 0) {
        console.log(`  🛡️ Blocking with ${blocked} creature(s)`);
      } else {
        console.log('  🏃 No blocks');
      }

      await page.evaluate(() => UIGame.confirmBlockers());
      await page.waitForTimeout(500);
    }
    else if (wiType === 'instant_priority') {
      console.log('  ⚡ Pass (instant priority)');
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
    }
    else if (wiType === 'scry' || wiType === 'surveil') {
      console.log(`  🔮 ${wiType}: confirming`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
    else if (wiType === 'select_target') {
      const targeted = await page.evaluate(() => {
        const el = document.querySelector('.bf-card.targetable, .bf-card.valid-target');
        if (el) { el.click(); return true; }
        return false;
      });
      if (!targeted) {
        console.log('  🎯 No target, pressing Escape');
        await page.keyboard.press('Escape');
      } else {
        console.log('  🎯 Selected target');
      }
      await page.waitForTimeout(500);
    }
    else if (wiType === 'discard') {
      await page.evaluate(() => {
        const gs = UIGame.gameState;
        const hand = gs.players[0].zones.hand.getAll ? gs.players[0].zones.hand.getAll() : (gs.players[0].zones.hand.cards || []);
        if (hand.length > 0) {
          const nonLands = hand.filter(c => !(c.types && c.types.includes('Land')));
          const target = nonLands.length > 0
            ? nonLands.sort((a, b) => (b.cmc || 0) - (a.cmc || 0))[0]
            : hand[0];
          UIGame.selectDiscard(target._uid);
        }
      });
      console.log('  🗑️ Discarded a card');
      await page.waitForTimeout(500);
    }
    else {
      console.log(`  ❓ Unknown state: ${wiType}, pressing Space`);
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);
    }
  }

  // ========== 7. FINAL REPORT ==========
  await screenshot('final-state');

  const finalState = await page.evaluate(() => {
    try {
      const gs = UIGame.gameState;
      if (!gs) return null;
      const p0 = gs.players[0];
      const p1 = gs.players[1];
      const bf0 = p0.zones.battlefield.cards || [];
      const bf1 = p1.zones.battlefield.cards || [];
      return {
        turn: gs.turn,
        life: [p0.life, p1.life],
        winner: gs.winner,
        myBattlefield: bf0.map(c => c.name),
        opponentBattlefield: bf1.map(c => c.name),
        myHand: (p0.zones.hand.getAll ? p0.zones.hand.getAll() : (p0.zones.hand.cards || [])).length,
        myGraveyard: (p0.zones.graveyard.cards || []).length,
      };
    } catch(e) {
      return { error: e.message };
    }
  });

  console.log('\n==========================================');
  console.log('📊 FINAL GAME REPORT');
  console.log('==========================================');
  if (finalState && !finalState.error) {
    console.log(`  Turns played: ${finalState.turn}`);
    console.log(`  Life totals: Player ${finalState.life[0]} | AI ${finalState.life[1]}`);
    console.log(`  Winner: ${finalState.winner === null ? 'None (ongoing)' : finalState.winner === 0 ? 'Player' : 'AI'}`);
    console.log(`  My battlefield: ${finalState.myBattlefield.join(', ') || '(empty)'}`);
    console.log(`  Opponent battlefield: ${finalState.opponentBattlefield.join(', ') || '(empty)'}`);
    console.log(`  My hand: ${finalState.myHand} cards`);
    console.log(`  My graveyard: ${finalState.myGraveyard} cards`);
  } else if (finalState?.error) {
    console.log(`  ❌ Error reading final state: ${finalState.error}`);
  }
  console.log(`  Actions taken: ${actionCount}`);
  console.log(`  Console errors: ${logs.filter(l => l.type === 'error').length}`);

  if (logs.filter(l => l.type === 'error').length > 0) {
    console.log('\n  ❌ Console Errors:');
    logs.filter(l => l.type === 'error').slice(0, 10).forEach(l => console.log(`    - ${l.text.substring(0, 150)}`));
  }

  console.log('\n✅ Test complete! Browser will close in 5 seconds...');
  await page.waitForTimeout(5000);

} catch (error) {
  console.error('\n💥 Test failed:', error.message);
  await screenshot('error-state');
  await page.waitForTimeout(3000);
} finally {
  await browser.close();
}
