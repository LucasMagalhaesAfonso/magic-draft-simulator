/**
 * Phase Sequence & Timing Tests (Layer K)
 *
 * Tests that game phases progress correctly, cleanup happens at right time,
 * priority windows appear at correct phases, stun counters interact with untap,
 * and end-of-turn effects resolve properly.
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

const HELPERS = `
function makeCreature(name, power, toughness, keywords, ownerId) {
  const uid = name.toLowerCase().replace(/\\s/g, '_') + '_' + ownerId;
  const card = CardEngine.prepareForBattlefield({
    id: uid, _uid: uid, name: name, type_line: 'Creature — Test',
    power: String(power), toughness: String(toughness),
    mana_cost: '{1}', cmc: 1, oracle_text: '',
    colors: [], color_identity: [], keywords: keywords || [],
    rarity: 'common', _ownerId: ownerId
  });
  return card;
}

function makeState() {
  const deck1 = [], deck2 = [];
  for (let i = 0; i < 30; i++) {
    deck1.push({ id: 'p_'+i, _uid: 'p0_pad_'+i, name: 'Pad '+i, type_line: 'Creature', power: '1', toughness: '1', mana_cost: '{1}', cmc: 1, oracle_text: '', colors: [], color_identity: [], keywords: [], rarity: 'common' });
    deck2.push({ id: 'o_'+i, _uid: 'p1_pad_'+i, name: 'OPad '+i, type_line: 'Creature', power: '1', toughness: '1', mana_cost: '{1}', cmc: 1, oracle_text: '', colors: [], color_identity: [], keywords: [], rarity: 'common' });
  }
  const state = GameState.create(deck1, deck2);
  state.mulliganDone = [true, true];
  state.players[0].isHuman = false;
  state.players[1].isHuman = false;
  return state;
}
`;

test.describe('Phase Sequence & Timing', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  // =================== PHASE ORDER ===================

  test('PHASES constant has all 12 phases in correct order', async () => {
    const result = await page.evaluate(() => {
      return GameState.PHASES;
    });

    expect(result).toEqual([
      'untap', 'upkeep', 'draw', 'main1',
      'combat_begin', 'combat_attackers', 'combat_blockers', 'combat_damage', 'combat_end',
      'main2', 'end', 'cleanup'
    ]);
    expect(result.length).toBe(12);
  });

  test('Phase index wraps around and switches active player on new turn', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      state.phaseIndex = 11; // cleanup (last phase)
      state.phase = 'cleanup';
      state.activePlayer = 0;
      state.turn = 1;

      // Advance should wrap to next turn
      GameState.advancePhase(state);

      return {
        phase: state.phase,
        phaseIndex: state.phaseIndex,
        activePlayer: state.activePlayer,
        turn: state.turn
      };
    }, HELPERS);

    expect(result.phaseIndex).toBe(0);
    expect(result.phase).toBe('untap');
    expect(result.activePlayer).toBe(1); // switched
    expect(result.turn).toBe(2);
  });

  // =================== UNTAP STEP ===================

  test('Untap step untaps all permanents and clears summoning sickness', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const c1 = makeCreature('Bear', 2, 2, [], 0);
      const c2 = makeCreature('Wolf', 3, 3, [], 0);
      c1._tapped = true;
      c2._tapped = true;
      c2._summoningSick = true;
      state.players[0].zones.battlefield.add(c1);
      state.players[0].zones.battlefield.add(c2);

      // Set to untap phase
      state.phaseIndex = -1;
      state.activePlayer = 0;
      state.phase = 'cleanup';
      // Advance to untap (wraps turn, switches player, so we set player to 1 to get back to 0)
      // Simpler: just call _processPhase directly at untap
      state.phaseIndex = 0;
      state.phase = 'untap';
      state._processingPhases = true;
      state._continueProcessing = false;
      GameState._processPhase(state);

      return {
        c1Tapped: c1._tapped,
        c2Tapped: c2._tapped,
        c2SummoningSick: c2._summoningSick
      };
    }, HELPERS);

    expect(result.c1Tapped).toBe(false);
    expect(result.c2Tapped).toBe(false);
    expect(result.c2SummoningSick).toBe(false);
  });

  test('Stun counter: creature with stun counter does NOT untap, loses 1 counter', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Golem', 4, 4, [], 0);
      creature._tapped = true;
      creature._stunCounters = 2;
      state.players[0].zones.battlefield.add(creature);

      state.phaseIndex = 0;
      state.phase = 'untap';
      state.activePlayer = 0;
      state._processingPhases = true;
      state._continueProcessing = false;
      GameState._processPhase(state);

      return {
        tapped: creature._tapped,
        stunCounters: creature._stunCounters
      };
    }, HELPERS);

    expect(result.tapped).toBe(true); // still tapped
    expect(result.stunCounters).toBe(1); // was 2, now 1
  });

  test('Stun counter: creature untaps when last stun counter is removed', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Golem', 4, 4, [], 0);
      creature._tapped = true;
      creature._stunCounters = 1;
      state.players[0].zones.battlefield.add(creature);

      state.phaseIndex = 0;
      state.phase = 'untap';
      state.activePlayer = 0;
      state._processingPhases = true;
      state._continueProcessing = false;
      GameState._processPhase(state);

      return {
        tapped: creature._tapped,
        stunCounters: creature._stunCounters
      };
    }, HELPERS);

    expect(result.tapped).toBe(false); // untaps now
    expect(result.stunCounters).toBe(0);
  });

  // =================== UPKEEP TRIGGERS ===================

  test('Upkeep triggers fire during upkeep phase', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Oracle', 1, 1, [], 0);
      state.players[0].zones.battlefield.add(creature);

      // Register upkeep trigger
      state._triggers.push({
        event: 'upkeep',
        controller: true,
        cardUid: creature._uid,
        cardName: 'Oracle',
        controllerId: 0,
        effects: [{ type: 'draw', amount: 1 }]
      });

      const handBefore = state.players[0].zones.hand.count();

      // Process upkeep
      state.phaseIndex = 1;
      state.phase = 'upkeep';
      state.activePlayer = 0;
      state._processingPhases = true;
      state._continueProcessing = false;
      GameState._processPhase(state);

      return {
        handBefore,
        handAfter: state.players[0].zones.hand.count(),
        drewFromTrigger: state.players[0].zones.hand.count() > handBefore
      };
    }, HELPERS);

    expect(result.drewFromTrigger).toBe(true);
  });

  // =================== END-OF-TURN CLEANUP ===================

  test('End-of-turn cleanup resets all temporary state', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();

      // Creature with temp buff, damage, temp keyword, regeneration, cant-block
      const creature = makeCreature('Fighter', 3, 3, ['Flying'], 0);
      creature._damage = 2;
      creature._powerMod = 4; // 2 permanent + 2 temp
      creature._tempPowerMod = 2;
      creature._toughnessMod = 3; // 1 permanent + 2 temp
      creature._tempToughnessMod = 2;
      creature._cantBlockThisTurn = true;
      creature._regenerateShield = true;
      creature.keywords.push('Haste');
      creature._tempKeywords = ['Haste'];
      state.players[0].zones.battlefield.add(creature);

      // Damage prevention shield
      state._damageShield = { 0: 3, 1: 2 };

      GameState._endOfTurnCleanup(state);

      return {
        damage: creature._damage,
        powerMod: creature._powerMod,
        tempPowerMod: creature._tempPowerMod,
        toughMod: creature._toughnessMod,
        tempToughMod: creature._tempToughnessMod,
        cantBlock: creature._cantBlockThisTurn,
        regenShield: creature._regenerateShield,
        hasHaste: CardEngine.hasKeyword(creature, 'Haste'),
        hasFlying: CardEngine.hasKeyword(creature, 'Flying'),
        damageShield: state._damageShield
      };
    }, HELPERS);

    expect(result.damage).toBe(0);
    expect(result.powerMod).toBe(2);  // 4 - 2 temp = 2 permanent
    expect(result.tempPowerMod).toBe(0);
    expect(result.toughMod).toBe(1);  // 3 - 2 temp = 1 permanent
    expect(result.tempToughMod).toBe(0);
    expect(result.cantBlock).toBeUndefined();
    expect(result.regenShield).toBeUndefined();
    expect(result.hasHaste).toBe(false); // temp keyword removed
    expect(result.hasFlying).toBe(true); // permanent keyword stays
    expect(result.damageShield).toBeNull();
  });

  // =================== MANA POOL RESET ===================

  test('Mana pool resets at turn boundary', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      state.manaPool[0] = { W: 2, U: 1, B: 0, R: 0, G: 3, C: 0 };
      state.manaPool[1] = { W: 0, U: 0, B: 0, R: 4, G: 0, C: 0 };
      state.phaseIndex = 11; // cleanup
      state.phase = 'cleanup';
      state.activePlayer = 0;

      GameState.advancePhase(state);

      const pool0Total = Object.values(state.manaPool[0]).reduce((a, b) => a + b, 0);
      const pool1Total = Object.values(state.manaPool[1]).reduce((a, b) => a + b, 0);

      return { pool0Total, pool1Total };
    }, HELPERS);

    expect(result.pool0Total).toBe(0);
    expect(result.pool1Total).toBe(0);
  });

  // =================== LAND PLAY TRACKING ===================

  test('Land played flag resets at turn boundary', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      state.landPlayedThisTurn = true;
      state.phaseIndex = 11;
      state.phase = 'cleanup';
      state.activePlayer = 0;

      GameState.advancePhase(state);

      return { landPlayed: state.landPlayedThisTurn };
    }, HELPERS);

    expect(result.landPlayed).toBe(false);
  });

  // =================== COMBAT SUB-PHASES ===================

  test('Combat phases progress in correct order', async () => {
    const result = await page.evaluate(() => {
      const phases = GameState.PHASES;
      const combatStart = phases.indexOf('combat_begin');
      const combatEnd = phases.indexOf('combat_end');
      const combatPhases = phases.slice(combatStart, combatEnd + 1);

      return { combatPhases };
    });

    expect(result.combatPhases).toEqual([
      'combat_begin', 'combat_attackers', 'combat_blockers', 'combat_damage', 'combat_end'
    ]);
  });

  // =================== VIGILANCE IN COMBAT RESET ===================

  test('Vigilance: attacking creature does NOT get tapped after combat', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const vigilant = makeCreature('Sentinel', 3, 3, ['Vigilance'], 0);
      const normal = makeCreature('Warrior', 2, 2, [], 0);
      state.players[0].zones.battlefield.add(vigilant);
      state.players[0].zones.battlefield.add(normal);

      // Set up combat
      const combatState = CombatSystem.createCombatState();
      combatState.attackers.push({ uid: vigilant._uid, card: vigilant });
      combatState.attackers.push({ uid: normal._uid, card: normal });
      vigilant._attacking = true;
      normal._attacking = true;

      // Resolve and reset
      CombatSystem.resolveCombatDamage(combatState, state.players[0], state.players[1], state);

      return {
        vigilantTapped: vigilant._tapped,
        normalTapped: normal._tapped
      };
    }, HELPERS);

    expect(result.vigilantTapped).toBe(false); // vigilance
    expect(result.normalTapped).toBe(true); // normal gets tapped
  });

  // =================== BECOMES_TAPPED TRIGGER ===================

  test('Becomes_tapped trigger fires on the creature that gets tapped (self trigger)', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const attacker = makeCreature('Knight', 2, 2, [], 0);
      state.players[0].zones.battlefield.add(attacker);

      // Register becomes_tapped as SELF trigger on the attacker
      state._triggers.push({
        event: 'becomes_tapped',
        self: true,
        cardUid: attacker._uid,
        cardName: 'Knight',
        controllerId: 0,
        effects: [{ type: 'draw', amount: 1 }]
      });

      const handBefore = state.players[0].zones.hand.count();

      // Combat: attacker attacks, gets tapped in reset
      const combatState = CombatSystem.createCombatState();
      combatState.attackers.push({ uid: attacker._uid, card: attacker });
      attacker._attacking = true;

      CombatSystem.resolveCombatDamage(combatState, state.players[0], state.players[1], state);

      return {
        handBefore,
        handAfter: state.players[0].zones.hand.count()
      };
    }, HELPERS);

    // becomes_tapped should have fired on the attacker, drawing a card
    expect(result.handAfter).toBeGreaterThan(result.handBefore);
  });

  // =================== SPELLS THIS TURN RESET ===================

  test('Spells this turn counter resets at turn boundary', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      state._spellsThisTurn = [3, 2];
      state.phaseIndex = 11;
      state.phase = 'cleanup';
      state.activePlayer = 0;

      GameState.advancePhase(state);

      return { spells: state._spellsThisTurn };
    }, HELPERS);

    expect(result.spells).toEqual([0, 0]);
  });

  // =================== END STEP TRIGGERS ===================

  test('End step triggers fire during end phase', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Watcher', 1, 1, [], 0);
      state.players[0].zones.battlefield.add(creature);

      state._triggers.push({
        event: 'end_step',
        controller: true,
        cardUid: creature._uid,
        cardName: 'Watcher',
        controllerId: 0,
        effects: [{ type: 'gainLife', amount: 1 }]
      });

      const lifeBefore = state.players[0].life;

      // Process end phase
      state.phaseIndex = 10;
      state.phase = 'end';
      state.activePlayer = 0;
      state._processingPhases = true;
      state._continueProcessing = false;
      GameState._processPhase(state);

      return { lifeBefore, lifeAfter: state.players[0].life };
    }, HELPERS);

    expect(result.lifeAfter).toBe(result.lifeBefore + 1);
  });

  // =================== COMBAT_BEGIN TRIGGER ===================

  test('Combat_begin trigger fires with correct event matching', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Marshal', 2, 2, [], 0);
      state.players[0].zones.battlefield.add(creature);

      // Register combat_begin trigger (uses playerId matching)
      state._triggers.push({
        event: 'combat_begin',
        controller: true,
        cardUid: creature._uid,
        cardName: 'Marshal',
        controllerId: 0,
        effects: [{ type: 'gainLife', amount: 1 }]
      });

      const lifeBefore = state.players[0].life;

      // Fire combat_begin directly with playerId matching
      const logs = GameState.fireTrigger(state, 'combat_begin', { playerId: 0 });

      return {
        lifeBefore,
        lifeAfter: state.players[0].life,
        logsHasTrigger: logs.some(l => l.includes('Marshal'))
      };
    }, HELPERS);

    expect(result.lifeAfter).toBe(result.lifeBefore + 1);
    expect(result.logsHasTrigger).toBe(true);
  });
});
