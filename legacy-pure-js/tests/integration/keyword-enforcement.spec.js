/**
 * Keyword Enforcement Tests (Layer I)
 *
 * Tests that combat keywords are actually enforced by the game engine:
 * Flying, Reach, Menace, First Strike, Double Strike, Deathtouch,
 * Lifelink, Trample, Vigilance, Defender, Haste, Indestructible, Hexproof
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

/**
 * Helper: create a creature card with given stats and keywords.
 */
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

function makeGameState() {
  const deck1 = [], deck2 = [];
  for (let i = 0; i < 30; i++) {
    deck1.push({ id: 'p_'+i, _uid: 'p0_pad_'+i, name: 'Pad '+i, type_line: 'Creature', power: '1', toughness: '1', mana_cost: '{1}', cmc: 1, oracle_text: '', colors: [], color_identity: [], keywords: [], rarity: 'common' });
    deck2.push({ id: 'o_'+i, _uid: 'p1_pad_'+i, name: 'OPad '+i, type_line: 'Creature', power: '1', toughness: '1', mana_cost: '{1}', cmc: 1, oracle_text: '', colors: [], color_identity: [], keywords: [], rarity: 'common' });
  }
  const state = GameState.create(deck1, deck2);
  state.mulliganDone = [true, true];
  state.phase = 'combat_damage';
  state.activePlayer = 0;
  state.players[0].isHuman = false;
  state.players[1].isHuman = false;
  return state;
}

