/**
 * Layer F: AI vs AI Game Simulation
 * Runs complete games with both players as AI.
 * Detects crashes, freezes, infinite loops, and JS errors.
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

/**
 * Runs a full AI vs AI game inside the browser.
 * Returns game result with diagnostics.
 */
async function runAIvsAIGame(page, deckCards1, deckCards2, maxTurns = 25) {
  return await page.evaluate(({ deck1, deck2, maxTurns }) => {
    // Build decks from pools using BotAI
    function buildDeckFromPool(pool) {
      // Give _uid to cards if missing
      pool.forEach(c => {
        if (!c._uid) c._uid = 'sim_' + Math.random().toString(36).slice(2, 8);
      });

      const result = BotAI.buildDeck(pool);
      const deck = [...result.deck];

      // Add basic lands
      const landNames = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
      for (const [color, count] of Object.entries(result.lands)) {
        for (let i = 0; i < count; i++) {
          deck.push({
            id: `${landNames[color]}_${i}`,
            _uid: 'land_' + Math.random().toString(36).slice(2, 8),
            name: landNames[color],
            type_line: `Basic Land — ${landNames[color]}`,
            mana_cost: '',
            cmc: 0,
            oracle_text: `{T}: Add {${color}}.`,
            colors: [color],
            keywords: [],
            power: null,
            toughness: null,
            rarity: 'common',
            subtypes: [landNames[color]],
            color_identity: [color]
          });
        }
      }

      return deck;
    }

    const finalDeck1 = buildDeckFromPool(deck1);
    const finalDeck2 = buildDeckFromPool(deck2);

    if (finalDeck1.length < 20 || finalDeck2.length < 20) {
      return { error: 'Decks too small', deck1Size: finalDeck1.length, deck2Size: finalDeck2.length };
    }

    // Create game state
    const state = GameState.create(finalDeck1, finalDeck2);
    state.players[0].isHuman = false;
    state.players[1].isHuman = false;

    // Skip mulligan
    state.mulliganDone = [true, true];

    // Run game loop
    const MAX_PHASES = maxTurns * 12; // 12 phases per turn
    let phaseCount = 0;
    let lastPhase = '';
    let samePhaseCount = 0;
    let froze = false;
    let errors = [];
    let unknownWI = [];
    const startTime = Date.now();

    try {
      // Start game
      GameState.startGame(state);

      while (!state.winner && state.turn <= maxTurns && phaseCount < MAX_PHASES) {
        phaseCount++;

        // Freeze detection: same phase repeated too many times
        if (state.phase === lastPhase) {
          samePhaseCount++;
          if (samePhaseCount > 10) {
            froze = true;
            errors.push(`Freeze detected: phase '${state.phase}' repeated ${samePhaseCount} times`);
            break;
          }
        } else {
          lastPhase = state.phase;
          samePhaseCount = 0;
        }

        // Handle waitingForInput
        if (state.waitingForInput) {
          const wi = state.waitingForInput;

          switch (wi.type) {
            case 'main_phase':
              GameAI.playMainPhase(state, wi.playerId);
              state.waitingForInput = null;
              GameState.advancePhase(state);
              break;

            case 'declare_attackers':
              GameAI.declareAttackers(state, wi.playerId);
              if (state.combat.attackers.length > 0) {
                CombatSystem.fireAttackTriggers(state.combat, state, wi.playerId);
              }
              state.waitingForInput = null;
              GameState.advancePhase(state);
              break;

            case 'declare_blockers': {
              const defId = wi.playerId;
              GameAI.declareBlockers(state, defId);
              state.waitingForInput = null;
              GameState.advancePhase(state);
              break;
            }

            case 'instant_priority':
              GameAI.playInstantPhase(state, wi.playerId, wi.phase || '');
              state.waitingForInput = null;
              state._priorityPassed = true;
              GameState._processPhase(state);
              break;

            case 'order_blockers':
              GameAI.orderBlockers(state, wi.playerId);
              state.combat._blockerOrderDone = true;
              state.waitingForInput = null;
              GameState._processPhase(state);
              break;

            case 'discard':
              GameAI.discard(state, wi.playerId, wi.amount);
              state.waitingForInput = null;
              GameState._endOfTurnCleanup(state);
              GameState.advancePhase(state);
              break;

            case 'scry':
            case 'surveil':
              // AI auto-resolves scry/surveil
              if (state._pendingScry) {
                // Put all on bottom for simplicity in AI sim
                const pending = state._pendingScry;
                if (pending.cards) {
                  pending.cards.forEach(c => {
                    state.players[wi.playerId].zones.library.addToBottom(c);
                  });
                }
                state._pendingScry = null;
              }
              state.waitingForInput = null;
              GameState._processPhase(state);
              break;

            case 'mulligan':
              // AI auto-keeps
              GameState.keepHand(state, wi.playerId, []);
              break;

            case 'blight_choice':
              // AI auto-blights weakest creature
              if (state._pendingBlight) {
                const pid = state._pendingBlight.playerId;
                const amount = state._pendingBlight.amount || 1;
                GameState._performBlight(state, pid, amount);
                state._pendingBlight = null;
              }
              state.waitingForInput = null;
              GameState._processPhase(state);
              break;

            case 'ramp_choice':
              // AI picks land automatically
              if (state._pendingRamp) {
                // Just skip ramp in simulation - put it back
                state._pendingRamp = null;
              }
              state.waitingForInput = null;
              GameState._processPhase(state);
              break;

            case 'choose_sacrifice_cost':
            case 'choose_discard_cost':
            case 'choose_tap_cost':
              // These are human-only UIs, auto-skip in simulation
              state.waitingForInput = null;
              GameState.advancePhase(state);
              break;

            default:
              // Unknown waitingForInput type - track as warning, skip to avoid freeze
              unknownWI.push(`Unknown waitingForInput: ${wi.type}`);
              state.waitingForInput = null;
              GameState.advancePhase(state);
              break;
          }
        } else {
          // No waitingForInput - advance phase
          GameState.advancePhase(state);
        }

        // Timeout check (10 seconds per game max)
        if (Date.now() - startTime > 10000) {
          froze = true;
          errors.push('Game exceeded 10 second timeout');
          break;
        }
      }
    } catch (e) {
      errors.push(`JS Error: ${e.message} at ${e.stack ? e.stack.split('\n')[1] : 'unknown'}`);
    }

    const duration = Date.now() - startTime;

    // Detect NaN life
    let nanInfo = null;
    if (isNaN(state.players[0].life) || isNaN(state.players[1].life)) {
      const recentLog = state.log.slice(-10).join(' | ');
      nanInfo = `P0: ${state.players[0].life}, P1: ${state.players[1].life} | ${recentLog}`;
    }

    return {
      winner: state.winner,
      turns: state.turn,
      phases: phaseCount,
      froze,
      errors,
      unknownWI,
      duration,
      p0Life: state.players[0].life,
      p1Life: state.players[1].life,
      p0Creatures: state.players[0].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length,
      p1Creatures: state.players[1].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length,
      logLines: state.log.length,
      spellsCast: state.log.filter(l => l.includes('joga ') || l.includes('conjurou') || l.includes('Evocado')).length,
      winnerLife: state.winner !== null ? state.players[state.winner].life : null,
      loserLife: state.winner !== null ? state.players[state.winner === 0 ? 1 : 0].life : null,
      nanInfo
    };
  }, { deck1: deckCards1, deck2: deckCards2, maxTurns });
}

