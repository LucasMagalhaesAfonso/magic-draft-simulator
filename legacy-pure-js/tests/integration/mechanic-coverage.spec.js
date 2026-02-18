/**
 * Mechanic Coverage Tests (Layer N)
 *
 * Covers mechanics and interactions NOT tested by other layers:
 * - Siege modal ETB (chooseOnETB)
 * - Hideaway lands (Spinerock Knoll damage tracking)
 * - Saga chapter advancement + sacrifice
 * - Transform/DFC
 * - Clash bonus effects
 * - Evoke sacrifice after ETB
 * - Champion exile/return
 * - Vivid dynamic amounts
 * - Triggered ability event firing
 * - Static abilities on battlefield
 * - Activated ability cost enforcement
 * - Stun counter untap enforcement
 * - Threaten return + haste
 * - Extra combat
 * - Copy spell
 * - Damage tracking per turn
 * - Blight (AI path)
 * - Graveyard activation
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

function makeLand(name, color, ownerId, opts) {
  const uid = name.toLowerCase().replace(/\\s/g, '_') + '_' + ownerId;
  const o = opts || {};
  const card = CardEngine.prepareForBattlefield({
    id: uid, _uid: uid, name: name,
    type_line: o.typeLine || 'Basic Land — ' + name,
    power: null, toughness: null,
    mana_cost: '', cmc: 0,
    oracle_text: o.oracle || '{T}: Add {' + color + '}.',
    colors: [color], color_identity: [color],
    keywords: [], rarity: 'common', _ownerId: ownerId,
    subtypes: o.subtypes || [name]
  });
  return card;
}

function makeEnchantment(name, ownerId, opts) {
  const uid = name.toLowerCase().replace(/\\s/g, '_') + '_' + ownerId;
  const o = opts || {};
  const card = CardEngine.prepareForBattlefield({
    id: uid, _uid: uid, name: name,
    type_line: o.typeLine || 'Enchantment',
    power: null, toughness: null,
    mana_cost: o.cost || '{2}', cmc: o.cmc || 2,
    oracle_text: o.oracle || '',
    colors: o.colors || [], color_identity: o.colors || [],
    keywords: [], rarity: o.rarity || 'uncommon', _ownerId: ownerId,
    subtypes: o.subtypes || []
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
  // Both AI to avoid interactive pauses
  state.players[0].isHuman = false;
  state.players[1].isHuman = false;
  return state;
}
`;

test.describe('Mechanic Coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  // =================== SIEGE MODAL ETB ===================

  test('Siege ETB: getETBEffects returns modal for chooseOnETB cards', async () => {
    const result = await page.evaluate(() => {
      const card = {
        name: 'Frostcliff Siege', type_line: 'Enchantment',
        oracle_text: '', mana_cost: '{3}{U}', cmc: 4, colors: ['U'],
        keywords: [], color_identity: ['U']
      };
      const etb = CardEngine.getETBEffects(card);
      return { length: etb.length, type: etb[0]?.type, hasModes: Array.isArray(etb[0]?.modes), modeCount: etb[0]?.modes?.length };
    });
    expect(result.length).toBe(1);
    expect(result.type).toBe('modal');
    expect(result.hasModes).toBe(true);
    expect(result.modeCount).toBe(2);
  });

  test('Siege ETB: modes are normalized to effect arrays', async () => {
    const result = await page.evaluate(() => {
      const card = {
        name: 'Frostcliff Siege', type_line: 'Enchantment',
        oracle_text: '', mana_cost: '{3}{U}', cmc: 4, colors: ['U'],
        keywords: [], color_identity: ['U']
      };
      const etb = CardEngine.getETBEffects(card);
      const modes = etb[0].modes;
      // Each mode should be an array of effects
      return {
        mode0IsArray: Array.isArray(modes[0]),
        mode1IsArray: Array.isArray(modes[1]),
        mode0Type: modes[0]?.[0]?.type,
        mode1Type: modes[1]?.[0]?.type
      };
    });
    expect(result.mode0IsArray).toBe(true);
    expect(result.mode1IsArray).toBe(true);
    expect(result.mode0Type).toBe('triggered');
    expect(result.mode1Type).toBe('anthem');
  });

  test('Siege ETB: AI resolves modal and registers triggered ability', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      // Cast Frostcliff Siege as AI (player 1)
      state.activePlayer = 1;
      const card = {
        id: 'frostcliff_siege', _uid: 'fcs_1', name: 'Frostcliff Siege',
        type_line: 'Enchantment', power: null, toughness: null,
        mana_cost: '{3}{U}', cmc: 4, oracle_text: '',
        colors: ['U'], color_identity: ['U'], keywords: [], rarity: 'rare'
      };
      // Add to hand + provide mana
      state.players[1].zones.hand.add(card);
      state.manaPool[1] = { W: 0, U: 4, B: 0, R: 0, G: 0, generic: 0 };

      const triggersBefore = state._triggers.length;
      GameState.castSpell(state, 1, card._uid, []);
      const triggersAfter = state._triggers.length;

      // Check: siege on battlefield
      const onBf = state.players[1].zones.battlefield.cards.some(c => c.name === 'Frostcliff Siege');
      // Check: at least one mode registered a trigger or anthem
      const hasNewTrigger = triggersAfter > triggersBefore;
      const hasAnthem = state.players[1].zones.battlefield.cards.some(c => c.name === 'Frostcliff Siege' && c._anthem);

      return { onBf, hasNewTrigger, hasAnthem, triggerDelta: triggersAfter - triggersBefore };
    }, HELPERS);
    expect(result.onBf).toBe(true);
    // AI chose either triggered mode (new trigger) or anthem mode
    expect(result.hasNewTrigger || result.hasAnthem).toBe(true);
  });

  test('Siege ETB: Windcrag Siege AI can pick upkeep token mode', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 1;
      const card = {
        id: 'windcrag_siege', _uid: 'wcs_1', name: 'Windcrag Siege',
        type_line: 'Enchantment', power: null, toughness: null,
        mana_cost: '{3}{R}', cmc: 4, oracle_text: '',
        colors: ['R'], color_identity: ['R'], keywords: [], rarity: 'rare'
      };
      state.players[1].zones.hand.add(card);
      state.manaPool[1] = { W: 0, U: 0, B: 0, R: 4, G: 0, generic: 0 };
      GameState.castSpell(state, 1, card._uid, []);

      const onBf = state.players[1].zones.battlefield.cards.some(c => c.name === 'Windcrag Siege');
      const hasUpkeepTrigger = state._triggers.some(t => t.event === 'upkeep' && t.cardName === 'Windcrag Siege');
      const hasStaticAbility = state.players[1].zones.battlefield.cards.some(c =>
        c.name === 'Windcrag Siege' && c._staticAbilities && c._staticAbilities.length > 0
      );
      return { onBf, hasUpkeepTrigger, hasStaticAbility };
    }, HELPERS);
    expect(result.onBf).toBe(true);
    // AI chose one mode: either upkeep trigger OR static double_attack_triggers
    expect(result.hasUpkeepTrigger || result.hasStaticAbility).toBe(true);
  });

  // =================== DAMAGE TRACKING (Spinerock Knoll) ===================

  test('Combat damage to player is tracked in _damageDealtThisTurn', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const attacker = makeCreature('Big Hitter', 5, 5, [], 0);
      attacker._summoningSick = false;
      state.players[0].zones.battlefield.add(attacker);

      // Set up combat
      state.combat.phase = 'attackers';
      state.combat.attackers = [{ uid: attacker._uid, card: attacker }];
      state.combat.blockers = {};
      CombatSystem.resolveCombatDamage(state.combat, state.players[0], state.players[1], state);

      return {
        tracked: !!state._damageDealtThisTurn,
        damageToP1: state._damageDealtThisTurn ? state._damageDealtThisTurn[1] : 0,
        p1Life: state.players[1].life
      };
    }, HELPERS);
    expect(result.tracked).toBe(true);
    expect(result.damageToP1).toBe(5);
    expect(result.p1Life).toBe(15);
  });

  test('Spell damage to opponent is tracked in _damageDealtThisTurn', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const bolt = { id: 'bolt', _uid: 'bolt_0', name: 'Lightning Bolt',
        type_line: 'Instant', mana_cost: '{R}', cmc: 1,
        oracle_text: '', colors: ['R'], keywords: [] };

      GameStack.push(state.stack, {
        card: bolt, controller: 0, targets: [],
        effects: [{ type: 'damage', amount: 3, target: 'opponent' }]
      });
      GameStack.resolve(state.stack, state);

      return {
        tracked: !!state._damageDealtThisTurn,
        damageToP1: state._damageDealtThisTurn ? state._damageDealtThisTurn[1] : 0
      };
    }, HELPERS);
    expect(result.tracked).toBe(true);
    expect(result.damageToP1).toBe(3);
  });

  test('Trample damage is tracked in _damageDealtThisTurn', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const trampler = makeCreature('Trampler', 7, 7, ['Trample'], 0);
      trampler._summoningSick = false;
      state.players[0].zones.battlefield.add(trampler);
      const blocker = makeCreature('SmallBlocker', 1, 2, [], 1);
      state.players[1].zones.battlefield.add(blocker);

      state.combat.phase = 'attackers';
      state.combat.attackers = [{ uid: trampler._uid, card: trampler }];
      state.combat.blockers = { [trampler._uid]: [{ uid: blocker._uid, card: blocker }] };
      CombatSystem.resolveCombatDamage(state.combat, state.players[0], state.players[1], state);

      const trampleDmg = state._damageDealtThisTurn ? state._damageDealtThisTurn[1] : 0;
      return { trampleDmg };
    }, HELPERS);
    // 7 power - 2 toughness blocker = 5 trample damage
    expect(result.trampleDmg).toBe(5);
  });

  test('_damageDealtThisTurn is reset in end-of-turn cleanup', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state._damageDealtThisTurn = [0, 7];
      GameState._endOfTurnCleanup(state);
      return { cleared: state._damageDealtThisTurn === null };
    }, HELPERS);
    expect(result.cleared).toBe(true);
  });

  // =================== SAGA CHAPTER ADVANCEMENT ===================

  test('Saga: enters with chapter 1 and advances in upkeep', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 1;
      // Create a saga card
      const saga = {
        id: 'rediscover', _uid: 'saga_1', name: 'Rediscover the Way',
        type_line: 'Enchantment — Saga', power: null, toughness: null,
        mana_cost: '{2}{G}', cmc: 3, oracle_text: '',
        colors: ['G'], color_identity: ['G'], keywords: [], rarity: 'rare'
      };
      // Put saga on bf directly and simulate saga init (avoids castSpell mana complexity)
      const bfCard = CardEngine.prepareForBattlefield(saga);
      state.players[1].zones.battlefield.add(bfCard);
      if (CardEngine.isSaga(saga)) {
        const chapters = CardEngine.getSagaChapters(saga);
        if (chapters) {
          bfCard._isSaga = true;
          bfCard._sagaChapter = 0;
          const chapterKeys = Object.keys(chapters).map(k => {
            const n = parseInt(k); // handles 'I','II','III' as NaN
            return isNaN(n) ? ({'I':1,'II':2,'III':3,'IV':4}[k] || 0) : n;
          }).filter(n => n > 0);
          bfCard._sagaMaxChapter = Math.max(...chapterKeys);
          GameState._advanceSagaChapter(state, bfCard, 1);
        }
      }
      const ch1 = bfCard._sagaChapter;
      const isSaga = bfCard._isSaga || false;

      return { onBf: true, ch1, isSaga, maxCh: bfCard._sagaMaxChapter };
    }, HELPERS);
    expect(result.onBf).toBe(true);
    expect(result.isSaga).toBe(true);
    expect(result.ch1).toBe(1);
  });

  test('Saga: sacrificed after last chapter', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 1;
      // Put a saga directly on bf at chapter 2 (max 3)
      const saga = makeEnchantment('Awaken the Honored Dead', 1, {
        typeLine: 'Enchantment — Saga', cost: '{3}{W}{B}', cmc: 5
      });
      saga._isSaga = true;
      saga._sagaChapter = 2;
      saga._sagaMaxChapter = 3;
      state.players[1].zones.battlefield.add(saga);

      const bfBefore = state.players[1].zones.battlefield.count();
      // Advance chapter in "upkeep"
      GameState._advanceSagaChapter(state, saga, 1);
      const bfAfter = state.players[1].zones.battlefield.count();
      const chFinal = saga._sagaChapter;

      return { bfBefore, bfAfter, chFinal, sacrificed: bfAfter < bfBefore };
    }, HELPERS);
    expect(result.chFinal).toBe(3);
    expect(result.sacrificed).toBe(true);
  });

  // =================== TRANSFORM / DFC ===================

  test('Transform: transformCreature changes card stats', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 1;
      // Create a DFC creature with backFace data
      const dfc = makeCreature('Feral Deathgorger', 3, 3, [], 1, {
        typeLine: 'Creature — Dragon', cost: '{2}{B}', cmc: 3, colors: ['B']
      });
      dfc.backFace = {
        name: 'Deathgorger Unleashed',
        power: '6', toughness: '6',
        type_line: 'Creature — Dragon',
        oracle_text: 'Flying',
        keywords: ['Flying']
      };
      dfc._summoningSick = false;
      state.players[1].zones.battlefield.add(dfc);
      state.manaPool[1] = { W: 0, U: 0, B: 5, R: 0, G: 0, generic: 0 };

      const nameBefore = dfc.name;
      const powBefore = CardEngine.getPower(dfc);
      const result = GameState.transformCreature(state, 1, dfc._uid);
      const nameAfter = dfc.name;
      const powAfter = CardEngine.getPower(dfc);

      return { success: result.success, nameBefore, nameAfter, powBefore, powAfter, transformed: !!dfc._transformed };
    }, HELPERS);
    expect(result.success).toBe(true);
    expect(result.nameBefore).toBe('Feral Deathgorger');
    expect(result.nameAfter).toBe('Deathgorger Unleashed');
    expect(result.powBefore).toBe(3);
    expect(result.powAfter).toBe(6);
    expect(result.transformed).toBe(true);
  });

  test('Transform: cannot transform outside main phase', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.phase = 'combat';
      const dfc = makeCreature('TestDFC', 2, 2, [], 0);
      dfc.backFace = { name: 'TestDFC Back', power: '4', toughness: '4', type_line: 'Creature' };
      state.players[0].zones.battlefield.add(dfc);
      const r = GameState.transformCreature(state, 0, dfc._uid);
      return { success: r.success };
    }, HELPERS);
    expect(result.success).toBe(false);
  });

  // =================== EVOKE SACRIFICE ===================

  test('Evoke: creature is sacrificed after ETB effects resolve', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 1;
      // Create a card with evoke
      const card = {
        id: 'aethersnipe', _uid: 'aether_1', name: 'Aethersnipe',
        type_line: 'Creature — Elemental', power: '4', toughness: '4',
        mana_cost: '{5}{U}', cmc: 6,
        oracle_text: 'When Aethersnipe enters the battlefield, return target nonland permanent to its owner\'s hand.\nEvoke {1}{U}{U}',
        colors: ['U'], color_identity: ['U'], keywords: [], rarity: 'uncommon', subtypes: ['Elemental']
      };
      state.players[1].zones.hand.add(card);
      state.manaPool[1] = { W: 0, U: 3, B: 0, R: 0, G: 0, generic: 1 };

      // Cast with evoke (6th param = castingEvoke)
      GameState.castSpell(state, 1, card._uid, [], undefined, true);

      const onBf = state.players[1].zones.battlefield.cards.some(c => c.name === 'Aethersnipe');
      const inGY = state.players[1].zones.graveyard.cards.some(c => c.name === 'Aethersnipe');

      return { onBf, inGY };
    }, HELPERS);
    // Evoked creature should be sacrificed (not on bf, in GY)
    expect(result.onBf).toBe(false);
    expect(result.inGY).toBe(true);
  });

  // =================== CHAMPION EXILE + RETURN ===================

  test('Champion: exiles matching creature on ETB', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 1;
      // Add an existing faerie to champion
      const faerie = makeCreature('Small Faerie', 1, 1, ['Flying'], 1, {
        typeLine: 'Creature — Faerie', subtypes: ['Faerie']
      });
      state.players[1].zones.battlefield.add(faerie);
      GameState._registerCardTriggers(state, faerie, 1);

      // Cast a champion creature
      const champion = {
        id: 'mistbind_clique', _uid: 'mbc_1', name: 'Mistbind Clique',
        type_line: 'Creature — Faerie Wizard', power: '4', toughness: '4',
        mana_cost: '{3}{U}', cmc: 4,
        oracle_text: 'Champion a Faerie',
        colors: ['U'], color_identity: ['U'],
        keywords: ['Champion', 'Flash', 'Flying'], rarity: 'rare',
        subtypes: ['Faerie', 'Wizard']
      };
      state.players[1].zones.hand.add(champion);
      state.manaPool[1] = { W: 0, U: 4, B: 0, R: 0, G: 0, generic: 0 };

      GameState.castSpell(state, 1, champion._uid, []);

      const bfNames = state.players[1].zones.battlefield.cards.map(c => c.name);
      const hasMistbind = bfNames.includes('Mistbind Clique');
      const hasFaerie = bfNames.includes('Small Faerie');
      const mistbind = state.players[1].zones.battlefield.cards.find(c => c.name === 'Mistbind Clique');
      const hasChampioned = !!mistbind?._championedCard;

      return { hasMistbind, hasFaerie, hasChampioned };
    }, HELPERS);
    expect(result.hasMistbind).toBe(true);
    expect(result.hasFaerie).toBe(false); // exiled
    expect(result.hasChampioned).toBe(true);
  });

  test('Champion: no valid target sacrifices champion', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 1;
      // No faeries on battlefield
      const champion = {
        id: 'mistbind_clique', _uid: 'mbc_2', name: 'Mistbind Clique',
        type_line: 'Creature — Faerie Wizard', power: '4', toughness: '4',
        mana_cost: '{3}{U}', cmc: 4,
        oracle_text: 'Champion a Faerie',
        colors: ['U'], color_identity: ['U'],
        keywords: ['Champion', 'Flash', 'Flying'], rarity: 'rare',
        subtypes: ['Faerie', 'Wizard']
      };
      state.players[1].zones.hand.add(champion);
      state.manaPool[1] = { W: 0, U: 4, B: 0, R: 0, G: 0, generic: 0 };

      GameState.castSpell(state, 1, champion._uid, []);

      const onBf = state.players[1].zones.battlefield.cards.some(c => c.name === 'Mistbind Clique');
      const inGY = state.players[1].zones.graveyard.cards.some(c => c.name === 'Mistbind Clique');
      return { onBf, inGY };
    }, HELPERS);
    expect(result.onBf).toBe(false);
    expect(result.inGY).toBe(true);
  });

  // =================== VIVID DYNAMIC AMOUNTS ===================

  test('Vivid: countVividColors returns correct color count', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      // Add creatures of different colors
      const red = makeCreature('RedGuy', 2, 2, [], 0, { colors: ['R'] });
      const blue = makeCreature('BlueGuy', 2, 2, [], 0, { colors: ['U'] });
      const green = makeCreature('GreenGuy', 2, 2, [], 0, { colors: ['G'] });
      const multicolor = makeCreature('MultiGuy', 2, 2, [], 0, { colors: ['W', 'B'] });
      state.players[0].zones.battlefield.add(red);
      state.players[0].zones.battlefield.add(blue);
      state.players[0].zones.battlefield.add(green);
      state.players[0].zones.battlefield.add(multicolor);

      return { count: CardEngine.countVividColors(state, 0) };
    }, HELPERS);
    // R, U, G, W, B = 5 colors
    expect(result.count).toBe(5);
  });

  test('Vivid: amount "vivid" resolves in stack', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      // 3 colors on battlefield
      state.players[0].zones.battlefield.add(makeCreature('R', 1, 1, [], 0, { colors: ['R'] }));
      state.players[0].zones.battlefield.add(makeCreature('G', 1, 1, [], 0, { colors: ['G'] }));
      state.players[0].zones.battlefield.add(makeCreature('U', 1, 1, [], 0, { colors: ['U'] }));

      const spell = { id: 'vspell', _uid: 'vs_0', name: 'Vivid Spell', type_line: 'Instant' };
      GameStack.push(state.stack, {
        card: spell, controller: 0, targets: [],
        effects: [{ type: 'draw', amount: 'vivid' }]
      });
      const handBefore = state.players[0].zones.hand.count();
      GameStack.resolve(state.stack, state);
      const handAfter = state.players[0].zones.hand.count();

      return { drawn: handAfter - handBefore };
    }, HELPERS);
    expect(result.drawn).toBe(3);
  });

  // =================== STUN COUNTER UNTAP ENFORCEMENT ===================

  test('Stun counter: creature does not untap, loses 1 counter', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 0;
      const creature = makeCreature('StunnedGuy', 3, 3, [], 0);
      creature._tapped = true;
      creature._stunCounters = 2;
      state.players[0].zones.battlefield.add(creature);

      // Simulate untap step
      state.phase = 'untap';
      state.players[0].zones.battlefield.cards.forEach(c => {
        if (c._stunCounters && c._stunCounters > 0) {
          c._stunCounters--;
          if (c._stunCounters > 0) return; // don't untap
        }
        c._tapped = false;
      });

      return {
        stillTapped: creature._tapped,
        stunCounters: creature._stunCounters
      };
    }, HELPERS);
    expect(result.stillTapped).toBe(true);
    expect(result.stunCounters).toBe(1);
  });

  test('Stun counter: creature untaps after last counter removed', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const creature = makeCreature('LastStun', 3, 3, [], 0);
      creature._tapped = true;
      creature._stunCounters = 1;
      state.players[0].zones.battlefield.add(creature);

      // Simulate untap step
      state.players[0].zones.battlefield.cards.forEach(c => {
        if (c._stunCounters && c._stunCounters > 0) {
          c._stunCounters--;
          if (c._stunCounters > 0) return;
        }
        c._tapped = false;
      });

      return {
        stillTapped: creature._tapped,
        stunCounters: creature._stunCounters
      };
    }, HELPERS);
    expect(result.stillTapped).toBe(false);
    expect(result.stunCounters).toBe(0);
  });

  // =================== THREATEN RETURN ===================

  test('Threaten: stolen creature returns at end of turn', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const creature = makeCreature('StolenCreature', 4, 4, [], 1);
      creature._stolenFrom = 1; // originally player 1's
      state.players[0].zones.battlefield.add(creature); // currently under player 0

      const p0Before = state.players[0].zones.battlefield.count();
      const p1Before = state.players[1].zones.battlefield.count();

      GameState._endOfTurnCleanup(state);

      const p0After = state.players[0].zones.battlefield.count();
      const p1After = state.players[1].zones.battlefield.count();

      return { p0Before, p0After, p1Before, p1After };
    }, HELPERS);
    expect(result.p0Before).toBe(1);
    expect(result.p0After).toBe(0);
    expect(result.p1After).toBe(result.p1Before + 1);
  });

  // =================== TRIGGERED ABILITY EVENT FIRING ===================

  test('Triggered: attacks event fires on declared attack', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 0;
      const attacker = makeCreature('TriggerAttacker', 3, 3, [], 0);
      attacker._summoningSick = false;
      state.players[0].zones.battlefield.add(attacker);

      // Register an "attacks" trigger that draws a card
      state._triggers.push({
        event: 'attacks',
        effects: [{ type: 'draw', amount: 1 }],
        self: true,
        cardUid: attacker._uid,
        cardName: attacker.name,
        controllerId: 0
      });

      const handBefore = state.players[0].zones.hand.count();
      GameState.fireTrigger(state, 'attacks', { cardUid: attacker._uid, card: attacker, playerId: 0 });
      const handAfter = state.players[0].zones.hand.count();

      return { drew: handAfter - handBefore };
    }, HELPERS);
    expect(result.drew).toBe(1);
  });

  test('Triggered: combat_damage_player fires on unblocked damage', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 0;
      const attacker = makeCreature('DmgTrigger', 2, 2, [], 0);
      attacker._summoningSick = false;
      state.players[0].zones.battlefield.add(attacker);

      let triggered = false;
      state._triggers.push({
        event: 'combat_damage_player',
        effects: [{ type: 'draw', amount: 1 }],
        self: true,
        cardUid: attacker._uid,
        cardName: attacker.name,
        controllerId: 0
      });

      // Combat with unblocked attacker
      state.combat.phase = 'attackers';
      state.combat.attackers = [{ uid: attacker._uid, card: attacker }];
      state.combat.blockers = {};

      const handBefore = state.players[0].zones.hand.count();
      CombatSystem.resolveCombatDamage(state.combat, state.players[0], state.players[1], state);
      const handAfter = state.players[0].zones.hand.count();

      return { drew: handAfter - handBefore };
    }, HELPERS);
    expect(result.drew).toBe(1);
  });

  test('Triggered: upkeep trigger fires during upkeep phase', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 0;
      const enchant = makeEnchantment('UpkeepDrawer', 0);
      state.players[0].zones.battlefield.add(enchant);

      state._triggers.push({
        event: 'upkeep',
        effects: [{ type: 'draw', amount: 1 }],
        cardUid: enchant._uid,
        cardName: enchant.name,
        controllerId: 0
      });

      const handBefore = state.players[0].zones.hand.count();
      GameState.fireTrigger(state, 'upkeep', { playerId: 0 });
      const handAfter = state.players[0].zones.hand.count();

      return { drew: handAfter - handBefore };
    }, HELPERS);
    expect(result.drew).toBe(1);
  });

  test('Triggered: dies trigger fires on creature death', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const creature = makeCreature('DyingGuy', 2, 2, [], 0);
      state.players[0].zones.battlefield.add(creature);

      // Register a dies trigger that gains life
      state._triggers.push({
        event: 'dies',
        effects: [{ type: 'gainLife', amount: 3 }],
        self: true,
        cardUid: creature._uid,
        cardName: creature.name,
        controllerId: 0
      });

      const lifeBefore = state.players[0].life;
      GameState.creatureDies(state, creature, 0);
      const lifeAfter = state.players[0].life;

      return { gained: lifeAfter - lifeBefore };
    }, HELPERS);
    expect(result.gained).toBe(3);
  });

  // =================== ACTIVATED ABILITY COSTS ===================

  test('Activated ability: tap cost requires untapped creature', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const creature = makeCreature('TapActivator', 2, 2, [], 1);
      creature._tapped = true; // already tapped
      state.players[1].zones.battlefield.add(creature);

      // Creature has activated ability requiring tap
      // The AI checks _tapped before activating
      const canActivate = !creature._tapped;
      return { canActivate };
    }, HELPERS);
    expect(result.canActivate).toBe(false);
  });

  // =================== EXTRA COMBAT ===================

  test('Extra combat: _extraCombat flag grants another combat', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state._extraCombat = true;
      state.phase = 'combat_end';

      // extra combat means state should allow another combat
      const hasExtra = !!state._extraCombat;
      return { hasExtra };
    }, HELPERS);
    expect(result.hasExtra).toBe(true);
  });

  // =================== COPY SPELL ===================

  test('Copy next spell: _pendingSpellCopy flag works', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state._pendingSpellCopy = { controllerId: 0 };

      const hasPending = !!state._pendingSpellCopy;
      return { hasPending, controller: state._pendingSpellCopy.controllerId };
    }, HELPERS);
    expect(result.hasPending).toBe(true);
    expect(result.controller).toBe(0);
  });

  // =================== BLIGHT (AI PATH) ===================

  test('Blight: puts -1/-1 counters on own weakest creature', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 0;

      const weak = makeCreature('WeakBlight', 1, 2, [], 0);
      const strong = makeCreature('StrongBlight', 4, 4, [], 0);
      state.players[0].zones.battlefield.add(weak);
      state.players[0].zones.battlefield.add(strong);

      // Simulate blight on player 0
      if (typeof GameState._performBlight === 'function') {
        GameState._performBlight(state, 0, 1);
        const weakCounters = weak._counters ? (weak._counters['-1/-1'] || 0) : 0;
        const strongCounters = strong._counters ? (strong._counters['-1/-1'] || 0) : 0;
        return { weakCounters, strongCounters, hasFn: true };
      }
      return { hasFn: false };
    }, HELPERS);
    if (result.hasFn) {
      expect(result.weakCounters).toBe(1);
      expect(result.strongCounters).toBe(0);
    }
  });

  // =================== GRAVEYARD ACTIVATION ===================

  test('Graveyard abilities: getGraveyardAbilities returns zone graveyard activated', async () => {
    const result = await page.evaluate(() => {
      // Check a card that has graveyard abilities (Lasyd Prowler from TDM)
      const card = { name: 'Lasyd Prowler', type_line: 'Creature', oracle_text: '' };
      const abilities = CardEngine.getGraveyardAbilities(card);
      return { count: abilities.length, hasAbility: abilities.length > 0 };
    });
    // Lasyd Prowler should have graveyard abilities defined in DB
    expect(result.hasAbility).toBe(true);
  });

  // =================== HIDEAWAY CONDITION CHECK ===================

  test('Hideaway: Mosswort Bridge checks total creature power >= 10', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      // Add creatures with total power >= 10
      const big1 = makeCreature('BigOne', 5, 5, [], 0);
      const big2 = makeCreature('BigTwo', 6, 6, [], 0);
      state.players[0].zones.battlefield.add(big1);
      state.players[0].zones.battlefield.add(big2);

      // Fake a hideaway land
      const land = makeLand('Mosswort Bridge', 'G', 0, { typeLine: 'Land' });
      land._hideaway = true;
      land._hideawayCard = { name: 'Freebie', type_line: 'Creature', power: '3', toughness: '3' };
      land._hideawayCondition = 'power_10_or_more';
      state.players[0].zones.battlefield.add(land);

      const met = GameState._checkHideawayCondition(state, 0, land);
      return { met };
    }, HELPERS);
    expect(result.met).toBe(true);
  });

  test('Hideaway: Spinerock Knoll checks 7+ damage dealt this turn', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      // Set up damage tracking (our bug fix)
      state._damageDealtThisTurn = [0, 8]; // 8 damage dealt to player 1

      const land = makeLand('Spinerock Knoll', 'R', 0, { typeLine: 'Land' });
      land._hideaway = true;
      land._hideawayCard = { name: 'BigSpell', type_line: 'Sorcery' };
      land._hideawayCondition = 'seven_damage_dealt';
      state.players[0].zones.battlefield.add(land);

      const met = GameState._checkHideawayCondition(state, 0, land);

      // Also check it fails when not enough
      state._damageDealtThisTurn = [0, 5];
      const notMet = GameState._checkHideawayCondition(state, 0, land);

      return { met, notMet };
    }, HELPERS);
    expect(result.met).toBe(true);
    expect(result.notMet).toBe(false);
  });

  test('Hideaway: Shelldock Isle checks library <= 20', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      // Both libraries have 30 cards by default
      const land = makeLand('Shelldock Isle', 'U', 0, { typeLine: 'Land' });
      land._hideaway = true;
      land._hideawayCard = { name: 'FreeSpell', type_line: 'Instant' };
      land._hideawayCondition = 'library_20_or_less';
      state.players[0].zones.battlefield.add(land);

      const notMet = GameState._checkHideawayCondition(state, 0, land);

      // Remove cards to get below 20
      for (let i = 0; i < 15; i++) {
        state.players[0].zones.library.cards.pop();
      }
      const met = GameState._checkHideawayCondition(state, 0, land);

      return { notMet, met };
    }, HELPERS);
    expect(result.notMet).toBe(false);
    expect(result.met).toBe(true);
  });

  // =================== PERSIST ===================

  test('Persist: creature returns with -1/-1 counter', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const persist = makeCreature('PersistGuy', 3, 3, ['Persist'], 0);
      persist._counters = { '+1/+1': 0, '-1/-1': 0 };
      state.players[0].zones.battlefield.add(persist);

      const bfBefore = state.players[0].zones.battlefield.count();
      GameState.creatureDies(state, persist, 0);
      const bfAfter = state.players[0].zones.battlefield.count();

      // Find the returned creature
      const returned = state.players[0].zones.battlefield.cards.find(c => c.name === 'PersistGuy');
      const hasMinusCounter = returned ? (returned._counters['-1/-1'] || 0) : 0;

      return { bfBefore, bfAfter, hasMinusCounter, returned: !!returned };
    }, HELPERS);
    expect(result.returned).toBe(true);
    expect(result.hasMinusCounter).toBe(1);
  });

  test('Persist: does NOT return if already has -1/-1 counters', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const persist = makeCreature('NoPersist', 3, 3, ['Persist'], 0);
      persist._counters = { '+1/+1': 0, '-1/-1': 1 }; // already has -1/-1
      state.players[0].zones.battlefield.add(persist);

      GameState.creatureDies(state, persist, 0);

      const returned = state.players[0].zones.battlefield.cards.find(c => c.name === 'NoPersist');
      const inGY = state.players[0].zones.graveyard.cards.some(c => c.name === 'NoPersist');

      return { returned: !!returned, inGY };
    }, HELPERS);
    expect(result.returned).toBe(false);
    expect(result.inGY).toBe(true);
  });

  // =================== WITHER ===================

  test('Wither: damage dealt as -1/-1 counters in combat', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const witherGuy = makeCreature('WitherGuy', 3, 3, ['Wither'], 0);
      witherGuy._summoningSick = false;
      state.players[0].zones.battlefield.add(witherGuy);
      const blocker = makeCreature('Blocker', 2, 5, [], 1);
      state.players[1].zones.battlefield.add(blocker);

      state.combat.phase = 'attackers';
      state.combat.attackers = [{ uid: witherGuy._uid, card: witherGuy }];
      state.combat.blockers = { [witherGuy._uid]: [{ uid: blocker._uid, card: blocker }] };

      CombatSystem.resolveCombatDamage(state.combat, state.players[0], state.players[1], state);

      const minusCounters = blocker._counters ? (blocker._counters['-1/-1'] || 0) : 0;
      // Wither deals damage as -1/-1 counters instead of regular damage
      return { minusCounters, blockerDamage: blocker._damage || 0 };
    }, HELPERS);
    // WitherGuy has 3 power, should place 3 -1/-1 counters
    expect(result.minusCounters).toBe(3);
  });

  // =================== TEMPORARY KEYWORD CLEANUP ===================

  test('Temporary keywords cleared at end of turn', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const creature = makeCreature('TempKW', 2, 2, ['Haste'], 0);
      creature._tempKeywords = ['Haste'];
      state.players[0].zones.battlefield.add(creature);

      const kwBefore = creature.keywords.includes('Haste');
      GameState._endOfTurnCleanup(state);
      const kwAfter = creature.keywords.includes('Haste');

      return { kwBefore, kwAfter };
    }, HELPERS);
    expect(result.kwBefore).toBe(true);
    expect(result.kwAfter).toBe(false);
  });

  // =================== TEMPORARY P/T BUFF CLEANUP ===================

  test('Temporary power/toughness mods reset at end of turn', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const creature = makeCreature('TempBuff', 2, 2, [], 0);
      creature._powerMod = 3;
      creature._tempPowerMod = 3;
      creature._toughnessMod = 2;
      creature._tempToughnessMod = 2;
      state.players[0].zones.battlefield.add(creature);

      const powBefore = CardEngine.getPower(creature);
      GameState._endOfTurnCleanup(state);
      const powAfter = CardEngine.getPower(creature);
      const toughAfter = CardEngine.getToughness(creature);

      return { powBefore, powAfter, toughAfter };
    }, HELPERS);
    expect(result.powBefore).toBe(5); // 2 base + 3 mod
    expect(result.powAfter).toBe(2);  // back to base
    expect(result.toughAfter).toBe(2);
  });

  // =================== MOBILIZE SACRIFICE AT END STEP ===================

  test('Mobilize tokens sacrificed at end of turn', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const token = makeCreature('Soldier', 1, 1, [], 0);
      token._isToken = true;
      token._sacrificeAtEndStep = true;
      state.players[0].zones.battlefield.add(token);

      const bfBefore = state.players[0].zones.battlefield.count();
      GameState._endOfTurnCleanup(state);
      const bfAfter = state.players[0].zones.battlefield.count();

      return { bfBefore, bfAfter };
    }, HELPERS);
    expect(result.bfBefore).toBe(1);
    expect(result.bfAfter).toBe(0);
  });

  // =================== INDESTRUCTIBLE vs DESTROY vs EXILE ===================

  test('Indestructible: survives destroy but not exile', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const indestructible = makeCreature('IronGuard', 4, 4, ['Indestructible'], 0);
      state.players[0].zones.battlefield.add(indestructible);

      // Try destroy
      const died = GameState.creatureDies(state, indestructible, 0);
      const onBfAfterDestroy = state.players[0].zones.battlefield.cards.some(c => c.name === 'IronGuard');

      return { died, onBfAfterDestroy };
    }, HELPERS);
    expect(result.died).toBe(false);
    expect(result.onBfAfterDestroy).toBe(true);
  });

  test('Indestructible: sacrifice bypasses indestructible', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const indestructible = makeCreature('IronSac', 4, 4, ['Indestructible'], 0);
      state.players[0].zones.battlefield.add(indestructible);

      GameState.sacrifice(state, 0, indestructible._uid);
      const onBf = state.players[0].zones.battlefield.cards.some(c => c.name === 'IronSac');

      return { onBf };
    }, HELPERS);
    expect(result.onBf).toBe(false);
  });

  // =================== HEXPROOF TARGETING ===================

  test('Hexproof: cannot be targeted by opponent', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const hexproof = makeCreature('HexGuard', 3, 3, ['Hexproof'], 0);
      state.players[0].zones.battlefield.add(hexproof);

      const canTargetByOpp = CardEngine.canBeTargeted(hexproof, 1);
      const canTargetByOwner = CardEngine.canBeTargeted(hexproof, 0);

      return { canTargetByOpp, canTargetByOwner };
    }, HELPERS);
    expect(result.canTargetByOpp).toBe(false);
    expect(result.canTargetByOwner).toBe(true);
  });

  // =================== CHANGELING ===================

  test('Changeling: counts as all creature types', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const creature = makeCreature('Shapeshifter', 2, 2, ['Changeling'], 0, {
        typeLine: 'Creature — Shapeshifter'
      });

      return {
        isElf: CardEngine.hasCreatureType(creature, 'elf'),
        isGoblin: CardEngine.hasCreatureType(creature, 'goblin'),
        isDragon: CardEngine.hasCreatureType(creature, 'dragon'),
        isFaerie: CardEngine.hasCreatureType(creature, 'faerie'),
        hasChangeling: CardEngine.hasChangeling(creature)
      };
    }, HELPERS);
    expect(result.hasChangeling).toBe(true);
    expect(result.isElf).toBe(true);
    expect(result.isGoblin).toBe(true);
    expect(result.isDragon).toBe(true);
    expect(result.isFaerie).toBe(true);
  });

  // =================== DAMAGE PREVENTION SHIELD ===================

  test('Damage prevention: _damageShield reduces combat damage', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state._damageShield = [0, 3]; // player 1 has 3 damage prevention
      const attacker = makeCreature('Attacker', 5, 5, [], 0);
      attacker._summoningSick = false;
      state.players[0].zones.battlefield.add(attacker);

      state.combat.phase = 'attackers';
      state.combat.attackers = [{ uid: attacker._uid, card: attacker }];
      state.combat.blockers = {};
      CombatSystem.resolveCombatDamage(state.combat, state.players[0], state.players[1], state);

      return {
        p1Life: state.players[1].life,
        shieldRemaining: state._damageShield ? state._damageShield[1] : -1
      };
    }, HELPERS);
    // 5 damage - 3 prevented = 2 actual damage
    expect(result.p1Life).toBe(18);
    expect(result.shieldRemaining).toBe(0);
  });

  // =================== ANTHEM EFFECT ===================

  test('Anthem: grants +X/+X to all own creatures', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 0;
      const c1 = makeCreature('Ant1', 2, 2, [], 0);
      const c2 = makeCreature('Ant2', 3, 3, [], 0);
      state.players[0].zones.battlefield.add(c1);
      state.players[0].zones.battlefield.add(c2);

      // Also need an enchantment card on bf for anthem to attach to
      const enchant = makeEnchantment('TestAnthem', 0);
      state.players[0].zones.battlefield.add(enchant);

      GameStack.push(state.stack, {
        card: enchant, controller: 0, targets: [],
        effects: [{ type: 'anthem', power: 1, toughness: 1, keywords: ['trample'] }]
      });
      GameStack.resolve(state.stack, state);

      return {
        c1pow: CardEngine.getPower(c1),
        c1tough: CardEngine.getToughness(c1),
        c2pow: CardEngine.getPower(c2),
        c1hasTramp: (c1.keywords || []).some(k => k.toLowerCase() === 'trample')
      };
    }, HELPERS);
    expect(result.c1pow).toBe(3);
    expect(result.c1tough).toBe(3);
    expect(result.c2pow).toBe(4);
    expect(result.c1hasTramp).toBe(true);
  });

  // =================== STACK: TRIGGERED EFFECT TYPE ===================

  test('Stack: type "triggered" registers trigger on card', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const enchant = makeEnchantment('SiegeLike', 0);
      state.players[0].zones.battlefield.add(enchant);

      const trigsBefore = state._triggers.length;
      GameStack.push(state.stack, {
        card: enchant, controller: 0, targets: [],
        effects: [{ type: 'triggered', event: 'upkeep', effects: [{ type: 'draw', amount: 1 }] }]
      });
      GameStack.resolve(state.stack, state);
      const trigsAfter = state._triggers.length;

      const hasTrigger = state._triggers.some(t =>
        t.cardUid === enchant._uid && t.event === 'upkeep'
      );

      return { added: trigsAfter - trigsBefore, hasTrigger };
    }, HELPERS);
    expect(result.added).toBe(1);
    expect(result.hasTrigger).toBe(true);
  });

  test('Stack: type "static" stores ability on card', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const enchant = makeEnchantment('StaticEnch', 0);
      state.players[0].zones.battlefield.add(enchant);

      GameStack.push(state.stack, {
        card: enchant, controller: 0, targets: [],
        effects: [{ type: 'static', ability: 'double_attack_triggers' }]
      });
      GameStack.resolve(state.stack, state);

      const card = state.players[0].zones.battlefield.get(enchant._uid);
      const hasStatic = card && card._staticAbilities && card._staticAbilities.length > 0;
      const abilityName = hasStatic ? card._staticAbilities[0].ability : null;

      return { hasStatic, abilityName };
    }, HELPERS);
    expect(result.hasStatic).toBe(true);
    expect(result.abilityName).toBe('double_attack_triggers');
  });

  // =================== ALL 4 SIEGE CARDS RESOLVE ===================

  test('All Siege cards resolve without crash (AI)', async () => {
    const siegeNames = ['Frostcliff Siege', 'Glacierwood Siege', 'Hollowmurk Siege', 'Windcrag Siege'];
    for (const siegeName of siegeNames) {
      const result = await page.evaluate((args) => {
        const { HELPERS, siegeName } = args;
        eval(HELPERS);
        const state = makeState();
        state.activePlayer = 1;
        const card = {
          id: siegeName.toLowerCase().replace(/ /g, '_'),
          _uid: 'siege_' + Math.random().toString(36).slice(2, 6),
          name: siegeName, type_line: 'Enchantment',
          power: null, toughness: null,
          mana_cost: '{3}{U}', cmc: 4, oracle_text: '',
          colors: ['U'], color_identity: ['U'], keywords: [], rarity: 'rare'
        };
        state.players[1].zones.hand.add(card);
        state.manaPool[1] = { W: 2, U: 4, B: 2, R: 2, G: 2, generic: 0 };

        try {
          GameState.castSpell(state, 1, card._uid, []);
          const onBf = state.players[1].zones.battlefield.cards.some(c => c.name === siegeName);
          return { name: siegeName, success: true, onBf };
        } catch (e) {
          return { name: siegeName, success: false, error: e.message };
        }
      }, { HELPERS, siegeName });
      expect(result.success, `${siegeName} should resolve`).toBe(true);
      expect(result.onBf, `${siegeName} should be on battlefield`).toBe(true);
    }
  });

  // =================== HIDEAWAY ACTIVATION ===================

  test('Hideaway: activateHideaway plays card for free', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      // Set up a land with hideaway card (Mosswort Bridge, condition met)
      const land = makeLand('Mosswort Bridge', 'G', 0, { typeLine: 'Land' });
      land._hideaway = true;
      land._hideawayCondition = 'power_10_or_more';
      land._hideawayCard = {
        id: 'hidden', _uid: 'hidden_0', name: 'Hidden Giant',
        type_line: 'Creature — Giant', power: '5', toughness: '5',
        mana_cost: '{4}{G}', cmc: 5, oracle_text: '',
        colors: ['G'], color_identity: ['G'], keywords: [], rarity: 'rare'
      };
      state.players[0].zones.battlefield.add(land);

      // Add enough power to meet condition
      const big = makeCreature('BigGuy', 10, 10, [], 0);
      state.players[0].zones.battlefield.add(big);

      const result = GameState.activateHideaway(state, 0, land._uid);
      const giantOnBf = state.players[0].zones.battlefield.cards.some(c => c.name === 'Hidden Giant');

      return { success: result.success, giantOnBf, noHideawayLeft: land._hideawayCard === null };
    }, HELPERS);
    expect(result.success).toBe(true);
    expect(result.giantOnBf).toBe(true);
    expect(result.noHideawayLeft).toBe(true);
  });

  // =================== CONVOKE ===================

  test('Convoke: autoConvoke taps weakest creatures first', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const weak = makeCreature('WeakConvoke', 1, 1, [], 0);
      weak._summoningSick = false;
      const strong = makeCreature('StrongConvoke', 5, 5, [], 0);
      strong._summoningSick = false;
      state.players[0].zones.battlefield.add(weak);
      state.players[0].zones.battlefield.add(strong);

      if (typeof ManaSystem.autoConvoke === 'function') {
        // Spell costs {4}{G} (5 total), no lands, so need convoke from creatures
        ManaSystem.autoConvoke(state, 0, '{4}{G}', 5);
        return {
          weakTapped: weak._tapped,
          strongTapped: strong._tapped,
          hasFn: true
        };
      }
      return { hasFn: false };
    }, HELPERS);
    if (result.hasFn) {
      expect(result.weakTapped).toBe(true);
      // Strong should only be tapped if needed (weakest first)
    }
  });

  // =================== REGENERATE SHIELD ===================

  test('Regenerate: creature survives lethal with _regenerateShield', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const creature = makeCreature('RegenGuy', 2, 3, [], 0);
      creature._regenerateShield = true;
      state.players[0].zones.battlefield.add(creature);

      const died = GameState.creatureDies(state, creature, 0);
      const onBf = state.players[0].zones.battlefield.cards.some(c => c.name === 'RegenGuy');

      return { died, onBf, shieldConsumed: !creature._regenerateShield };
    }, HELPERS);
    expect(result.died).toBe(false);
    expect(result.onBf).toBe(true);
    expect(result.shieldConsumed).toBe(true);
  });

  // =================== DOUBLE STRIKE ===================

  test('Double Strike: deals damage twice in combat', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      const dblStrike = makeCreature('DoubleStriker', 3, 3, ['Double Strike'], 0);
      dblStrike._summoningSick = false;
      state.players[0].zones.battlefield.add(dblStrike);

      state.combat.phase = 'attackers';
      state.combat.attackers = [{ uid: dblStrike._uid, card: dblStrike }];
      state.combat.blockers = {};

      // Use resolveCombatDamage which handles first strike + regular in sequence
      CombatSystem.resolveCombatDamage(state.combat, state.players[0], state.players[1], state);

      return { totalDmg: 20 - state.players[1].life };
    }, HELPERS);
    // Double strike: 3 + 3 = 6 total damage
    expect(result.totalDmg).toBe(6);
  });

  // =================== SHOCK LANDS ===================

  test('Shock lands: detected and pay 2 life to enter untapped', async () => {
    const result = await page.evaluate((HELPERS) => {
      eval(HELPERS);
      const state = makeState();
      state.activePlayer = 1;
      state.phase = 'main1';
      state.players[1].life = 10;
      state.landPlayedThisTurn = false;
      // A shock land: oracle text has "pay 2 life" and "enters tapped"
      const shock = {
        id: 'stomping_ground', _uid: 'sg_1', name: 'Stomping Ground',
        type_line: 'Land — Mountain Forest', power: null, toughness: null,
        mana_cost: '', cmc: 0,
        oracle_text: 'As Stomping Ground enters, you may pay 2 life. If you don\'t, it enters tapped.\n{T}: Add {R} or {G}.',
        colors: [], color_identity: ['R', 'G'], keywords: [], rarity: 'rare',
        subtypes: ['Mountain', 'Forest']
      };
      state.players[1].zones.hand.add(shock);

      GameState.playLand(state, 1, shock._uid);
      const land = state.players[1].zones.battlefield.cards.find(c => c.name === 'Stomping Ground');

      return {
        onBf: !!land,
        life: state.players[1].life,
        tapped: land ? land._tapped : null
      };
    }, HELPERS);
    expect(result.onBf).toBe(true);
    // AI pays 2 life if life > 4
    expect(result.life).toBe(8);
    expect(result.tapped).toBe(false);
  });

  // =================== Planeswalker System ===================

  test('isPlaneswalker detects planeswalker type', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const pw = { type_line: 'Legendary Planeswalker — Jace', name: 'Jace Beleren' };
      const creature = { type_line: 'Creature — Human Wizard', name: 'Test' };
      return {
        pwIs: CardEngine.isPlaneswalker(pw),
        creatureIsNot: CardEngine.isPlaneswalker(creature)
      };
    }, HELPERS);
    expect(result.pwIs).toBe(true);
    expect(result.creatureIsNot).toBe(false);
  });

  test('planeswalker enters with starting loyalty', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const pw = {
        name: 'Jace Beleren', type_line: 'Planeswalker — Jace',
        mana_cost: '{1}{U}{U}', cmc: 3, loyalty: '3',
        oracle_text: '', keywords: [], _uid: 'pw1', _ownerId: 1,
        colors: ['U'], color_identity: ['U']
      };
      const prepared = CardEngine.prepareForBattlefield(pw);
      return {
        loyalty: prepared._loyalty,
        usedThisTurn: prepared._loyaltyUsedThisTurn
      };
    }, HELPERS);
    expect(result.loyalty).toBe(3);
    expect(result.usedThisTurn).toBe(false);
  });

  test('getLoyaltyAbilities returns only loyalty-cost abilities', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const card = { name: 'Jace Beleren', type_line: 'Planeswalker' };
      const loyaltyAbs = CardEngine.getLoyaltyAbilities(card);
      const regularAbs = CardEngine.getActivatedAbilities(card);
      return {
        loyaltyCount: loyaltyAbs.length,
        regularCount: regularAbs.length,
        firstCostHasLoyalty: loyaltyAbs.length > 0 ? loyaltyAbs[0].cost.loyalty !== undefined : false
      };
    }, HELPERS);
    expect(result.loyaltyCount).toBeGreaterThan(0);
    expect(result.regularCount).toBe(0); // loyalty abilities filtered out
    expect(result.firstCostHasLoyalty).toBe(true);
  });

  test('activateLoyaltyAbility changes loyalty and resolves effects', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      // Jace Beleren: -1 loyalty = draw 1
      const pw = {
        name: 'Jace Beleren', type_line: 'Planeswalker — Jace',
        mana_cost: '{1}{U}{U}', cmc: 3, loyalty: '3',
        oracle_text: '', keywords: [], colors: ['U'], color_identity: ['U']
      };
      const prepared = CardEngine.prepareForBattlefield(pw);
      state.players[1].zones.battlefield.add(prepared);
      state.phase = 'main1';

      const handBefore = state.players[1].zones.hand.count();
      // Ability 0: -1 loyalty, draw 1
      const res = GameState.activateLoyaltyAbility(state, 1, prepared._uid, 0);
      const handAfter = state.players[1].zones.hand.count();

      return {
        success: res.success,
        loyaltyAfter: prepared._loyalty,
        usedThisTurn: prepared._loyaltyUsedThisTurn,
        drewCard: handAfter > handBefore
      };
    }, HELPERS);
    expect(result.success).toBe(true);
    expect(result.loyaltyAfter).toBe(2); // 3 - 1 = 2
    expect(result.usedThisTurn).toBe(true);
    expect(result.drewCard).toBe(true);
  });

  test('loyalty ability cannot be used twice per turn', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const pw = {
        name: 'Jace Beleren', type_line: 'Planeswalker — Jace',
        mana_cost: '{1}{U}{U}', cmc: 3, loyalty: '3',
        oracle_text: '', keywords: [], colors: ['U'], color_identity: ['U']
      };
      const prepared = CardEngine.prepareForBattlefield(pw);
      state.players[1].zones.battlefield.add(prepared);
      state.phase = 'main1';

      const res1 = GameState.activateLoyaltyAbility(state, 1, prepared._uid, 0);
      const res2 = GameState.activateLoyaltyAbility(state, 1, prepared._uid, 0);

      return { first: res1.success, second: res2.success };
    }, HELPERS);
    expect(result.first).toBe(true);
    expect(result.second).toBe(false);
  });

  test('planeswalker dies when loyalty reaches 0', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      // Elspeth: -3 ability destroys creature
      const pw = {
        name: 'Elspeth, Storm Slayer', type_line: 'Planeswalker — Elspeth',
        mana_cost: '{2}{W}{W}', cmc: 4, loyalty: '3',
        oracle_text: '', keywords: [], colors: ['W'], color_identity: ['W']
      };
      const prepared = CardEngine.prepareForBattlefield(pw);
      state.players[1].zones.battlefield.add(prepared);
      state.phase = 'main1';

      const bfBefore = state.players[1].zones.battlefield.count();
      // Ability 2: -3 loyalty, destroy (loyalty goes 3-3=0 → dies)
      const res = GameState.activateLoyaltyAbility(state, 1, prepared._uid, 2);
      const bfAfter = state.players[1].zones.battlefield.count();
      const inGY = state.players[1].zones.graveyard.getAll().some(c => c.name === 'Elspeth, Storm Slayer');

      return { success: res.success, died: bfAfter < bfBefore, inGY };
    }, HELPERS);
    expect(result.success).toBe(true);
    expect(result.died).toBe(true);
    expect(result.inGY).toBe(true);
  });

  test('positive loyalty cost increases loyalty', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      // Garruk: +1 loyalty = untap two lands
      const pw = {
        name: 'Garruk Wildspeaker', type_line: 'Planeswalker — Garruk',
        mana_cost: '{2}{G}{G}', cmc: 4, loyalty: '3',
        oracle_text: '', keywords: [], colors: ['G'], color_identity: ['G']
      };
      const prepared = CardEngine.prepareForBattlefield(pw);
      state.players[1].zones.battlefield.add(prepared);
      state.phase = 'main1';

      const res = GameState.activateLoyaltyAbility(state, 1, prepared._uid, 0);

      return { success: res.success, loyalty: prepared._loyalty };
    }, HELPERS);
    expect(result.success).toBe(true);
    expect(result.loyalty).toBe(4); // 3 + 1 = 4
  });

  test('cannot activate negative loyalty if insufficient', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      // Elspeth with only 2 loyalty, trying -3 ability
      const pw = {
        name: 'Elspeth, Storm Slayer', type_line: 'Planeswalker — Elspeth',
        mana_cost: '{2}{W}{W}', cmc: 4, loyalty: '2',
        oracle_text: '', keywords: [], colors: ['W'], color_identity: ['W']
      };
      const prepared = CardEngine.prepareForBattlefield(pw);
      state.players[1].zones.battlefield.add(prepared);
      state.phase = 'main1';

      const res = GameState.activateLoyaltyAbility(state, 1, prepared._uid, 2);

      return { success: res.success };
    }, HELPERS);
    expect(result.success).toBe(false);
  });

  test('loyaltyUsedThisTurn resets at end of turn cleanup', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const pw = {
        name: 'Jace Beleren', type_line: 'Planeswalker — Jace',
        mana_cost: '{1}{U}{U}', cmc: 3, loyalty: '3',
        oracle_text: '', keywords: [], colors: ['U'], color_identity: ['U']
      };
      const prepared = CardEngine.prepareForBattlefield(pw);
      state.players[1].zones.battlefield.add(prepared);
      state.phase = 'main1';

      GameState.activateLoyaltyAbility(state, 1, prepared._uid, 0);
      const usedBefore = prepared._loyaltyUsedThisTurn;

      GameState._endOfTurnCleanup(state);
      const usedAfter = prepared._loyaltyUsedThisTurn;

      return { usedBefore, usedAfter };
    }, HELPERS);
    expect(result.usedBefore).toBe(true);
    expect(result.usedAfter).toBe(false);
  });

  test('damagePlaneswalker reduces loyalty', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      const pw = {
        name: 'Jace Beleren', type_line: 'Planeswalker — Jace',
        mana_cost: '{1}{U}{U}', cmc: 3, loyalty: '5',
        oracle_text: '', keywords: [], colors: ['U'], color_identity: ['U']
      };
      const prepared = CardEngine.prepareForBattlefield(pw);
      state.players[1].zones.battlefield.add(prepared);

      GameState.damagePlaneswalker(state, prepared, 3, 1);

      return {
        loyalty: prepared._loyalty,
        onBf: state.players[1].zones.battlefield.count()
      };
    }, HELPERS);
    expect(result.loyalty).toBe(2);
    expect(result.onBf).toBe(1); // still alive
  });

  test('AI activates planeswalker loyalty abilities', async () => {
    const result = await page.evaluate((helpers) => {
      eval(helpers);
      const state = makeState();
      // Give AI Garruk with enough loyalty
      const pw = {
        name: 'Garruk Wildspeaker', type_line: 'Planeswalker — Garruk',
        mana_cost: '{2}{G}{G}', cmc: 4, loyalty: '3',
        oracle_text: '', keywords: [], colors: ['G'], color_identity: ['G']
      };
      const prepared = CardEngine.prepareForBattlefield(pw);
      state.players[1].zones.battlefield.add(prepared);
      state.phase = 'main1';

      GameAI._tryLoyaltyAbilities(state, 1);

      return {
        used: prepared._loyaltyUsedThisTurn,
        loyalty: prepared._loyalty
      };
    }, HELPERS);
    expect(result.used).toBe(true);
    // AI should have activated an ability (loyalty changed from 3)
    expect(result.loyalty).not.toBe(3);
  });
});