function runCombat(state, attackers, blockerMap) {
  const combatState = CombatSystem.createCombatState();
  attackers.forEach(card => {
    combatState.attackers.push({ uid: card._uid, card });
    card._attacking = true;
  });
  // blockerMap: { attackerUid: [blockerCard, ...] }
  if (blockerMap) {
    for (const [aUid, blockers] of Object.entries(blockerMap)) {
      combatState.blockers[aUid] = blockers.map(b => ({ uid: b._uid, card: b }));
    }
  }
  const log = CombatSystem.resolveCombatDamage(
    combatState, state.players[0], state.players[1], state
  );
  return { log, combatState };
}
`;

test.describe('Keyword Enforcement', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  // =================== FLYING ===================

  test('Flying: ground creature cannot block flyer', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const flyer = makeCreature('Eagle', 2, 2, ['Flying'], 0);
      const ground = makeCreature('Bear', 2, 2, [], 1);
      return CardEngine.canBlock(ground, flyer);
    }, HELPERS);
    expect(result).toBe(false);
  });

  test('Flying: flyer can block flyer', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const flyer1 = makeCreature('Eagle', 2, 2, ['Flying'], 0);
      const flyer2 = makeCreature('Hawk', 2, 2, ['Flying'], 1);
      return CardEngine.canBlock(flyer2, flyer1);
    }, HELPERS);
    expect(result).toBe(true);
  });

  test('Flying: reach creature can block flyer', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const flyer = makeCreature('Eagle', 2, 2, ['Flying'], 0);
      const reacher = makeCreature('Archer', 2, 2, ['Reach'], 1);
      return CardEngine.canBlock(reacher, flyer);
    }, HELPERS);
    expect(result).toBe(true);
  });

  test('Flying: unblocked flyer deals damage to player', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      const flyer = makeCreature('Eagle', 3, 2, ['Flying'], 0);
      state.players[0].zones.battlefield.add(flyer);
      const startLife = state.players[1].life;
      runCombat(state, [flyer], {});
      return { lifeLost: startLife - state.players[1].life };
    }, HELPERS);
    expect(result.lifeLost).toBe(3);
  });

  // =================== MENACE ===================

  test('Menace: 1 blocker is invalid', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const menace = makeCreature('Menace Brute', 3, 3, ['Menace'], 0);
      const blocker = makeCreature('Guard', 2, 2, [], 1);
      const combatState = CombatSystem.createCombatState();
      combatState.attackers.push({ uid: menace._uid, card: menace });
      combatState.blockers[menace._uid] = [{ uid: blocker._uid, card: blocker }];
      const invalid = CombatSystem.validateBlockers(combatState);
      return invalid.length;
    }, HELPERS);
    expect(result).toBe(1);
  });

  test('Menace: 2 blockers is valid', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const menace = makeCreature('Menace Brute', 3, 3, ['Menace'], 0);
      const b1 = makeCreature('Guard 1', 2, 2, [], 1);
      const b2 = makeCreature('Guard 2', 2, 2, [], 1);
      const combatState = CombatSystem.createCombatState();
      combatState.attackers.push({ uid: menace._uid, card: menace });
      combatState.blockers[menace._uid] = [
        { uid: b1._uid, card: b1 },
        { uid: b2._uid, card: b2 }
      ];
      const invalid = CombatSystem.validateBlockers(combatState);
      return invalid.length;
    }, HELPERS);
    expect(result).toBe(0);
  });

  test('Menace: 0 blockers is valid (unblocked)', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const menace = makeCreature('Menace Brute', 3, 3, ['Menace'], 0);
      const combatState = CombatSystem.createCombatState();
      combatState.attackers.push({ uid: menace._uid, card: menace });
      combatState.blockers[menace._uid] = [];
      const invalid = CombatSystem.validateBlockers(combatState);
      return invalid.length;
    }, HELPERS);
    expect(result).toBe(0);
  });

  // =================== FIRST STRIKE ===================

  test('First Strike: kills blocker before it deals damage back', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      // 3/1 first strike attacks into 2/3 blocker
      // First strike deals 3 damage to 2/3, killing it
      // Dead blocker never hits back
      const attacker = makeCreature('First Striker', 3, 1, ['First Strike'], 0);
      const blocker = makeCreature('Blocker', 2, 3, [], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      const attackerAlive = state.players[0].zones.battlefield.cards.some(c => c._uid === attacker._uid);
      const blockerAlive = state.players[1].zones.battlefield.cards.some(c => c._uid === blocker._uid);
      return { attackerAlive, blockerAlive, attackerDamage: attacker._damage };
    }, HELPERS);
    expect(result.blockerAlive).toBe(false);
    expect(result.attackerAlive).toBe(true);
    expect(result.attackerDamage).toBe(0); // blocker never hit back
  });

  test('First Strike: without it, both trade', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      // 3/1 without first strike attacks into 2/3 blocker
      // Both deal damage simultaneously, 3/1 dies to 2 damage, 2/3 dies to 3 damage
      const attacker = makeCreature('Normal Attacker', 3, 1, [], 0);
      const blocker = makeCreature('Blocker', 2, 3, [], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      const attackerAlive = state.players[0].zones.battlefield.cards.some(c => c._uid === attacker._uid);
      const blockerAlive = state.players[1].zones.battlefield.cards.some(c => c._uid === blocker._uid);
      return { attackerAlive, blockerAlive };
    }, HELPERS);
    expect(result.attackerAlive).toBe(false);
    expect(result.blockerAlive).toBe(false);
  });

  // =================== DOUBLE STRIKE ===================

  test('Double Strike: deals damage in both phases', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      // 2/2 double strike attacks unblocked: 2 + 2 = 4 damage
      const attacker = makeCreature('Double Striker', 2, 2, ['Double Strike'], 0);
      state.players[0].zones.battlefield.add(attacker);
      const startLife = state.players[1].life;

      runCombat(state, [attacker], {});

      return { totalDamage: startLife - state.players[1].life };
    }, HELPERS);
    expect(result.totalDamage).toBe(4);
  });

  test('Double Strike: kills blocker in first strike phase, trample does NOT apply without trample', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      // 4/4 double strike attacks, blocked by 2/2
      // First strike: 4 damage kills 2/2
      // Regular phase: no blockers left, but excess doesn't trample
      const attacker = makeCreature('Big DS', 4, 4, ['Double Strike'], 0);
      const blocker = makeCreature('Small', 2, 2, [], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);
      const startLife = state.players[1].life;

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      const blockerAlive = state.players[1].zones.battlefield.cards.some(c => c._uid === blocker._uid);
      return { blockerAlive, playerDamage: startLife - state.players[1].life };
    }, HELPERS);
    expect(result.blockerAlive).toBe(false);
    expect(result.playerDamage).toBe(0); // no trample
  });

  // =================== DEATHTOUCH ===================

  test('Deathtouch: 1/1 kills any creature', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      // 1/1 deathtouch attacks, blocked by 10/10
      const attacker = makeCreature('Venomous', 1, 1, ['Deathtouch'], 0);
      const blocker = makeCreature('Giant', 10, 10, [], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      const blockerAlive = state.players[1].zones.battlefield.cards.some(c => c._uid === blocker._uid);
      return { blockerAlive };
    }, HELPERS);
    expect(result.blockerAlive).toBe(false);
  });

  test('Deathtouch: blocker with deathtouch kills attacker', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      const attacker = makeCreature('Big Attacker', 5, 5, [], 0);
      const blocker = makeCreature('Deathtouch Blocker', 1, 1, ['Deathtouch'], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      const attackerAlive = state.players[0].zones.battlefield.cards.some(c => c._uid === attacker._uid);
      return { attackerAlive };
    }, HELPERS);
    expect(result.attackerAlive).toBe(false);
  });

  test('Deathtouch + trample: assigns 1 to blocker, rest to player', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      // 5/5 deathtouch + trample attacks, blocked by 3/3
      // Deathtouch only needs 1 damage to kill, rest (4) tramples through
      const attacker = makeCreature('Deathtrample', 5, 5, ['Deathtouch', 'Trample'], 0);
      const blocker = makeCreature('Blocker', 3, 3, [], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);
      const startLife = state.players[1].life;

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      const blockerAlive = state.players[1].zones.battlefield.cards.some(c => c._uid === blocker._uid);
      return { blockerAlive, trampleDamage: startLife - state.players[1].life };
    }, HELPERS);
    expect(result.blockerAlive).toBe(false);
    expect(result.trampleDamage).toBe(4); // 5 - 1 (deathtouch) = 4 trampled
  });

  // =================== LIFELINK ===================

  test('Lifelink: attacker gains life from unblocked damage', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      state.players[0].life = 15; // start below 20
      const attacker = makeCreature('Healer', 4, 4, ['Lifelink'], 0);
      state.players[0].zones.battlefield.add(attacker);

      runCombat(state, [attacker], {});

      return { life: state.players[0].life };
    }, HELPERS);
    expect(result.life).toBe(19); // 15 + 4 = 19
  });

  test('Lifelink: blocker gains life for defending player', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      state.players[1].life = 15;
      const attacker = makeCreature('Attacker', 2, 4, [], 0);
      const blocker = makeCreature('LifeBlocker', 3, 3, ['Lifelink'], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      return { defLife: state.players[1].life };
    }, HELPERS);
    expect(result.defLife).toBe(18); // 15 + 3 = 18
  });

  // =================== TRAMPLE ===================

  test('Trample: excess damage goes to player', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      // 5/5 trample attacks, blocked by 2/2
      // 2 damage kills blocker, 3 tramples to player
      const attacker = makeCreature('Trampler', 5, 5, ['Trample'], 0);
      const blocker = makeCreature('Small', 2, 2, [], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);
      const startLife = state.players[1].life;

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      return { trampleDamage: startLife - state.players[1].life };
    }, HELPERS);
    expect(result.trampleDamage).toBe(3);
  });

  test('No trample: excess damage does NOT go to player', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      const attacker = makeCreature('NoTrampler', 5, 5, [], 0);
      const blocker = makeCreature('Small', 2, 2, [], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);
      const startLife = state.players[1].life;

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      return { trampleDamage: startLife - state.players[1].life };
    }, HELPERS);
    expect(result.trampleDamage).toBe(0);
  });

  // =================== VIGILANCE ===================

  test('Vigilance: attacker does NOT tap after combat', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      const vigilant = makeCreature('Vigilant', 3, 3, ['Vigilance'], 0);
      state.players[0].zones.battlefield.add(vigilant);

      runCombat(state, [vigilant], {});

      return { tapped: vigilant._tapped };
    }, HELPERS);
    expect(result.tapped).toBeFalsy();
  });

  test('No vigilance: attacker taps after combat', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      const normal = makeCreature('Normal', 3, 3, [], 0);
      state.players[0].zones.battlefield.add(normal);

      runCombat(state, [normal], {});

      return { tapped: normal._tapped };
    }, HELPERS);
    expect(result.tapped).toBe(true);
  });

  // =================== DEFENDER ===================

  test('Defender: cannot attack', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const defender = makeCreature('Wall', 0, 5, ['Defender'], 0);
      return CardEngine.canAttack(defender);
    }, HELPERS);
    expect(result).toBe(false);
  });

  test('Defender: can still block', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const defender = makeCreature('Wall', 0, 5, ['Defender'], 1);
      const attacker = makeCreature('Attacker', 3, 3, [], 0);
      return CardEngine.canBlock(defender, attacker);
    }, HELPERS);
    expect(result).toBe(true);
  });

  // =================== HASTE ===================

  test('Haste: can attack with summoning sickness', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const haste = makeCreature('Hasty', 3, 3, ['Haste'], 0);
      haste._summoningSick = true;
      return CardEngine.canAttack(haste);
    }, HELPERS);
    expect(result).toBe(true);
  });

  test('No haste: cannot attack with summoning sickness', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const normal = makeCreature('Slow', 3, 3, [], 0);
      normal._summoningSick = true;
      return CardEngine.canAttack(normal);
    }, HELPERS);
    expect(result).toBe(false);
  });

  // =================== INDESTRUCTIBLE ===================

  test('Indestructible: survives lethal combat damage', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      const attacker = makeCreature('Destroyer', 10, 10, [], 0);
      const blocker = makeCreature('Indestructible Wall', 1, 1, ['Indestructible'], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      const blockerAlive = state.players[1].zones.battlefield.cards.some(c => c._uid === blocker._uid);
      return { blockerAlive };
    }, HELPERS);
    expect(result.blockerAlive).toBe(true);
  });

  // =================== HEXPROOF ===================

  test('Hexproof: cannot be targeted by opponent', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const hexproof = makeCreature('Hexproof', 3, 3, ['Hexproof'], 0);
      // Opponent (player 1) tries to target
      return CardEngine.canBeTargeted(hexproof, 1);
    }, HELPERS);
    expect(result).toBe(false);
  });

  test('Hexproof: CAN be targeted by controller', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const hexproof = makeCreature('Hexproof', 3, 3, ['Hexproof'], 0);
      // Controller (player 0) targets own creature
      return CardEngine.canBeTargeted(hexproof, 0);
    }, HELPERS);
    expect(result).toBe(true);
  });

  // =================== WITHER ===================

  test('Wither: damage as -1/-1 counters in combat', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      const wither = makeCreature('Witherer', 3, 3, ['Wither'], 0);
      const blocker = makeCreature('Target', 2, 5, [], 1);
      state.players[0].zones.battlefield.add(wither);
      state.players[1].zones.battlefield.add(blocker);

      runCombat(state, [wither], { [wither._uid]: [blocker] });

      const blockerOnBf = state.players[1].zones.battlefield.cards.find(c => c._uid === blocker._uid);
      return {
        alive: !!blockerOnBf,
        counters: blockerOnBf?._counters?.['-1/-1'] || 0,
        damage: blockerOnBf?._damage || 0
      };
    }, HELPERS);
    expect(result.alive).toBe(true);
    expect(result.counters).toBe(3); // 3 damage as -1/-1 counters
    expect(result.damage).toBe(0);   // no regular damage
  });

  // =================== COMBINED KEYWORDS ===================

  test('Lifelink + Trample: gains life from total damage dealt', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      state.players[0].life = 15;
      // 5/5 lifelink + trample attacks, blocked by 2/2
      const attacker = makeCreature('LifeTrampler', 5, 5, ['Lifelink', 'Trample'], 0);
      const blocker = makeCreature('Small', 2, 2, [], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);
      const startDefLife = state.players[1].life;

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      return {
        attackerLife: state.players[0].life,
        trampleDamage: startDefLife - state.players[1].life
      };
    }, HELPERS);
    expect(result.attackerLife).toBe(20); // 15 + 5 (full power lifelink)
    expect(result.trampleDamage).toBe(3); // 5 - 2 (blocker toughness) = 3
  });

  test('First Strike + Deathtouch: kills before damage back', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      // 1/1 first strike + deathtouch attacks into 10/10
      const attacker = makeCreature('Deadly Fast', 1, 1, ['First Strike', 'Deathtouch'], 0);
      const blocker = makeCreature('Giant', 10, 10, [], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[1].zones.battlefield.add(blocker);

      runCombat(state, [attacker], { [attacker._uid]: [blocker] });

      const attackerAlive = state.players[0].zones.battlefield.cards.some(c => c._uid === attacker._uid);
      const blockerAlive = state.players[1].zones.battlefield.cards.some(c => c._uid === blocker._uid);
      return { attackerAlive, blockerAlive };
    }, HELPERS);
    expect(result.blockerAlive).toBe(false);
    expect(result.attackerAlive).toBe(true); // survived because 10/10 died in first strike phase
  });

  test('Flying + Vigilance: flies over ground, stays untapped', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeGameState();
      const fv = makeCreature('Angel', 4, 4, ['Flying', 'Vigilance'], 0);
      const ground = makeCreature('Bear', 3, 3, [], 1);
      state.players[0].zones.battlefield.add(fv);
      state.players[1].zones.battlefield.add(ground);

      // Ground creature can't block
      const canBlock = CardEngine.canBlock(ground, fv);

      // Attack unblocked
      const startLife = state.players[1].life;
      runCombat(state, [fv], {});

      return {
        canBlock,
        tapped: fv._tapped,
        damage: startLife - state.players[1].life
      };
    }, HELPERS);
    expect(result.canBlock).toBe(false);
    expect(result.tapped).toBeFalsy();
    expect(result.damage).toBe(4);
  });
});
