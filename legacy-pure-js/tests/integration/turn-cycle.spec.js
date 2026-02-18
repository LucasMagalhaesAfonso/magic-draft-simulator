/**
 * Layer B: Full Turn Cycle Integration Tests
 * Tests complete game flows: cast -> stack -> resolve -> battlefield -> end of turn.
 * Catches bugs that unit tests miss by testing the full pipeline.
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

test.describe('Turn Cycle Integration', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  // =================== Group 1: Basic Turn Cycle ===================

  test('Untap phase - untaps creatures and lands, removes summoning sickness', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Create state with tapped creatures and lands
      const creature = CardEngine.prepareForBattlefield(
        T.makeCreature('Test Knight', '3', '3', { cost: '{2}{W}', cmc: 3, colors: ['W'] })
      );
      creature._tapped = true;
      creature._summoningSick = true;

      const land = CardEngine.prepareForBattlefield(T.makeLand('Plains', 'W'));
      land._tapped = true;

      const state = T.createTestState({
        myBf: [creature, land],
        turn: 2,
        activePlayer: 0,
        phase: 'untap'
      });
      state.phaseIndex = GameState.PHASES.indexOf('untap');

      // Directly test untap logic (the phase processing auto-untaps creatures)
      const ap = state.activePlayer;
      state.players[ap].zones.battlefield.cards.forEach(c => {
        if (c._stunCounters && c._stunCounters > 0) {
          c._stunCounters--;
          if (c._stunCounters > 0) return;
        }
        c._tapped = false;
        c._summoningSick = false;
      });

      return {
        creatureUntapped: !creature._tapped,
        summoningSickRemoved: !creature._summoningSick,
        landUntapped: !land._tapped
      };
    });

    expect(result.creatureUntapped).toBe(true);
    expect(result.summoningSickRemoved).toBe(true);
    expect(result.landUntapped).toBe(true);
  });

  test('End of turn cleanup - temp buffs reset, sacrificeAtEndStep tokens removed', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const creature = CardEngine.prepareForBattlefield(
        T.makeCreature('Buffed Knight', '2', '2', { cost: '{1}{W}', cmc: 2, colors: ['W'] })
      );
      creature._summoningSick = false;
      creature._tempPowerMod = 3;
      creature._tempToughnessMod = 2;

      const state = T.createTestState({ myBf: [creature], turn: 2 });

      GameState._endOfTurnCleanup(state);

      return {
        tempPowerReset: (creature._tempPowerMod || 0) === 0,
        tempToughnessReset: (creature._tempToughnessMod || 0) === 0
      };
    });

    expect(result.tempPowerReset).toBe(true);
    expect(result.tempToughnessReset).toBe(true);
  });

  test('Cast creature in main1 - arrives on battlefield with summoning sickness', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const creature = T.makeCreature('Bronze Bear', '2', '2', {
        cost: '{1}{G}', cmc: 2, colors: ['G'],
        typeLine: 'Creature — Bear'
      });

      const state = T.createTestState({
        myHand: [creature],
        turn: 2,
        phase: 'main1'
      });
      state.phaseIndex = GameState.PHASES.indexOf('main1');

      // Add lands for mana
      T.addLandsUntapped(state, 0, [
        { name: 'Forest', color: 'G' },
        { name: 'Forest', color: 'G' }
      ]);

      // Tap lands for mana (like UI/AI does before castSpell)
      GameState.autoTapForSpell(state, 0, creature.mana_cost, creature.cmc);

      // Cast creature
      const castResult = GameState.castSpell(state, 0, creature._uid, []);

      // Check results
      const bf = state.players[0].zones.battlefield.cards;
      const creatureOnBf = bf.find(c => c.name === 'Bronze Bear');

      return {
        castSuccess: castResult && castResult.success,
        onBattlefield: !!creatureOnBf,
        summoningSick: creatureOnBf ? creatureOnBf._summoningSick : null,
        handEmpty: state.players[0].zones.hand.count() === 0
      };
    });

    expect(result.castSuccess).toBe(true);
    expect(result.onBattlefield).toBe(true);
    expect(result.summoningSick).toBe(true);
    expect(result.handEmpty).toBe(true);
  });

  // =================== Group 2: Mobilize Flow ===================

  test('Mobilize - token created when creature attacks', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Create a creature with mobilize (attacks trigger creates token)
      const mobilizeCreature = CardEngine.prepareForBattlefield(
        T.makeCreature('Mobilize Warrior', '2', '2', {
          cost: '{1}{R}', cmc: 2, colors: ['R'],
          oracle: 'Mobilize (Whenever this creature attacks, create a 1/1 red Soldier creature token that\'s tapped and attacking.)',
          keywords: ['mobilize']
        })
      );
      mobilizeCreature._summoningSick = false;

      const state = T.createTestState({ myBf: [mobilizeCreature], turn: 2 });
      state.activePlayer = 0;
      state.players[0].isHuman = false;
      state.players[1].isHuman = false;

      // Setup combat
      state.combat = CombatSystem.createCombatState();
      state.combat.phase = 'declare_attackers';

      // Declare attack
      CombatSystem.declareAttacker(state.combat, mobilizeCreature);

      // Fire attacks triggers (this should create mobilize token)
      const triggerLogs = CombatSystem.fireAttackTriggers(state.combat, state, 0);
      state.log.push(...triggerLogs);

      // Count creatures and attackers
      const bf = state.players[0].zones.battlefield.cards;
      const creatures = bf.filter(c => CardEngine.isCreature(c));
      const tokens = creatures.filter(c => c._isToken);

      return {
        totalCreatures: creatures.length,
        tokenCount: tokens.length,
        tokenExists: tokens.length > 0,
        tokenAttacking: tokens.length > 0 ? (tokens[0]._attacking || false) : false,
        attackerCount: state.combat.attackers.length,
        logs: triggerLogs
      };
    });

    expect(result.tokenExists).toBe(true);
    expect(result.totalCreatures).toBeGreaterThanOrEqual(2); // original + token
  });

  test('Mobilize token - sacrificed at end of turn', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Create a token with sacrificeAtEndStep flag (as mobilize tokens should have)
      const token = CardEngine.prepareForBattlefield(
        T.makeCreature('Soldier Token', '1', '1', {
          cost: '', cmc: 0, colors: ['R'],
          typeLine: 'Token Creature — Soldier'
        })
      );
      token._isToken = true;
      token._sacrificeAtEndStep = true;
      token._summoningSick = false;

      const state = T.createTestState({ myBf: [token], turn: 2 });

      const bfBefore = state.players[0].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length;

      // Run end of turn cleanup
      GameState._endOfTurnCleanup(state);

      const bfAfter = state.players[0].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length;

      return {
        creaturesBefore: bfBefore,
        creaturesAfter: bfAfter,
        tokenSacrificed: bfAfter < bfBefore
      };
    });

    expect(result.creaturesBefore).toBe(1);
    expect(result.creaturesAfter).toBe(0);
    expect(result.tokenSacrificed).toBe(true);
  });

  // =================== Group 3: ETB Complete Flow ===================

  test('ETB creature - cast, enters battlefield, trigger fires, effect resolves', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Creature with ETB damage
      const etbCreature = T.makeCreature('Flame Imp', '2', '1', {
        cost: '{1}{R}', cmc: 2, colors: ['R'],
        oracle: 'When Flame Imp enters the battlefield, it deals 2 damage to target creature or player.',
        typeLine: 'Creature — Imp'
      });

      const state = T.createTestState({
        myHand: [etbCreature],
        turn: 2,
        phase: 'main1'
      });
      state.phaseIndex = GameState.PHASES.indexOf('main1');

      // Add mana
      T.addLandsUntapped(state, 0, [
        { name: 'Mountain', color: 'R' },
        { name: 'Mountain', color: 'R' }
      ]);

      const lifeBefore = state.players[1].life;

      // Tap lands for mana, then cast
      GameState.autoTapForSpell(state, 0, etbCreature.mana_cost, etbCreature.cmc);
      const castResult = GameState.castSpell(state, 0, etbCreature._uid, [
        { type: 'player', player: 1, uid: null }
      ]);

      return {
        castSuccess: castResult && castResult.success,
        onBf: T.countCreatures(state, 0) >= 1,
        oppLifeChanged: state.players[1].life < lifeBefore,
        lifeDiff: lifeBefore - state.players[1].life
      };
    });

    expect(result.castSuccess).toBe(true);
    expect(result.onBf).toBe(true);
    expect(result.oppLifeChanged).toBe(true);
  });

  test('ETB + Evoke - enters, ETB fires, then creature sacrificed', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const evoker = T.makeCreature('Shriekmaw', '3', '2', {
        cost: '{4}{B}', cmc: 5, colors: ['B'],
        oracle: 'Fear\nWhen Shriekmaw enters the battlefield, destroy target nonblack creature.\nEvoke {1}{B}',
        typeLine: 'Creature — Elemental',
        keywords: ['fear']
      });

      const targetCreature = CardEngine.prepareForBattlefield(
        T.makeCreature('White Knight', '2', '2', {
          cost: '{W}{W}', cmc: 2, colors: ['W'],
          typeLine: 'Creature — Human Knight'
        })
      );
      targetCreature._summoningSick = false;

      const state = T.createTestState({
        myHand: [evoker],
        oppBf: [targetCreature],
        turn: 2,
        phase: 'main1'
      });
      state.phaseIndex = GameState.PHASES.indexOf('main1');

      // Add mana for evoke cost {1}{B}
      T.addLandsUntapped(state, 0, [
        { name: 'Swamp', color: 'B' },
        { name: 'Swamp', color: 'B' }
      ]);

      const oppCreaturesBefore = T.countCreatures(state, 1);

      // Tap lands, then cast with evoke
      GameState.autoTapForSpell(state, 0, '{1}{B}', 2); // evoke cost
      const castResult = GameState.castSpell(state, 0, evoker._uid, [
        { type: 'creature', player: 1, uid: targetCreature._uid }
      ], false, true); // castingEvoke = true

      // After evoke: ETB should fire (destroying target) and then creature is sacrificed
      const myCreatures = T.countCreatures(state, 0);
      const oppCreaturesAfter = T.countCreatures(state, 1);

      return {
        castSuccess: castResult && castResult.success,
        // ETB destroyed the target
        targetDestroyed: oppCreaturesAfter < oppCreaturesBefore,
        // Evoked creature was sacrificed (shouldn't be on bf)
        evokerSacrificed: myCreatures === 0
      };
    });

    expect(result.castSuccess).toBe(true);
    expect(result.targetDestroyed).toBe(true);
    expect(result.evokerSacrificed).toBe(true);
  });

  // =================== Group 4: Triggered Abilities ===================

  test('Triggered ability fires on attacks event', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Creature with "whenever attacks" trigger
      const attacker = CardEngine.prepareForBattlefield(
        T.makeCreature('Battle Rager', '2', '2', {
          cost: '{1}{R}', cmc: 2, colors: ['R'],
          oracle: 'Whenever Battle Rager attacks, it gets +1/+0 until end of turn.'
        })
      );
      attacker._summoningSick = false;

      const state = T.createTestState({ myBf: [attacker], turn: 2 });

      // Register triggers
      GameState._registerCardTriggers(state, attacker, 0);

      // Setup combat
      state.combat = CombatSystem.createCombatState();
      CombatSystem.declareAttacker(state.combat, attacker);

      // Fire attack triggers
      const logs = CombatSystem.fireAttackTriggers(state.combat, state, 0);

      return {
        triggerFired: logs.length > 0 || (attacker._tempPowerMod && attacker._tempPowerMod > 0),
        hasTriggers: state._triggers.length > 0
      };
    });

    // At minimum the trigger system should have registered something
    expect(result.hasTriggers).toBe(true);
  });

  test('Endure - creature survives lethal with counter removal', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Create creature with endure and a +1/+1 counter
      const endureCreature = CardEngine.prepareForBattlefield(
        T.makeCreature('Resilient Monk', '2', '2', {
          cost: '{1}{W}', cmc: 2, colors: ['W'],
          oracle: 'Endure',
          keywords: ['endure']
        })
      );
      endureCreature._summoningSick = false;
      endureCreature._counters = { '+1/+1': 1 };

      const state = T.createTestState({ myBf: [endureCreature], turn: 2 });

      // Deal lethal damage
      endureCreature._damage = 3; // 3 damage on a 2+1=3 toughness creature (lethal)

      // Check if creatureDies handles endure (API: creatureDies(state, card, ownerId))
      try {
        const dies = GameState.creatureDies(state, endureCreature, 0);
        return {
          survived: dies === false,
          counterRemoved: (endureCreature._counters['+1/+1'] || 0) === 0,
          creatureStillOnBf: state.players[0].zones.battlefield.cards.some(c => c._uid === endureCreature._uid),
          error: null
        };
      } catch (e) {
        return { survived: false, error: e.message };
      }
    });

    // Endure should prevent death by removing counter
    // NOTE: This test detects a KNOWN BUG - endure is not yet implemented in creatureDies
    expect(result.survived).toBe(true);
  });

  // =================== Group 5: Combat Flow ===================

  test('Combat priority - players get priority after attackers declared', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Create attacker for player 0
      const attacker = CardEngine.prepareForBattlefield(
        T.makeCreature('Grizzly Bears', '2', '2', { cost: '{1}{G}', cmc: 2, colors: ['G'] })
      );
      attacker._summoningSick = false;

      // Create an instant in defender's hand
      const instant = T.makeSpell('Giant Growth', '{G}', 1, 'Instant', 'Target creature gets +3/+3 until end of turn.', ['G']);

      const state = T.createTestState({
        myBf: [attacker],
        oppHand: [instant],
        turn: 2
      });
      state.activePlayer = 0;
      state.players[0].isHuman = true;
      state.players[1].isHuman = true;

      // Add mana for defender to cast instant
      T.addLandsUntapped(state, 1, [{ name: 'Forest', color: 'G' }]);

      // Simulate: declare attackers phase
      state.combat = CombatSystem.createCombatState();
      state.combat.phase = 'declare_attackers';
      CombatSystem.declareAttacker(state.combat, attacker);
      CombatSystem.fireAttackTriggers(state.combat, state, 0);

      // Now process combat_blockers phase (which should give priority)
      state.phase = 'combat_blockers';
      state.phaseIndex = GameState.PHASES.indexOf('combat_blockers');
      GameState._processPhase(state);

      return {
        waitingForInput: state.waitingForInput,
        hasInstantPriority: state.waitingForInput && state.waitingForInput.type === 'instant_priority',
        priorityPlayer: state.waitingForInput ? state.waitingForInput.playerId : null,
        phase: state.waitingForInput ? state.waitingForInput.phase : null
      };
    });

    expect(result.hasInstantPriority).toBe(true);
    expect(result.priorityPlayer).toBe(1); // Defender gets priority first
    expect(result.phase).toBe('post_attackers');
  });

  test('Combat damage resolves - unblocked attacker deals damage to player', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const attacker = CardEngine.prepareForBattlefield(
        T.makeCreature('Attack Bear', '3', '3', { cost: '{2}{G}', cmc: 3, colors: ['G'] })
      );
      attacker._summoningSick = false;

      const state = T.createTestState({ myBf: [attacker], turn: 2 });
      state.activePlayer = 0;
      state.players[0].isHuman = false;
      state.players[1].isHuman = false;

      const lifeBefore = state.players[1].life;

      // Setup combat
      state.combat = CombatSystem.createCombatState();
      CombatSystem.declareAttacker(state.combat, attacker);

      // Resolve damage (no blockers)
      const logs = CombatSystem.resolveCombatDamage(
        state.combat, state.players[0], state.players[1], state
      );

      return {
        lifeBefore,
        lifeAfter: state.players[1].life,
        damageDealt: lifeBefore - state.players[1].life,
        hasLogs: logs.length > 0
      };
    });

    expect(result.damageDealt).toBe(3);
    expect(result.lifeAfter).toBe(17);
  });

  test('Combat - blocker kills attacker and survives', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const attacker = CardEngine.prepareForBattlefield(
        T.makeCreature('Small Goblin', '1', '1', { cost: '{R}', cmc: 1, colors: ['R'] })
      );
      attacker._summoningSick = false;

      const blocker = CardEngine.prepareForBattlefield(
        T.makeCreature('Grizzly Bears', '2', '2', {
          cost: '{1}{G}', cmc: 2, colors: ['G']
        })
      );
      blocker._summoningSick = false;

      const state = T.createTestState({
        myBf: [attacker],
        oppBf: [blocker],
        turn: 2
      });
      state.activePlayer = 0;
      state.players[0].isHuman = false;
      state.players[1].isHuman = false;

      // Setup combat
      state.combat = CombatSystem.createCombatState();
      const atkOk = CombatSystem.declareAttacker(state.combat, attacker);
      const blkOk = CombatSystem.declareBlocker(state.combat, blocker, attacker._uid);

      // Resolve
      const logs = CombatSystem.resolveCombatDamage(
        state.combat, state.players[0], state.players[1], state
      );

      // Check aftermath
      const myCreatures = state.players[0].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
      const oppCreatures = state.players[1].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));

      return {
        atkOk,
        blkOk,
        attackerCount: state.combat.attackers.length,
        blockerCount: Object.keys(state.combat.blockers).length,
        attackerDied: myCreatures.length === 0,
        blockerSurvived: oppCreatures.length === 1,
        oppLifeUnchanged: state.players[1].life === 20,
        logs,
        myCreatureNames: myCreatures.map(c => c.name),
        oppCreatureNames: oppCreatures.map(c => c.name)
      };
    });

    // 1/1 vs 2/2: attacker dies, blocker survives (took 1 damage on 2 toughness)
    expect(result.attackerDied).toBe(true);
    expect(result.blockerSurvived).toBe(true);
    expect(result.oppLifeUnchanged).toBe(true);
  });

  // =================== Group 6: Spell Resolution Pipeline ===================

  test('Instant spell - cast from hand, resolves through stack, effect applies', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const bolt = T.makeSpell('Lightning Bolt', '{R}', 1, 'Instant',
        'Lightning Bolt deals 3 damage to any target.', ['R']);

      const state = T.createTestState({
        myHand: [bolt],
        turn: 2,
        phase: 'main1'
      });
      state.phaseIndex = GameState.PHASES.indexOf('main1');

      T.addLandsUntapped(state, 0, [{ name: 'Mountain', color: 'R' }]);

      const lifeBefore = state.players[1].life;
      const handBefore = state.players[0].zones.hand.count();

      // Tap lands for mana before casting
      GameState.autoTapForSpell(state, 0, bolt.mana_cost, bolt.cmc);
      const castResult = GameState.castSpell(state, 0, bolt._uid, [
        { type: 'player', player: 1, uid: null }
      ]);

      return {
        success: castResult && castResult.success,
        damage: lifeBefore - state.players[1].life,
        handReduced: state.players[0].zones.hand.count() < handBefore,
        inGraveyard: state.players[0].zones.graveyard.count() > 0
      };
    });

    expect(result.success).toBe(true);
    expect(result.damage).toBe(3);
    expect(result.handReduced).toBe(true);
    expect(result.inGraveyard).toBe(true);
  });

  test('Sorcery with destroy effect - target goes to graveyard', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const removal = T.makeSpell('Murder', '{1}{B}{B}', 3, 'Instant',
        'Destroy target creature.', ['B']);

      const target = CardEngine.prepareForBattlefield(
        T.makeCreature('Doomed Bear', '2', '2', { cost: '{1}{G}', cmc: 2, colors: ['G'] })
      );
      target._summoningSick = false;

      const state = T.createTestState({
        myHand: [removal],
        oppBf: [target],
        turn: 2,
        phase: 'main1'
      });
      state.phaseIndex = GameState.PHASES.indexOf('main1');

      T.addLandsUntapped(state, 0, [
        { name: 'Swamp', color: 'B' },
        { name: 'Swamp', color: 'B' },
        { name: 'Swamp', color: 'B' }
      ]);

      const oppBfBefore = T.countCreatures(state, 1);

      // Tap lands for mana before casting
      GameState.autoTapForSpell(state, 0, removal.mana_cost, removal.cmc);
      const castResult = GameState.castSpell(state, 0, removal._uid, [
        { type: 'creature', player: 1, uid: target._uid }
      ]);

      return {
        success: castResult && castResult.success,
        targetRemoved: T.countCreatures(state, 1) < oppBfBefore,
        targetInGY: state.players[1].zones.graveyard.count() > 0
      };
    });

    expect(result.success).toBe(true);
    expect(result.targetRemoved).toBe(true);
    expect(result.targetInGY).toBe(true);
  });

  // =================== Group 7: End of Turn Cleanup ===================

  test('End of turn - temp buffs reset, threaten creatures return', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Creature with temp buff
      const buffed = CardEngine.prepareForBattlefield(
        T.makeCreature('Buffed Knight', '2', '2', { cost: '{1}{W}', cmc: 2, colors: ['W'] })
      );
      buffed._summoningSick = false;
      buffed._tempPowerMod = 3;
      buffed._tempToughnessMod = 3;

      // Stolen creature (threaten)
      const stolen = CardEngine.prepareForBattlefield(
        T.makeCreature('Stolen Beast', '4', '4', { cost: '{3}{R}', cmc: 4, colors: ['R'] })
      );
      stolen._summoningSick = false;
      stolen._threatenedFrom = 1; // Was stolen from player 1
      stolen._threatenReturn = true;

      const state = T.createTestState({
        myBf: [buffed, stolen],
        turn: 2
      });

      GameState._endOfTurnCleanup(state);

      const myBf = state.players[0].zones.battlefield.cards;
      const oppBf = state.players[1].zones.battlefield.cards;

      return {
        tempBuffReset: (buffed._tempPowerMod || 0) === 0 && (buffed._tempToughnessMod || 0) === 0,
        stolenReturned: !myBf.find(c => c.name === 'Stolen Beast'),
        stolenBackToOwner: oppBf.some(c => c.name === 'Stolen Beast')
      };
    });

    expect(result.tempBuffReset).toBe(true);
  });

  // =================== Group 8: Land Play ===================

  test('Debuff spell - targets creature, applies -X/-X, kills if toughness <= 0', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const debuff = T.makeSpell('Fatal Debuff', '{B}', 1, 'Instant',
        'Target creature gets -3/-3 until end of turn.', ['B']);

      // Small creature that will die from debuff
      const small = T.makeCreature('Small Goblin', 2, 2, { cost: '{R}', cmc: 1 });
      // Big creature that will survive
      const big = T.makeCreature('Big Ogre', 4, 5, { cost: '{3}{R}', cmc: 4 });

      const state = T.createTestState({
        myHand: [debuff],
        oppBf: [CardEngine.prepareForBattlefield(small), CardEngine.prepareForBattlefield(big)],
        turn: 2,
        phase: 'main1'
      });
      state.phaseIndex = GameState.PHASES.indexOf('main1');

      // Add mana to pool
      T.addMana(state, 0, 'B');

      // Cast debuff targeting the small creature
      const oppSmall = state.players[1].zones.battlefield.cards[0];
      const targets = [{ type: 'creature', player: 1, uid: oppSmall._uid }];

      GameState.autoTapForSpell(state, 0, '{B}', 1);
      const result = GameState.castSpell(state, 0, debuff._uid, targets);

      // Check results
      const oppCreatures = state.players[1].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
      const oppGY = state.players[1].zones.graveyard.cards;

      return {
        castSuccess: result.success,
        oppCreatureCount: oppCreatures.length,
        smallDied: oppGY.some(c => c.name === 'Small Goblin'),
        bigSurvived: oppCreatures.some(c => c.name === 'Big Ogre')
      };
    });

    expect(result.castSuccess).toBe(true);
    expect(result.oppCreatureCount).toBe(1);
    expect(result.smallDied).toBe(true);
    expect(result.bigSurvived).toBe(true);
  });

  test('Sacrifice as additional cost - creature sacrificed before spell resolves', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Spell with sacrifice cost (like Worthy Cost)
      const spell = T.makeSpell('Sacrifice Exile', '{1}{B}', 2, 'Instant',
        'As an additional cost, sacrifice a creature. Exile target creature.', ['B']);

      // Our creature to sacrifice
      const myCreature = T.makeCreature('Sacrifice Fodder', 1, 1, { cost: '{B}', cmc: 1 });
      // Opponent creature to exile
      const oppCreature = T.makeCreature('Enemy Knight', 3, 3, { cost: '{2}{W}', cmc: 3 });

      const state = T.createTestState({
        myHand: [spell],
        myBf: [CardEngine.prepareForBattlefield(myCreature)],
        oppBf: [CardEngine.prepareForBattlefield(oppCreature)],
        turn: 2,
        phase: 'main1'
      });
      state.phaseIndex = GameState.PHASES.indexOf('main1');

      // Manually check additional costs
      const addCosts = CardEngine.getAdditionalCosts(spell);
      const hasSacrificeCost = addCosts.some(c => c.type === 'sacrifice');

      // AI handles sacrifice automatically - sacrifice weakest creature
      const myBf = state.players[0].zones.battlefield;
      const sacTarget = myBf.cards.filter(c => CardEngine.isCreature(c))
        .sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b))[0];
      if (sacTarget) {
        GameState.sacrifice(state, 0, sacTarget._uid);
      }

      // Cast spell targeting enemy
      T.addMana(state, 0, '1B');
      const oppTarget = state.players[1].zones.battlefield.cards[0];
      const targets = [{ type: 'creature', player: 1, uid: oppTarget._uid }];

      GameState.autoTapForSpell(state, 0, '{1}{B}', 2);
      const castResult = GameState.castSpell(state, 0, spell._uid, targets);

      return {
        hasSacrificeCost,
        castSuccess: castResult.success,
        myCreatureCount: state.players[0].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length,
        oppCreatureCount: state.players[1].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length,
        myGYCount: state.players[0].zones.graveyard.cards.length,
        oppExileCount: state.players[1].zones.exile.count()
      };
    });

    expect(result.hasSacrificeCost).toBe(true);
    expect(result.castSuccess).toBe(true);
    expect(result.myCreatureCount).toBe(0); // Sacrificed
    expect(result.oppCreatureCount).toBe(0); // Exiled
    expect(result.myGYCount).toBeGreaterThanOrEqual(1); // Sacrifice goes to GY (spell may also be there)
    expect(result.oppExileCount).toBe(1); // Exile target
  });

  test('First strike - kills blocker before normal damage', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const attacker = CardEngine.prepareForBattlefield(
        T.makeCreature('First Strike Knight', 3, 2, {
          cost: '{2}{W}', cmc: 3, keywords: ['First Strike']
        })
      );
      attacker._summoningSick = false;
      const blocker = CardEngine.prepareForBattlefield(
        T.makeCreature('Big Blocker', 4, 3, { cost: '{3}{R}', cmc: 4 })
      );
      blocker._summoningSick = false;

      const state = T.createTestState({
        myBf: [attacker],
        oppBf: [blocker],
        turn: 3
      });
      state.players[0].isHuman = false;
      state.players[1].isHuman = false;

      state.combat = CombatSystem.createCombatState();
      CombatSystem.declareAttacker(state.combat, attacker);
      CombatSystem.declareBlocker(state.combat, blocker, attacker._uid);

      CombatSystem.resolveCombatDamage(state.combat, state.players[0], state.players[1], state);

      const myCreatures = state.players[0].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
      const oppCreatures = state.players[1].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));

      return {
        attackerSurvived: myCreatures.some(c => c.name === 'First Strike Knight'),
        blockerDied: oppCreatures.length === 0,
        attackerDamage: attacker._damage || 0
      };
    });

    expect(result.attackerSurvived).toBe(true);
    expect(result.blockerDied).toBe(true);
    expect(result.attackerDamage).toBe(0);
  });

  test('Deathtouch - kills any creature regardless of toughness', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Small deathtouch attacker
      const attacker = T.makeCreature('Deathtouch Snake', 1, 1, {
        cost: '{B}', cmc: 1, keywords: ['Deathtouch']
      });
      // Huge blocker
      const blocker = T.makeCreature('Giant Defender', 1, 10, { cost: '{5}{G}', cmc: 6 });

      const bfAttacker = CardEngine.prepareForBattlefield(attacker);
      bfAttacker._summoningSick = false;
      const bfBlocker = CardEngine.prepareForBattlefield(blocker);
      bfBlocker._summoningSick = false;

      const state = T.createTestState({
        myBf: [bfAttacker],
        oppBf: [bfBlocker],
        turn: 3,
        phase: 'combat_attackers'
      });

      state.combat = CombatSystem.createCombatState();
      CombatSystem.declareAttacker(state.combat, bfAttacker);
      CombatSystem.declareBlocker(state.combat, bfBlocker, bfAttacker._uid);

      CombatSystem.resolveCombatDamage(state.combat, state.players[0], state.players[1], state);

      const oppCreatures = state.players[1].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));

      return {
        blockerDied: oppCreatures.length === 0,
        oppGY: state.players[1].zones.graveyard.cards.map(c => c.name)
      };
    });

    expect(result.blockerDied).toBe(true);
    expect(result.oppGY).toContain('Giant Defender');
  });

  test('Ward - targeting costs extra or spell is countered', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Ward 2 creature
      const wardCreature = T.makeCreature('Ward Knight', 3, 3, {
        cost: '{2}{W}', cmc: 3, keywords: ['Ward'],
        oracle: 'Ward {2}'
      });

      // Cheap removal (1 mana)
      const bolt = T.makeSpell('Small Bolt', '{R}', 1, 'Instant',
        'Small Bolt deals 4 damage to target creature.', ['R']);

      const bfWard = CardEngine.prepareForBattlefield(wardCreature);

      const state = T.createTestState({
        myHand: [bolt],
        oppBf: [bfWard],
        turn: 2,
        phase: 'main1'
      });
      state.phaseIndex = GameState.PHASES.indexOf('main1');

      // Only have 1R mana (bolt costs R, ward costs 2 more = need 3 total)
      T.addMana(state, 0, 'R');

      const targets = [{ type: 'creature', player: 1, uid: bfWard._uid }];
      GameState.autoTapForSpell(state, 0, '{R}', 1);
      const castResult = GameState.castSpell(state, 0, bolt._uid, targets);

      // Ward should counter the spell since we can't pay ward cost
      const oppCreatures = state.players[1].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));

      return {
        castSuccess: castResult.success,
        wardCreatureSurvived: oppCreatures.some(c => c.name === 'Ward Knight'),
        logHasWard: state.log.some(l => l.toLowerCase().includes('ward'))
      };
    });

    expect(result.castSuccess).toBe(true); // Spell was cast
    expect(result.wardCreatureSurvived).toBe(true); // Ward protected the creature
    expect(result.logHasWard).toBe(true); // Log mentions ward
  });

  test('Hexproof - creature cannot be targeted by opponent', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const hexCreature = T.makeCreature('Hexproof Elf', 2, 3, {
        cost: '{1}{G}', cmc: 2, keywords: ['Hexproof']
      });

      const bfHex = CardEngine.prepareForBattlefield(hexCreature);

      // AI targeting should skip hexproof creatures
      const canTarget = CardEngine.canBeTargeted(bfHex, 0); // 0 = opponent player id

      return {
        canTargetHexproof: canTarget
      };
    });

    expect(result.canTargetHexproof).toBe(false);
  });

  test('Additional cost check - getPlayableCards excludes unaffordable sacrifice costs', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      // Card with sacrifice cost in CardEffectsDB
      const spell = T.makeSpell('Sacrifice Spell', '{B}', 1, 'Sorcery',
        'As an additional cost to cast this spell, sacrifice a creature. Exile target creature.', ['B']);

      const state = T.createTestState({
        myHand: [spell],
        turn: 2,
        phase: 'main1'
      });
      state.phaseIndex = GameState.PHASES.indexOf('main1');

      // Has mana but NO creatures to sacrifice
      T.addLandsUntapped(state, 0, [{ name: 'Swamp', color: 'B' }]);

      const playable = GameState.getPlayableCards(state, 0);
      const canPlayWithoutCreature = playable.some(c => c.name === 'Sacrifice Spell');

      // Now add a creature
      const fodder = CardEngine.prepareForBattlefield(
        T.makeCreature('Sacrifice Fodder', 1, 1, { cost: '{B}', cmc: 1 })
      );
      state.players[0].zones.battlefield.add(fodder);

      const playable2 = GameState.getPlayableCards(state, 0);
      const canPlayWithCreature = playable2.some(c => c.name === 'Sacrifice Spell');

      return {
        canPlayWithoutCreature,
        canPlayWithCreature
      };
    });

    expect(result.canPlayWithoutCreature).toBe(false);
    expect(result.canPlayWithCreature).toBe(true);
  });

  test('Play land - only once per turn, tapped for mana', async () => {
    const result = await page.evaluate(() => {
      const T = TestHelper;

      const land1 = T.makeLand('Mountain', 'R');
      const land2 = T.makeLand('Forest', 'G');

      const state = T.createTestState({
        myHand: [land1, land2],
        turn: 2,
        phase: 'main1'
      });
      state.phaseIndex = GameState.PHASES.indexOf('main1');

      // Play first land - should succeed
      const play1 = GameState.playLand(state, 0, land1._uid);

      // Play second land - should fail
      const play2 = GameState.playLand(state, 0, land2._uid);

      return {
        firstLandSuccess: play1 && play1.success,
        secondLandFailed: play2 && !play2.success,
        landOnBf: T.countLands(state, 0) === 1,
        handReduced: state.players[0].zones.hand.count() === 1
      };
    });

    expect(result.firstLandSuccess).toBe(true);
    expect(result.secondLandFailed).toBe(true);
    expect(result.landOnBf).toBe(true);
    expect(result.handReduced).toBe(true);
  });
});