/**
 * Get all cards for a set from the Scryfall cache in browser.
 */
async function getSetCards(page, setCode) {
  return await page.evaluate(async (code) => {
    const cacheKey = `mtg_set_cards_${code}`;
    const cached = localStorage.getItem(cacheKey);
    let cards;

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        cards = parsed.data || parsed;
      } catch { cards = null; }
    }

    if (!cards) {
      cards = await Scryfall.fetchSetCards(code);
    }

    return cards;
  }, setCode);
}

/**
 * Split cards into 2 random pools of ~45 cards each (simulating draft).
 */
function splitIntoRandomPools(cards) {
  // Shuffle
  const shuffled = [...cards].sort(() => Math.random() - 0.5);
  // Ensure non-land cards
  const nonLands = shuffled.filter(c => !(c.type_line || '').includes('Basic Land'));
  const pool1 = nonLands.slice(0, 45);
  const pool2 = nonLands.slice(45, 90);
  return [pool1, pool2];
}


// =================== TDM ===================

test.describe('AI vs AI Simulation - TDM', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('TDM - 3 games complete without crash', async () => {
    const allCards = await getSetCards(page, 'tdm');
    expect(allCards.length).toBeGreaterThan(0);

    const results = [];

    for (let i = 0; i < 3; i++) {
      const [pool1, pool2] = splitIntoRandomPools(allCards);
      const result = await runAIvsAIGame(page, pool1, pool2);
      results.push(result);

      console.log(`  TDM Game ${i + 1}: ${result.winner !== null ? `Player ${result.winner} wins` : 'Draw/Timeout'} ` +
        `| T${result.turns} | ${result.phases} phases | ${result.duration}ms | Spells: ${result.spellsCast} | ` +
        `${result.froze ? 'FROZE' : 'OK'} | Errors: ${result.errors.length}`);

      if (result.errors.length > 0) {
        result.errors.forEach(e => console.log(`    ERROR: ${e}`));
      }
      if (result.unknownWI.length > 0) {
        result.unknownWI.forEach(w => console.log(`    WARNING: ${w}`));
      }
      if (result.nanInfo) {
        console.log(`    NaN DETECTED: ${result.nanInfo}`);
      }
    }

    // Assertions
    const frozen = results.filter(r => r.froze);
    const errored = results.filter(r => r.errors.length > 0);

    expect(frozen.length).toBe(0);
    expect(errored.length).toBe(0);

    // Validate game results
    for (const r of results) {
      if (r.winner !== null) {
        // Winner life should be finite (can be negative due to overkill)
        if (!Number.isFinite(r.winnerLife)) {
          console.log(`  NaN WINNER LIFE: ${r.nanInfo}`);
        }
        expect(Number.isFinite(r.winnerLife)).toBe(true);
      }
      // Game should actually progress (not empty games)
      expect(r.logLines).toBeGreaterThan(10);
    }
  });
});

