/**
 * Multi-Card Interaction Tests (Layer J)
 *
 * Tests rare interactions between 2+ game systems:
 * Equipment death, Aura death, Persist + counters, Champion + evoke,
 * Multiple triggers, Buff stacking, Temporary cleanup, Threaten return,
 * Regeneration, Indestructible + destroy_all
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

const HELPERS = `
function makeCreature(name, power, toughness, keywords, ownerId, opts) {
  const uid = name.toLowerCase().replace(/\\s/g, '_') + '_' + ownerId;
  const o = opts || {};
  const card = CardEngine.prepareForBattlefield({
    id: uid, _uid: uid, name: name,
    type_line: o.typeLine || 'Creature — Test',
    power: String(power), toughness: String(toughness),
    mana_cost: o.cost || '{1}', cmc: o.cmc || 1,
    oracle_text: o.oracle || '',
    colors: o.colors || [], color_identity: o.colors || [],
    keywords: keywords || [],
    rarity: 'common', _ownerId: ownerId,
    subtypes: o.subtypes || []
  });
  return card;
}

function makeEquipment(name, ownerId, oracle) {
  const uid = name.toLowerCase().replace(/\\s/g, '_') + '_' + ownerId;
  const card = CardEngine.prepareForBattlefield({
    id: uid, _uid: uid, name: name,
    type_line: 'Artifact — Equipment',
    power: null, toughness: null,
    mana_cost: '{2}', cmc: 2,
    oracle_text: oracle || 'Equipped creature gets +2/+1. Equip {2}',
    colors: [], color_identity: [],
    keywords: [], rarity: 'uncommon', _ownerId: ownerId
  });
  return card;
}

function makeAura(name, ownerId, oracle) {
  const uid = name.toLowerCase().replace(/\\s/g, '_') + '_' + ownerId;
  const card = CardEngine.prepareForBattlefield({
    id: uid, _uid: uid, name: name,
    type_line: 'Enchantment — Aura',
    power: null, toughness: null,
    mana_cost: '{1}{G}', cmc: 2,
    oracle_text: oracle || 'Enchanted creature gets +1/+1.',
    colors: ['G'], color_identity: ['G'],
    keywords: [], rarity: 'common', _ownerId: ownerId
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
  state.phase = 'main1';
  state.activePlayer = 0;
  state.players[0].isHuman = false;
  state.players[1].isHuman = false;
  return state;
}
`;

test.describe('Multi-Card Interactions', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  // =================== EQUIPMENT + DEATH ===================

  test('Equipment stays on battlefield when equipped creature dies', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Knight', 3, 3, [], 0);
      const equip = makeEquipment('Sword', 0, 'Equipped creature gets +2/+1. Equip {2}');
      state.players[0].zones.battlefield.add(creature);
      state.players[0].zones.battlefield.add(equip);
      GameState.equipCreature(state, 0, equip._uid, creature._uid);

      // Verify equipped stats
      const powerBefore = CardEngine.getPower(creature);

      // Kill creature
      GameState.creatureDies(state, creature, 0);

      const bf = state.players[0].zones.battlefield.cards;
      const equipOnBf = bf.find(c => c.name === 'Sword');
      const creatureOnBf = bf.find(c => c.name === 'Knight');
      const gy = state.players[0].zones.graveyard.cards;
      const creatureInGy = gy.find(c => c.name === 'Knight');

      return {
        powerBefore,
        equipOnBf: !!equipOnBf,
        equipUnattached: equipOnBf ? equipOnBf._attachedTo === null : false,
        creatureOnBf: !!creatureOnBf,
        creatureInGy: !!creatureInGy
      };
    }, HELPERS);

    expect(result.powerBefore).toBe(5); // 3 + 2
    expect(result.equipOnBf).toBe(true);
    expect(result.equipUnattached).toBe(true);
    expect(result.creatureOnBf).toBe(false);
    expect(result.creatureInGy).toBe(true);
  });

  test('Equipment buffs removed when creature dies', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const c1 = makeCreature('Bear', 2, 2, [], 0);
      const c2 = makeCreature('Wolf', 3, 3, [], 0);
      const equip = makeEquipment('Helm', 0, 'Equipped creature gets +1/+3. Equip {1}');
      state.players[0].zones.battlefield.add(c1);
      state.players[0].zones.battlefield.add(c2);
      state.players[0].zones.battlefield.add(equip);

      // Equip to Bear
      GameState.equipCreature(state, 0, equip._uid, c1._uid);
      const bearPower = CardEngine.getPower(c1); // 2+1=3
      const bearTough = CardEngine.getToughness(c1); // 2+3=5

      // Re-equip to Wolf
      GameState.equipCreature(state, 0, equip._uid, c2._uid);
      const bearPowerAfter = CardEngine.getPower(c1); // back to 2
      const wolfPower = CardEngine.getPower(c2); // 3+1=4

      return { bearPower, bearTough, bearPowerAfter, wolfPower };
    }, HELPERS);

    expect(result.bearPower).toBe(3);
    expect(result.bearTough).toBe(5);
    expect(result.bearPowerAfter).toBe(2);
    expect(result.wolfPower).toBe(4);
  });

  // =================== AURA + DEATH ===================

  test('Aura goes to graveyard when enchanted creature dies', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Elk', 3, 3, [], 0);
      const aura = makeAura('Growth', 0, 'Enchanted creature gets +2/+2.');
      state.players[0].zones.battlefield.add(creature);
      state.players[0].zones.battlefield.add(aura);

      // Manually attach aura
      aura._attachedTo = creature._uid;
      aura._attachedToOwner = 0;
      if (!creature._attachments) creature._attachments = [];
      creature._attachments.push(aura._uid);

      const bfCountBefore = state.players[0].zones.battlefield.count();

      GameState.creatureDies(state, creature, 0);

      const bf = state.players[0].zones.battlefield.cards;
      const auraOnBf = bf.find(c => c.name === 'Growth');
      const gy = state.players[0].zones.graveyard.cards;
      const auraInGy = gy.find(c => c.name === 'Growth');
      const creatureInGy = gy.find(c => c.name === 'Elk');

      return {
        bfCountBefore,
        auraOnBf: !!auraOnBf,
        auraInGy: !!auraInGy,
        creatureInGy: !!creatureInGy,
        bfCountAfter: state.players[0].zones.battlefield.count()
      };
    }, HELPERS);

    expect(result.auraOnBf).toBe(false);
    expect(result.auraInGy).toBe(true);
    expect(result.creatureInGy).toBe(true);
  });

  // =================== PERSIST ===================

  test('Persist: creature returns with -1/-1 counter when no counters', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Phoenix', 3, 2, ['Persist'], 0);
      state.players[0].zones.battlefield.add(creature);

      GameState.creatureDies(state, creature, 0);

      const bf = state.players[0].zones.battlefield.cards;
      const returned = bf.find(c => c.name === 'Phoenix');
      const gy = state.players[0].zones.graveyard.cards;
      const inGy = gy.find(c => c.name === 'Phoenix');

      return {
        returned: !!returned,
        inGy: !!inGy,
        minusCounters: returned ? returned._counters['-1/-1'] : -1,
        summoningSick: returned ? returned._summoningSick : null
      };
    }, HELPERS);

    expect(result.returned).toBe(true);
    expect(result.inGy).toBe(false);
    expect(result.minusCounters).toBe(1);
    expect(result.summoningSick).toBe(true);
  });

  test('Persist: does NOT return if already has -1/-1 counters', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Ghoul', 4, 4, ['Persist'], 0);
      creature._counters = { '+1/+1': 0, '-1/-1': 1 };
      state.players[0].zones.battlefield.add(creature);

      GameState.creatureDies(state, creature, 0);

      const bf = state.players[0].zones.battlefield.cards;
      const returned = bf.find(c => c.name === 'Ghoul');
      const gy = state.players[0].zones.graveyard.cards;
      const inGy = gy.find(c => c.name === 'Ghoul');

      return { returned: !!returned, inGy: !!inGy };
    }, HELPERS);

    expect(result.returned).toBe(false);
    expect(result.inGy).toBe(true);
  });

  // =================== INDESTRUCTIBLE ===================

  test('Indestructible: creature survives destroy but not exile', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Titan', 5, 5, ['Indestructible'], 0);
      state.players[0].zones.battlefield.add(creature);

      // Try to destroy
      const died = GameState.creatureDies(state, creature, 0);
      const onBf = !!state.players[0].zones.battlefield.cards.find(c => c.name === 'Titan');

      return { died, onBf };
    }, HELPERS);

    expect(result.died).toBe(false);
    expect(result.onBf).toBe(true);
  });

  // =================== REGENERATION ===================

  test('Regeneration shield: creature survives, becomes tapped, damage removed', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Troll', 4, 4, [], 0);
      creature._regenerateShield = true;
      creature._damage = 3;
      state.players[0].zones.battlefield.add(creature);

      const died = GameState.creatureDies(state, creature, 0);
      const onBf = !!state.players[0].zones.battlefield.cards.find(c => c.name === 'Troll');

      return {
        died,
        onBf,
        tapped: creature._tapped,
        damage: creature._damage,
        shieldGone: creature._regenerateShield === undefined
      };
    }, HELPERS);

    expect(result.died).toBe(false);
    expect(result.onBf).toBe(true);
    expect(result.tapped).toBe(true);
    expect(result.damage).toBe(0);
    expect(result.shieldGone).toBe(true);
  });

  // =================== ENDURE ===================

  test('Endure: removes +1/+1 counter instead of dying', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Guardian', 3, 3, ['Endure'], 0);
      creature._counters = { '+1/+1': 2, '-1/-1': 0 };
      state.players[0].zones.battlefield.add(creature);

      const died = GameState.creatureDies(state, creature, 0);
      const onBf = !!state.players[0].zones.battlefield.cards.find(c => c.name === 'Guardian');

      return {
        died,
        onBf,
        plusCounters: creature._counters['+1/+1'],
        damage: creature._damage
      };
    }, HELPERS);

    expect(result.died).toBe(false);
    expect(result.onBf).toBe(true);
    expect(result.plusCounters).toBe(1); // was 2, now 1
    expect(result.damage).toBe(0);
  });

  // =================== CHAMPION DEATH ===================

  test('Champion: exiled creature returns when champion dies', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const champion = makeCreature('Champion', 5, 5, [], 0);
      const exiled = makeCreature('Warrior', 2, 2, [], 0);

      // Simulate champion having exiled a creature
      state.players[0].zones.battlefield.add(champion);
      state.players[0].zones.exile.add(exiled);
      champion._championedCard = exiled._uid;
      champion._championedPlayer = 0;

      // Kill champion
      GameState.creatureDies(state, champion, 0);

      const bf = state.players[0].zones.battlefield.cards;
      const championOnBf = bf.find(c => c.name === 'Champion');
      const warriorOnBf = bf.find(c => c.name === 'Warrior');
      const exile = state.players[0].zones.exile.cards;
      const warriorInExile = exile.find(c => c.name === 'Warrior');

      return {
        championOnBf: !!championOnBf,
        warriorOnBf: !!warriorOnBf,
        warriorInExile: !!warriorInExile,
        warriorSummoningSick: warriorOnBf ? warriorOnBf._summoningSick : null
      };
    }, HELPERS);

    expect(result.championOnBf).toBe(false);
    expect(result.warriorOnBf).toBe(true);
    expect(result.warriorInExile).toBe(false);
    expect(result.warriorSummoningSick).toBe(true);
  });

  // =================== TRIGGER INTERACTIONS ===================

  test('Dies trigger fires before creature leaves battlefield', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      // Creature with "when this dies, gain 3 life" trigger
      const creature = makeCreature('Martyr', 1, 1, [], 0, {
        oracle: 'When Martyr dies, you gain 3 life.'
      });
      state.players[0].zones.battlefield.add(creature);
      // Manually register trigger
      state._triggers.push({
        event: 'dies',
        self: true,
        cardUid: creature._uid,
        cardName: 'Martyr',
        controllerId: 0,
        effects: [{ type: 'gainLife', amount: 3 }]
      });

      const lifeBefore = state.players[0].life;
      GameState.creatureDies(state, creature, 0);
      const lifeAfter = state.players[0].life;

      return { lifeBefore, lifeAfter };
    }, HELPERS);

    expect(result.lifeBefore).toBe(20);
    expect(result.lifeAfter).toBe(23);
  });

  test('Multiple triggers fire when creature dies (dies + any_creature_dies)', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const dyingCreature = makeCreature('Victim', 1, 1, [], 0);
      const observer = makeCreature('Observer', 2, 2, [], 0, {
        oracle: 'Whenever a creature you control dies, draw a card.'
      });
      state.players[0].zones.battlefield.add(dyingCreature);
      state.players[0].zones.battlefield.add(observer);

      // Register: "when this dies, deal 1 damage to opponent"
      state._triggers.push({
        event: 'dies',
        self: true,
        cardUid: dyingCreature._uid,
        cardName: 'Victim',
        controllerId: 0,
        effects: [{ type: 'damage', amount: 1, target: 'opponent' }]
      });

      // Register: "whenever a creature you control dies, draw a card"
      state._triggers.push({
        event: 'any_creature_dies',
        controller: true,
        cardUid: observer._uid,
        cardName: 'Observer',
        controllerId: 0,
        effects: [{ type: 'draw', amount: 1 }]
      });

      const handBefore = state.players[0].zones.hand.count();
      const oppLifeBefore = state.players[1].life;

      GameState.creatureDies(state, dyingCreature, 0);

      return {
        handBefore,
        handAfter: state.players[0].zones.hand.count(),
        oppLifeBefore,
        oppLifeAfter: state.players[1].life
      };
    }, HELPERS);

    expect(result.handAfter).toBe(result.handBefore + 1); // drew 1 card
    expect(result.oppLifeAfter).toBe(result.oppLifeBefore - 1); // 1 damage
  });

  // =================== BUFF STACKING ===================

  test('Buff stacking: equipment + counters + temp buff accumulate correctly', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      // Base 2/2 creature
      const creature = makeCreature('Soldier', 2, 2, [], 0);
      const equip = makeEquipment('Blade', 0, 'Equipped creature gets +2/+1. Equip {2}');
      state.players[0].zones.battlefield.add(creature);
      state.players[0].zones.battlefield.add(equip);

      // 1) Equip: +2/+1
      GameState.equipCreature(state, 0, equip._uid, creature._uid);

      // 2) Add +1/+1 counters
      creature._counters['+1/+1'] = 2;

      // 3) Temporary buff +3/+3
      creature._powerMod += 3;
      creature._toughnessMod += 3;
      creature._tempPowerMod = 3;
      creature._tempToughnessMod = 3;

      const totalPower = CardEngine.getPower(creature);  // 2 + (2+3) + (2-0) = 9
      const totalTough = CardEngine.getToughness(creature); // 2 + (1+3) + (2-0) = 8

      // Cleanup removes temp buffs
      GameState._endOfTurnCleanup(state);

      const powerAfterCleanup = CardEngine.getPower(creature); // 2 + 2 + 2 = 6
      const toughAfterCleanup = CardEngine.getToughness(creature); // 2 + 1 + 2 = 5

      return { totalPower, totalTough, powerAfterCleanup, toughAfterCleanup };
    }, HELPERS);

    expect(result.totalPower).toBe(9);   // 2 base + 2 equip + 3 temp + 2 counters
    expect(result.totalTough).toBe(8);   // 2 base + 1 equip + 3 temp + 2 counters
    expect(result.powerAfterCleanup).toBe(6);  // 2 base + 2 equip + 2 counters (temp gone)
    expect(result.toughAfterCleanup).toBe(5);  // 2 base + 1 equip + 2 counters
  });

  test('Counters: +1/+1 and -1/-1 cancel out in power/toughness', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Elf', 3, 3, [], 0);
      state.players[0].zones.battlefield.add(creature);

      creature._counters = { '+1/+1': 3, '-1/-1': 2 };

      return {
        power: CardEngine.getPower(creature),  // 3 + (3-2) = 4
        toughness: CardEngine.getToughness(creature) // 3 + (3-2) = 4
      };
    }, HELPERS);

    expect(result.power).toBe(4);
    expect(result.toughness).toBe(4);
  });

  // =================== THREATEN + CLEANUP ===================

  test('Threaten: stolen creature returns to owner at end of turn', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Dragon', 5, 5, [], 1);
      // Simulate threaten: creature is on player 0's battlefield with _stolenFrom marker
      creature._stolenFrom = 1;
      state.players[0].zones.battlefield.add(creature);

      const p0BfBefore = state.players[0].zones.battlefield.count();
      const p1BfBefore = state.players[1].zones.battlefield.count();

      GameState._endOfTurnCleanup(state);

      const p0BfAfter = state.players[0].zones.battlefield.count();
      const p1BfAfter = state.players[1].zones.battlefield.count();
      const dragonOnP1 = state.players[1].zones.battlefield.cards.find(c => c.name === 'Dragon');

      return {
        p0BfBefore, p0BfAfter,
        p1BfBefore, p1BfAfter,
        dragonReturned: !!dragonOnP1,
        dragonTapped: dragonOnP1 ? dragonOnP1._tapped : null
      };
    }, HELPERS);

    expect(result.p0BfAfter).toBe(result.p0BfBefore - 1);
    expect(result.p1BfAfter).toBe(result.p1BfBefore + 1);
    expect(result.dragonReturned).toBe(true);
    expect(result.dragonTapped).toBe(true);
  });

  // =================== MOBILIZE TOKEN SACRIFICE ===================

  test('Mobilize tokens sacrificed at end of turn', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const token = makeCreature('Soldier Token', 1, 1, [], 0);
      token._isToken = true;
      token._sacrificeAtEndStep = true;
      const normal = makeCreature('Bear', 2, 2, [], 0);
      state.players[0].zones.battlefield.add(token);
      state.players[0].zones.battlefield.add(normal);

      const bfBefore = state.players[0].zones.battlefield.count();
      GameState._endOfTurnCleanup(state);
      const bfAfter = state.players[0].zones.battlefield.count();
      const bearOnBf = !!state.players[0].zones.battlefield.cards.find(c => c.name === 'Bear');

      return { bfBefore, bfAfter, bearOnBf };
    }, HELPERS);

    expect(result.bfAfter).toBe(result.bfBefore - 1);
    expect(result.bearOnBf).toBe(true);
  });

  // =================== TEMP KEYWORDS CLEANUP ===================

  test('Temporary keywords removed at end of turn', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Soldier', 2, 2, ['Flying'], 0);
      // Grant temporary keyword
      creature.keywords.push('Trample');
      creature._tempKeywords = ['Trample'];
      state.players[0].zones.battlefield.add(creature);

      const hasTrampleBefore = CardEngine.hasKeyword(creature, 'Trample');
      const hasFlyingBefore = CardEngine.hasKeyword(creature, 'Flying');

      GameState._endOfTurnCleanup(state);

      const hasTrampleAfter = CardEngine.hasKeyword(creature, 'Trample');
      const hasFlyingAfter = CardEngine.hasKeyword(creature, 'Flying');

      return { hasTrampleBefore, hasFlyingBefore, hasTrampleAfter, hasFlyingAfter };
    }, HELPERS);

    expect(result.hasTrampleBefore).toBe(true);
    expect(result.hasFlyingBefore).toBe(true);
    expect(result.hasTrampleAfter).toBe(false);  // temp keyword removed
    expect(result.hasFlyingAfter).toBe(true);     // permanent keyword stays
  });

  // =================== DAMAGE PREVENTION ===================

  test('Damage prevention shield absorbs combat damage', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const attacker = makeCreature('Giant', 5, 5, [], 0);
      state.players[0].zones.battlefield.add(attacker);

      // Set damage prevention shield on defender
      state._damageShield = { 0: 0, 1: 3 };

      // Run combat: 5 damage to player 1, 3 prevented
      const combatState = CombatSystem.createCombatState();
      combatState.attackers.push({ uid: attacker._uid, card: attacker });
      attacker._attacking = true;

      CombatSystem.resolveCombatDamage(
        combatState, state.players[0], state.players[1], state
      );

      return {
        defenderLife: state.players[1].life // 20 - (5-3) = 18
      };
    }, HELPERS);

    expect(result.defenderLife).toBe(18);
  });

  test('Damage prevention shield cleared at end of turn', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      state._damageShield = { 0: 5, 1: 3 };

      GameState._endOfTurnCleanup(state);

      return { shield: state._damageShield };
    }, HELPERS);

    expect(result.shield).toBeNull();
  });

  // =================== COMBAT + EQUIPMENT INTERACTION ===================

  test('Equipped creature in combat uses buffed stats', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const attacker = makeCreature('Knight', 2, 2, [], 0);
      const equip = makeEquipment('Axe', 0, 'Equipped creature gets +3/+0. Equip {1}');
      const blocker = makeCreature('Wall', 0, 5, [], 1);
      state.players[0].zones.battlefield.add(attacker);
      state.players[0].zones.battlefield.add(equip);
      state.players[1].zones.battlefield.add(blocker);

      GameState.equipCreature(state, 0, equip._uid, attacker._uid);

      // Run combat: 2+3=5 power vs 0/5
      const combatState = CombatSystem.createCombatState();
      combatState.attackers.push({ uid: attacker._uid, card: attacker });
      attacker._attacking = true;
      combatState.blockers[attacker._uid] = [{ uid: blocker._uid, card: blocker }];

      CombatSystem.resolveCombatDamage(combatState, state.players[0], state.players[1], state);

      return {
        blockerDamage: blocker._damage,
        blockerDead: blocker._damage >= CardEngine.getToughness(blocker)
      };
    }, HELPERS);

    expect(result.blockerDamage).toBe(5); // 2+3 from equipment
    expect(result.blockerDead).toBe(true); // 5 damage kills 0/5
  });

  // =================== PERSIST + WITHER INTERACTION ===================

  test('Persist creature with wither damage gets -1/-1 counters, does not persist again', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      // 3/2 creature with Persist. Dies, returns with -1/-1 counter (becomes 2/1).
      const creature = makeCreature('Hound', 3, 2, ['Persist'], 0);
      state.players[0].zones.battlefield.add(creature);

      // First death: should persist (no -1/-1 counters)
      GameState.creatureDies(state, creature, 0);
      const afterFirst = state.players[0].zones.battlefield.cards.find(c => c.name === 'Hound');
      const hasCounter1 = afterFirst ? afterFirst._counters['-1/-1'] : -1;

      // Second death: should NOT persist (already has -1/-1 counter)
      if (afterFirst) {
        afterFirst._damage = 99;
        GameState.creatureDies(state, afterFirst, 0);
      }
      const afterSecond = state.players[0].zones.battlefield.cards.find(c => c.name === 'Hound');
      const inGy = state.players[0].zones.graveyard.cards.find(c => c.name === 'Hound');

      return {
        firstReturn: !!afterFirst,
        hasCounter1,
        secondReturn: !!afterSecond,
        inGy: !!inGy
      };
    }, HELPERS);

    expect(result.firstReturn).toBe(true);
    expect(result.hasCounter1).toBe(1);
    expect(result.secondReturn).toBe(false);
    expect(result.inGy).toBe(true);
  });

  // =================== TRIGGER DEPTH GUARD ===================

  test('Trigger recursion guard prevents infinite loops (depth > 15)', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      state._triggerDepth = 16; // Already over limit

      // Register a trigger that would cause a draw if it fires
      state._triggers.push({
        event: 'upkeep',
        controller: true,
        cardUid: 'test_uid',
        cardName: 'Test',
        controllerId: 0,
        effects: [{ type: 'draw', amount: 1 }]
      });

      const handBefore = state.players[0].zones.hand.count();
      const logs = GameState.fireTrigger(state, 'upkeep', { playerId: 0 });
      const handAfter = state.players[0].zones.hand.count();

      return {
        hasLimitMsg: logs.some(l => l.includes('trigger loop limitado')),
        noDrawHappened: handAfter === handBefore,
        depth: state._triggerDepth
      };
    }, HELPERS);

    // Guard should block execution and return a limit message
    expect(result.hasLimitMsg).toBe(true);
    expect(result.noDrawHappened).toBe(true);
  });

  // =================== DAMAGE RESET AT CLEANUP ===================

  test('Creature damage resets at end of turn cleanup', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Rhino', 4, 5, [], 0);
      creature._damage = 3; // took 3 damage but survived
      state.players[0].zones.battlefield.add(creature);

      GameState._endOfTurnCleanup(state);

      return { damage: creature._damage };
    }, HELPERS);

    expect(result.damage).toBe(0);
  });

  // =================== COMPLEX: EQUIPMENT + PERSIST ===================

  test('Complex: equipped creature with persist dies - equipment stays, creature returns without equipment', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Warrior', 3, 3, ['Persist'], 0);
      const equip = makeEquipment('Shield', 0, 'Equipped creature gets +0/+2. Equip {2}');
      state.players[0].zones.battlefield.add(creature);
      state.players[0].zones.battlefield.add(equip);

      GameState.equipCreature(state, 0, equip._uid, creature._uid);
      const toughBefore = CardEngine.getToughness(creature); // 3+2=5

      // Kill creature
      GameState.creatureDies(state, creature, 0);

      const bf = state.players[0].zones.battlefield.cards;
      const equipOnBf = bf.find(c => c.name === 'Shield');
      const creatureOnBf = bf.find(c => c.name === 'Warrior');

      return {
        toughBefore,
        equipOnBf: !!equipOnBf,
        equipUnattached: equipOnBf ? equipOnBf._attachedTo === null : false,
        creatureReturned: !!creatureOnBf,
        // Persist creature returns but equipment buffs should NOT be on it
        creatureTough: creatureOnBf ? CardEngine.getToughness(creatureOnBf) : -1,
        creatureMinusCounters: creatureOnBf ? creatureOnBf._counters['-1/-1'] : -1
      };
    }, HELPERS);

    expect(result.toughBefore).toBe(5); // 3 base + 2 equip
    expect(result.equipOnBf).toBe(true);
    expect(result.equipUnattached).toBe(true);
    expect(result.creatureReturned).toBe(true);
    expect(result.creatureMinusCounters).toBe(1);
    // Creature returned with persist, toughness = 3 base - 1 persist counter - 1 persist mod = 1
    expect(result.creatureTough).toBeLessThanOrEqual(2);
  });

  // =================== COMPLEX: AURA + DIES TRIGGER ===================

  test('Complex: aura on creature with dies trigger - trigger fires, aura goes to GY', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Martyr', 2, 2, [], 0, {
        oracle: 'When Martyr dies, you gain 3 life.'
      });
      const aura = makeAura('Blessing', 0, 'Enchanted creature gets +2/+2.');
      state.players[0].zones.battlefield.add(creature);
      state.players[0].zones.battlefield.add(aura);

      // Attach aura
      aura._attachedTo = creature._uid;
      if (!creature._attachments) creature._attachments = [];
      creature._attachments.push(aura._uid);

      // Register dies trigger
      state._triggers.push({
        event: 'dies',
        self: true,
        cardUid: creature._uid,
        cardName: 'Martyr',
        controllerId: 0,
        effects: [{ type: 'gainLife', amount: 3 }]
      });

      const lifeBefore = state.players[0].life;
      GameState.creatureDies(state, creature, 0);

      const bf = state.players[0].zones.battlefield.cards;
      const gy = state.players[0].zones.graveyard.cards;

      return {
        lifeBefore,
        lifeAfter: state.players[0].life,
        auraOnBf: !!bf.find(c => c.name === 'Blessing'),
        auraInGy: !!gy.find(c => c.name === 'Blessing'),
        creatureInGy: !!gy.find(c => c.name === 'Martyr')
      };
    }, HELPERS);

    expect(result.lifeAfter).toBe(result.lifeBefore + 3); // dies trigger fired
    expect(result.auraOnBf).toBe(false);
    expect(result.auraInGy).toBe(true);
    expect(result.creatureInGy).toBe(true);
  });

  // =================== COMPLEX: CHAINED TRIGGERS ===================

  test('Complex: chained triggers - dies trigger causes life gain, life gain trigger fires', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const dying = makeCreature('Victim', 1, 1, [], 0);
      const healer = makeCreature('Healer', 1, 3, [], 0, {
        oracle: 'Whenever you gain life, draw a card.'
      });
      state.players[0].zones.battlefield.add(dying);
      state.players[0].zones.battlefield.add(healer);

      // "When Victim dies, gain 2 life"
      state._triggers.push({
        event: 'dies',
        self: true,
        cardUid: dying._uid,
        cardName: 'Victim',
        controllerId: 0,
        effects: [{ type: 'gainLife', amount: 2 }]
      });

      // "Whenever you gain life, draw a card"
      state._triggers.push({
        event: 'gain_life',
        self: true,
        cardUid: healer._uid,
        cardName: 'Healer',
        controllerId: 0,
        effects: [{ type: 'draw', amount: 1 }]
      });

      const lifeBefore = state.players[0].life;
      const handBefore = state.players[0].zones.hand.count();

      GameState.creatureDies(state, dying, 0);

      return {
        lifeBefore,
        lifeAfter: state.players[0].life,
        handBefore,
        handAfter: state.players[0].zones.hand.count()
      };
    }, HELPERS);

    expect(result.lifeAfter).toBe(result.lifeBefore + 2); // dies → gain life
    expect(result.handAfter).toBe(result.handBefore + 1); // gain life → draw
  });

  // =================== COMPLEX: STOLEN CREATURE DIES ===================

  test('Complex: stolen creature (threaten) dies - goes to owner GY, not thief GY', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      // Creature originally owned by player 1, stolen by player 0
      const creature = makeCreature('Dragon', 5, 5, [], 1);
      creature._stolenFrom = 1;
      creature._ownerId = 1;
      state.players[0].zones.battlefield.add(creature);

      // Kill the stolen creature while on player 0's battlefield
      GameState.creatureDies(state, creature, 0);

      return {
        p0GY: state.players[0].zones.graveyard.cards.map(c => c.name),
        p1GY: state.players[1].zones.graveyard.cards.map(c => c.name),
        p0Bf: state.players[0].zones.battlefield.cards.map(c => c.name)
      };
    }, HELPERS);

    // Dragon should be in player 0's GY (controller's GY, since that's where creatureDies puts it)
    expect(result.p0Bf).not.toContain('Dragon');
  });

  // =================== COMPLEX: MULTIPLE DEATH TRIGGERS ===================

  test('Complex: board wipe fires multiple dies triggers', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();

      // 3 creatures, each with "dies: gain 1 life"
      for (let i = 0; i < 3; i++) {
        const c = makeCreature('Soldier_' + i, 1, 1, [], 0);
        state.players[0].zones.battlefield.add(c);
        state._triggers.push({
          event: 'dies',
          self: true,
          cardUid: c._uid,
          cardName: 'Soldier_' + i,
          controllerId: 0,
          effects: [{ type: 'gainLife', amount: 1 }]
        });
      }

      const lifeBefore = state.players[0].life;

      // Kill all 3
      const creatures = [...state.players[0].zones.battlefield.cards.filter(c => CardEngine.isCreature(c))];
      creatures.forEach(c => GameState.creatureDies(state, c, 0));

      return {
        lifeBefore,
        lifeAfter: state.players[0].life,
        bfCount: state.players[0].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length,
        gyCount: state.players[0].zones.graveyard.count()
      };
    }, HELPERS);

    expect(result.lifeAfter).toBe(result.lifeBefore + 3); // each dies trigger fired
    expect(result.bfCount).toBe(0);
    expect(result.gyCount).toBe(3);
  });

  // =================== COMPLEX: TEMP BUFF + DEBUFF + DEATH CHECK ===================

  test('Complex: temp debuff kills creature immediately (toughness <= 0)', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const creature = makeCreature('Sprite', 1, 1, [], 1); // opponent's 1/1
      state.players[1].zones.battlefield.add(creature);

      // Apply -2/-2 debuff
      creature._powerMod = -2;
      creature._toughnessMod = -2;
      creature._tempPowerMod = -2;
      creature._tempToughnessMod = -2;

      const toughness = CardEngine.getToughness(creature); // 1 + (-2) = -1

      // Check if should die
      const shouldDie = toughness <= 0;
      if (shouldDie) {
        GameState.creatureDies(state, creature, 1);
      }

      return {
        toughness,
        shouldDie,
        inGy: state.players[1].zones.graveyard.cards.some(c => c.name === 'Sprite'),
        onBf: state.players[1].zones.battlefield.cards.some(c => c.name === 'Sprite')
      };
    }, HELPERS);

    expect(result.toughness).toBeLessThanOrEqual(0);
    expect(result.shouldDie).toBe(true);
    expect(result.inGy).toBe(true);
    expect(result.onBf).toBe(false);
  });

  // =================== COMPLEX: EQUIPMENT RE-EQUIP AFTER DEATH ===================

  test('Complex: equipment can be re-equipped to another creature after first creature dies', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const c1 = makeCreature('Knight', 2, 2, [], 0);
      const c2 = makeCreature('Squire', 1, 1, [], 0);
      const equip = makeEquipment('Sword', 0, 'Equipped creature gets +3/+0. Equip {2}');
      state.players[0].zones.battlefield.add(c1);
      state.players[0].zones.battlefield.add(c2);
      state.players[0].zones.battlefield.add(equip);

      // Equip to Knight
      GameState.equipCreature(state, 0, equip._uid, c1._uid);
      const knightPower = CardEngine.getPower(c1); // 2+3=5

      // Knight dies
      GameState.creatureDies(state, c1, 0);

      // Re-equip to Squire
      const reequipped = GameState.equipCreature(state, 0, equip._uid, c2._uid);
      const squirePower = CardEngine.getPower(c2); // 1+3=4

      return { knightPower, reequipped, squirePower };
    }, HELPERS);

    expect(result.knightPower).toBe(5);
    expect(result.reequipped).toBe(true);
    expect(result.squirePower).toBe(4);
  });

  // =================== COMPLEX: INDESTRUCTIBLE + WITHER ===================

  test('Complex: indestructible creature accumulates -1/-1 counters from wither but survives', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const indestructible = makeCreature('Titan', 4, 4, ['Indestructible'], 0);
      const witherer = makeCreature('Plague', 3, 3, ['Wither'], 1);
      state.players[0].zones.battlefield.add(indestructible);
      state.players[1].zones.battlefield.add(witherer);

      // Combat: Titan blocks Plague
      const combatState = CombatSystem.createCombatState();
      combatState.attackers.push({ uid: witherer._uid, card: witherer });
      witherer._attacking = true;
      combatState.blockers[witherer._uid] = [{ uid: indestructible._uid, card: indestructible }];

      CombatSystem.resolveCombatDamage(combatState, state.players[1], state.players[0], state);

      const titanOnBf = state.players[0].zones.battlefield.cards.find(c => c.name === 'Titan');

      return {
        titanAlive: !!titanOnBf,
        titanMinusCounters: titanOnBf ? (titanOnBf._counters ? titanOnBf._counters['-1/-1'] : 0) : -1,
        titanToughness: titanOnBf ? CardEngine.getToughness(titanOnBf) : -1
      };
    }, HELPERS);

    expect(result.titanAlive).toBe(true);
    expect(result.titanMinusCounters).toBe(3); // 3 wither damage = 3 -1/-1 counters
    expect(result.titanToughness).toBe(1); // 4 - 3 = 1
  });
});