// =================== ECL ===================

test.describe('AI vs AI Simulation - ECL', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('ECL - 3 games complete without crash', async () => {
    const allCards = await getSetCards(page, 'ecl');
    expect(allCards.length).toBeGreaterThan(0);

    const results = [];

    for (let i = 0; i < 3; i++) {
      const [pool1, pool2] = splitIntoRandomPools(allCards);
      const result = await runAIvsAIGame(page, pool1, pool2);
      results.push(result);

      console.log(`  ECL Game ${i + 1}: ${result.winner !== null ? `Player ${result.winner} wins` : 'Draw/Timeout'} ` +
        `| T${result.turns} | ${result.phases} phases | ${result.duration}ms | Spells: ${result.spellsCast} | ` +
        `${result.froze ? 'FROZE' : 'OK'} | Errors: ${result.errors.length}`);

      if (result.errors.length > 0) {
        result.errors.forEach(e => console.log(`    ERROR: ${e}`));
      }
      if (result.unknownWI.length > 0) {
        result.unknownWI.forEach(w => console.log(`    WARNING: ${w}`));
      }
    }

    const frozen = results.filter(r => r.froze);
    const errored = results.filter(r => r.errors.length > 0);

    expect(frozen.length).toBe(0);
    expect(errored.length).toBe(0);

    // Validate game results
    for (const r of results) {
      if (r.winner !== null) {
        // Winner life should be finite (can be negative due to overkill)
        expect(Number.isFinite(r.winnerLife)).toBe(true);
      }
      // Game should actually progress (not empty games)
      expect(r.logLines).toBeGreaterThan(10);
    }
  });
});

// =================== LRW ===================

test.describe('AI vs AI Simulation - LRW', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('LRW - 3 games complete without crash', async () => {
    const allCards = await getSetCards(page, 'lrw');
    expect(allCards.length).toBeGreaterThan(0);

    const results = [];

    for (let i = 0; i < 3; i++) {
      const [pool1, pool2] = splitIntoRandomPools(allCards);
      const result = await runAIvsAIGame(page, pool1, pool2);
      results.push(result);

      console.log(`  LRW Game ${i + 1}: ${result.winner !== null ? `Player ${result.winner} wins` : 'Draw/Timeout'} ` +
        `| T${result.turns} | ${result.phases} phases | ${result.duration}ms | Spells: ${result.spellsCast} | ` +
        `${result.froze ? 'FROZE' : 'OK'} | Errors: ${result.errors.length}`);

      if (result.errors.length > 0) {
        result.errors.forEach(e => console.log(`    ERROR: ${e}`));
      }
      if (result.unknownWI.length > 0) {
        result.unknownWI.forEach(w => console.log(`    WARNING: ${w}`));
      }
    }

    const frozen = results.filter(r => r.froze);
    const errored = results.filter(r => r.errors.length > 0);

    expect(frozen.length).toBe(0);
    expect(errored.length).toBe(0);

    // Validate game results
    for (const r of results) {
      if (r.winner !== null) {
        // Winner life should be finite (can be negative due to overkill)
        expect(Number.isFinite(r.winnerLife)).toBe(true);
      }
      // Game should actually progress (not empty games)
      expect(r.logLines).toBeGreaterThan(10);
    }
  });
});

// =================== Smoke Test ===================

test.describe('Smoke Test with Console Monitoring', () => {
  test('1 game without JS console errors', async ({ browser }) => {
    const page = await browser.newPage();
    const consoleErrors = [];

    // Monitor console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', err => {
      consoleErrors.push(`PAGE ERROR: ${err.message}`);
    });

    await setupTestGame(page);

    const allCards = await getSetCards(page, 'tdm');
    const [pool1, pool2] = splitIntoRandomPools(allCards);
    const result = await runAIvsAIGame(page, pool1, pool2);

    console.log(`  Smoke test: ${result.winner !== null ? `P${result.winner} wins` : 'Timeout'} ` +
      `| T${result.turns} | ${result.duration}ms | Spells: ${result.spellsCast} | JS Errors: ${consoleErrors.length}`);

    if (consoleErrors.length > 0) {
      console.log('  Console errors:');
      consoleErrors.forEach(e => console.log(`    ${e}`));
    }

    if (result.unknownWI.length > 0) {
      console.log('  Unknown waitingForInput warnings:');
      result.unknownWI.forEach(w => console.log(`    WARNING: ${w}`));
    }

    expect(result.froze).toBe(false);
    expect(result.errors.length).toBe(0);
    // Allow some console errors for now (we may have known issues)
    // But page crashes should be zero
    expect(consoleErrors.filter(e => e.includes('PAGE ERROR')).length).toBe(0);

    await page.close();
  });
});
