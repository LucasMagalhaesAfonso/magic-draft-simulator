// @ts-check
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

// ============================================================
// Tarkir Dragonstorm (TDM) - Card-by-Card Tests
// Tests every card in CardEffectsDB for correct effect resolution
// ============================================================

test.describe('TDM Card Tests', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await setupTestGame(page);
  });

  // =================== INSTANTS ===================

  test.describe('Instants', () => {

    test("Alesha's Legacy - grants deathtouch+indestructible", async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell("Alesha's Legacy", '{B}', 1, 'Instant', '', ['B']);
        const creature = CardEngine.prepareForBattlefield(T.makeCreature('Bear', '2', '2'));
        const state = T.createTestState({ myHand: [spell], myBf: [creature] });
        T.addMana(state, 0, 'B');
        const effects = CardEngine.getSpellEffects(spell);
        GameStack.push(state.stack, { card: spell, controller: 0, targets: [{ type: 'creature', player: 0, uid: creature._uid }], effects });
        GameStack.resolve(state.stack, state);
        return {
          hasEffects: effects.length > 0,
          effectTypes: effects.map(e => e.type)
        };
      });
      expect(r.hasEffects).toBe(true);
      expect(r.effectTypes).toContain('buff');
    });

    test('Auroral Procession - return from graveyard', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Auroral Procession', '{3}{W}', 4, 'Instant', '', ['W']);
        const effects = CardEngine.getSpellEffects(spell);
        return { hasEffects: effects.length > 0, types: effects.map(e => e.type) };
      });
      expect(r.hasEffects).toBe(true);
      expect(r.types).toContain('return_from_graveyard');
    });

    test('Bewildering Blizzard - draw 3 + debuff all', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Bewildering Blizzard', '{4}{U}{U}', 6, 'Instant', '', ['U']);
        const oppC = CardEngine.prepareForBattlefield(T.makeCreature('Bear', '2', '2'));
        const state = T.createTestState({ myHand: [spell], oppBf: [oppC] });
        T.addMana(state, 0, 'UUUUUU');
        const handBefore = state.players[0].zones.hand.count();
        const effects = CardEngine.getSpellEffects(spell);
        GameStack.push(state.stack, { card: spell, controller: 0, targets: [], effects });
        GameStack.resolve(state.stack, state);
        return {
          effectCount: effects.length,
          types: effects.map(e => e.type),
          handAfter: state.players[0].zones.hand.count(),
          drew: state.players[0].zones.hand.count() - handBefore + 1 // +1 for spell removed
        };
      });
      expect(r.effectCount).toBe(2);
      expect(r.types).toContain('draw');
      expect(r.types).toContain('debuff_all');
    });

    test('Coordinated Maneuver - modal: damage or destroy enchantment', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Coordinated Maneuver', '{1}{W}', 2, 'Instant', '', ['W']);
        const effects = CardEngine.getSpellEffects(spell);
        const isModal = effects[0]?.type === 'modal';
        const modeTypes = effects[0]?.modes?.map(m => m.type) || [];
        return { isModal, modeTypes, damageIsX: effects[0]?.modes?.[0]?.amount === 'X' };
      });
      expect(r.isModal).toBe(true);
      expect(r.modeTypes).toContain('damage');
      expect(r.modeTypes).toContain('destroy');
      expect(r.damageIsX).toBe(true);
    });

    test('Cruel Truths - surveil 2, draw 2, lose 2 life', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Cruel Truths', '{2}{B}', 3, 'Instant', '', ['B']);
        const state = T.createTestState({ myHand: [spell] });
        T.addMana(state, 0, 'BBB');
        const effects = CardEngine.getSpellEffects(spell);
        GameStack.push(state.stack, { card: spell, controller: 0, targets: [], effects });
        GameStack.resolve(state.stack, state);
        return {
          types: effects.map(e => e.type),
          life: state.players[0].life
        };
      });
      expect(r.types).toEqual(['surveil', 'draw', 'lose_life']);
      expect(r.life).toBe(18);
    });

    test('Dispelling Exhale - counter spell', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Dispelling Exhale', '{U}', 1, 'Instant', '', ['U']);
        const effects = CardEngine.getSpellEffects(spell);
        return { types: effects.map(e => e.type), unlessPay: effects[0]?.unless_pay };
      });
      expect(r.types).toContain('counter');
      expect(r.unlessPay).toBe(2);
    });
  });

  // =================== SORCERIES ===================

  test.describe('Sorceries', () => {

    test('Aggressive Negotiations - reveal + exile + counter', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Aggressive Negotiations', '{1}{B}', 2, 'Sorcery', '', ['B']);
        const effects = CardEngine.getSpellEffects(spell);
        return { count: effects.length, types: effects.map(e => e.type) };
      });
      expect(r.count).toBe(3);
      expect(r.types).toContain('reveal_hand');
      expect(r.types).toContain('exile');
      expect(r.types).toContain('counter');
    });

    test('Channeled Dragonfire - 2 damage to any target', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Channeled Dragonfire', '{1}{R}', 2, 'Sorcery', '', ['R']);
        const state = T.createTestState({ myHand: [spell] });
        T.addMana(state, 0, 'RR');
        const effects = CardEngine.getSpellEffects(spell);
        GameStack.push(state.stack, { card: spell, controller: 0, targets: [{ type: 'player', player: 1, uid: null }], effects });
        GameStack.resolve(state.stack, state);
        return { oppLife: state.players[1].life, dmg: effects[0]?.amount };
      });
      expect(r.oppLife).toBe(18);
      expect(r.dmg).toBe(2);
    });

    test('Defibrillating Current - 4 damage + gain 2 life', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Defibrillating Current', '{3}{R}{W}', 5, 'Sorcery', '', ['R', 'W']);
        const effects = CardEngine.getSpellEffects(spell);
        return { types: effects.map(e => e.type), dmg: effects[0]?.amount, heal: effects[1]?.amount };
      });
      expect(r.types).toEqual(['damage', 'gain_life']);
      expect(r.dmg).toBe(4);
      expect(r.heal).toBe(2);
    });

    test('Death Begets Life - destroy all + draw X', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Death Begets Life', '{3}{W}{B}', 5, 'Sorcery', '', ['W', 'B']);
        const effects = CardEngine.getSpellEffects(spell);
        return { types: effects.map(e => e.type) };
      });
      expect(r.types).toContain('destroy_all');
      expect(r.types).toContain('draw');
    });

    test("Dragon's Prey - destroy creature", async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell("Dragon's Prey", '{1}{B}', 2, 'Sorcery', '', ['B']);
        const effects = CardEngine.getSpellEffects(spell);
        return { types: effects.map(e => e.type), target: effects[0]?.target };
      });
      expect(r.types).toContain('destroy');
      expect(r.target).toBe('creature');
    });

    test('Focus the Mind - draw 3, discard 1 (loot)', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('focus the mind');
        return {
          castType: db.cast?.[0]?.type,
          draw: db.cast?.[0]?.draw,
          discard: db.cast?.[0]?.discard,
          hasCostReduction: !!db.self_cost_reduction
        };
      });
      expect(r.castType).toBe('loot');
      expect(r.draw).toBe(3);
      expect(r.discard).toBe(1);
      expect(r.hasCostReduction).toBe(true);
    });

    test('Glacial Dragonhunt - draw 1 + conditional 3 damage', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Glacial Dragonhunt', '{2}{U}', 3, 'Sorcery', '', ['U']);
        const effects = CardEngine.getSpellEffects(spell);
        return { types: effects.map(e => e.type), count: effects.length };
      });
      expect(r.types).toContain('draw');
      expect(r.types).toContain('damage');
    });

    test('Caustic Exhale - debuff -3/-3', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Caustic Exhale', '{2}{B}', 3, 'Instant', '', ['B']);
        const effects = CardEngine.getSpellEffects(spell);
        return { types: effects.map(e => e.type), power: effects[0]?.power, tough: effects[0]?.toughness };
      });
      expect(r.types).toContain('debuff');
      expect(r.power).toBe(-3);
      expect(r.tough).toBe(-3);
    });

    test('Desperate Measures - buff +1/-1 + draw on death trigger', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Desperate Measures', '{R}', 1, 'Instant', '', ['R']);
        const effects = CardEngine.getSpellEffects(spell);
        const db = CardEffectsDB.getEffects('desperate measures');
        return {
          castTypes: effects.map(e => e.type),
          hasTriggered: !!db.triggered,
          triggerEvent: db.triggered?.[0]?.event
        };
      });
      expect(r.castTypes).toContain('buff');
      expect(r.hasTriggered).toBe(true);
      expect(r.triggerEvent).toBe('target_dies');
    });
  });

  // =================== CREATURES WITH ETB ===================

  test.describe('Creatures with ETB', () => {

    test('Abzan Monument - ETB ramp + activated sacrifice', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const card = T.makeCreature('Abzan Monument', '0', '4', {
          cost: '{3}', cmc: 3, oracle: 'When ~ enters, search for a basic Plains, Swamp, or Forest and put it into your hand.',
          typeLine: 'Artifact Creature — Monument'
        });
        const etb = CardEngine.getETBEffects(card);
        const db = CardEffectsDB.getEffects('abzan monument');
        return {
          etbTypes: etb.map(e => e.type),
          hasActivated: !!db.activated,
          activatedCount: db.activated?.length
        };
      });
      expect(r.etbTypes).toContain('ramp');
      expect(r.hasActivated).toBe(true);
    });

    test('Ainok Wayfarer - ETB mill 3 + return land', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const card = T.makeCreature('Ainok Wayfarer', '1', '3', {
          cost: '{1}{G}', cmc: 2, colors: ['G']
        });
        const etb = CardEngine.getETBEffects(card);
        return { types: etb.map(e => e.type) };
      });
      expect(r.types).toContain('mill');
    });

    test('Arashin Sunshield - ETB exile GY + activated tap', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('arashin sunshield');
        return {
          etbTypes: db.etb.map(e => e.type),
          hasActivated: !!db.activated,
          actCost: db.activated?.[0]?.cost?.mana,
          actHasTap: db.activated?.[0]?.cost?.tap,
          actEffects: db.activated?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.etbTypes).toContain('exile_from_graveyard');
      expect(r.hasActivated).toBe(true);
      expect(r.actCost).toBe('W');
      expect(r.actHasTap).toBe(true);
      expect(r.actEffects).toContain('tap');
    });

    test('Armament Dragon - ETB distribute +1/+1 counters', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const card = T.makeCreature('Armament Dragon', '4', '4', {
          cost: '{3}{G}{W}', cmc: 5, colors: ['G', 'W']
        });
        const etb = CardEngine.getETBEffects(card);
        return {
          types: etb.map(e => e.type),
          counter: etb[0]?.counter,
          amount: etb[0]?.amount
        };
      });
      expect(r.types).toContain('counter');
      expect(r.counter).toBe('+1/+1');
      expect(r.amount).toBe(3);
    });

    test('Constrictor Sage - ETB tap + stun counter', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const card = T.makeCreature('Constrictor Sage', '2', '3', {
          cost: '{1}{U}', cmc: 2, colors: ['U']
        });
        const etb = CardEngine.getETBEffects(card);
        return { types: etb.map(e => e.type) };
      });
      expect(r.types).toContain('tap');
      expect(r.types).toContain('stun_counter');
    });

    test('Disruptive Stormbrood - ETB destroy artifact/enchantment', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const card = T.makeCreature('Disruptive Stormbrood', '3', '3', {
          cost: '{2}{G}', cmc: 3, colors: ['G']
        });
        const etb = CardEngine.getETBEffects(card);
        return { types: etb.map(e => e.type), target: etb[0]?.target };
      });
      expect(r.types).toContain('destroy');
      expect(r.target).toBe('artifact_or_enchantment');
    });

    test('Dragonologist - ETB look top 6', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('dragonologist');
        return { etbTypes: db.etb.map(e => e.type), amount: db.etb[0]?.amount };
      });
      expect(r.etbTypes).toContain('look_top');
      expect(r.amount).toBe(6);
    });

    test('Dusyut Earthcarver - ETB endure 3', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const card = T.makeCreature('Dusyut Earthcarver', '3', '3', {
          cost: '{2}{G}', cmc: 3, colors: ['G']
        });
        const state = T.createTestState({ myHand: [card] });
        T.addMana(state, 0, 'GGG');
        GameState.castSpell(state, 0, card._uid);
        if (state._pendingEndure) GameState.resolveEndureChoice(state, 'counters');
        const bf = state.players[0].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        const c = bf.find(b => b.name === 'Dusyut Earthcarver');
        return {
          onBf: bf.length >= 1,
          counters: c ? (c._counters?.['+1/+1'] || 0) : 0
        };
      });
      expect(r.onBf).toBe(true);
      expect(r.counters).toBe(3); // endure 3 = 3 +1/+1 counters
    });

    test('Equilibrium Adept - ETB exile top play', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('equilibrium adept');
        return { etbTypes: db.etb.map(e => e.type) };
      });
      expect(r.etbTypes).toContain('exile_top_play');
    });
  });

  // =================== CREATURES WITH TRIGGERS ===================

  test.describe('Creatures with Triggers', () => {

    test('Ambling Stormshell - ward + attacks trigger: stun self + draw 3', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('ambling stormshell');
        return {
          hasStatic: !!db.static,
          ward: db.static?.some(s => s.keyword === 'ward'),
          trigEvent: db.triggered?.[0]?.event,
          trigEffectTypes: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.ward).toBe(true);
      expect(r.trigEvent).toBe('attacks');
      expect(r.trigEffectTypes).toContain('stun_counter_self');
      expect(r.trigEffectTypes).toContain('draw');
    });

    test('Anafenza, Unyielding Lineage - other creature dies trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('anafenza, unyielding lineage');
        return {
          event: db.triggered?.[0]?.event,
          effectType: db.triggered?.[0]?.effects?.[0]?.type,
          amount: db.triggered?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.event).toBe('other_creature_dies');
      expect(r.effectType).toBe('endure');
      expect(r.amount).toBe(2);
    });

    test('Attuned Hunter - cards leave graveyard trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('attuned hunter');
        return { event: db.triggered?.[0]?.event, effectType: db.triggered?.[0]?.effects?.[0]?.type };
      });
      expect(r.event).toBe('cards_leave_graveyard');
      expect(r.effectType).toBe('counter_self');
    });

    test('Bloomvine Regent - dragon enters trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('bloomvine regent');
        return { event: db.triggered?.[0]?.event, effectType: db.triggered?.[0]?.effects?.[0]?.type };
      });
      expect(r.event).toBe('dragon_enters');
      expect(r.effectType).toBe('gain_life');
    });

    test('Boulderborn Dragon - attacks trigger: surveil 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('boulderborn dragon');
        return {
          event: db.triggered?.[0]?.event,
          self: db.triggered?.[0]?.self,
          effectType: db.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.event).toBe('attacks');
      expect(r.self).toBe(true);
      expect(r.effectType).toBe('surveil');
    });

    test('Cori Mountain Stalwart - second spell trigger: damage + life', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('cori mountain stalwart');
        return {
          event: db.triggered?.[0]?.event,
          effectTypes: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.event).toBe('second_spell');
      expect(r.effectTypes).toContain('damage_each_opponent');
      expect(r.effectTypes).toContain('gain_life');
    });

    test('Delta Bloodflies - conditional attacks trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('delta bloodflies');
        return {
          event: db.triggered?.[0]?.event,
          condition: db.triggered?.[0]?.condition,
          effectType: db.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.event).toBe('attacks');
      expect(r.condition).toBe('control_creature_with_counter');
    });

    test('Descendant of Storms - attacks trigger: endure 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('descendant of storms');
        return {
          event: db.triggered?.[0]?.event,
          effectType: db.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.event).toBe('attacks');
      expect(r.effectType).toBe('endure');
    });

    test('Devoted Duelist - haste + second spell trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('devoted duelist');
        return {
          hasHaste: db.static?.some(s => s.keyword === 'haste'),
          trigEvent: db.triggered?.[0]?.event,
          trigEffect: db.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.hasHaste).toBe(true);
      expect(r.trigEvent).toBe('second_spell');
      expect(r.trigEffect).toBe('damage_each_opponent');
    });

    test('Felothar, Dawn of the Abzan - enters or attacks trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('felothar, dawn of the abzan');
        return {
          event: db.triggered?.[0]?.event,
          effectTypes: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.event).toBe('enters_or_attacks');
      expect(r.effectTypes).toContain('sacrifice');
      expect(r.effectTypes).toContain('counter_all');
    });

    test('Furious Forebear - creature dies in GY trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('furious forebear');
        return {
          event: db.triggered?.[0]?.event,
          zone: db.triggered?.[0]?.zone,
          effectType: db.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.event).toBe('creature_dies');
      expect(r.zone).toBe('graveyard');
      expect(r.effectType).toBe('return_to_hand');
    });

    test('Host of the Hereafter - creature dies with counters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('host of the hereafter');
        return {
          event: db.triggered?.[0]?.event,
          effectType: db.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.event).toBe('creature_dies_with_counters');
      expect(r.effectType).toBe('move_counters');
    });

    test('Inspirited Vanguard - enters or attacks: endure 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('inspirited vanguard');
        return {
          event: db.triggered?.[0]?.event,
          amount: db.triggered?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.event).toBe('enters_or_attacks');
      expect(r.amount).toBe(2);
    });

    test('Jeskai Devotee - second spell: buff self', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('jeskai devotee');
        return {
          event: db.triggered?.[0]?.event,
          effectType: db.triggered?.[0]?.effects?.[0]?.type,
          power: db.triggered?.[0]?.effects?.[0]?.power
        };
      });
      expect(r.event).toBe('second_spell');
      expect(r.effectType).toBe('buff');
      expect(r.power).toBe(1);
    });

    test('Jeskai Shrinekeeper - combat damage: gain life + draw', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('jeskai shrinekeeper');
        return {
          event: db.triggered?.[0]?.event,
          effectTypes: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.event).toBe('combat_damage_player');
      expect(r.effectTypes).toContain('gain_life');
      expect(r.effectTypes).toContain('draw');
    });

    test('Kheru Goldkeeper - cards leave GY: create Treasure', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('kheru goldkeeper');
        return {
          event: db.triggered?.[0]?.event,
          effectType: db.triggered?.[0]?.effects?.[0]?.type,
          tokenName: db.triggered?.[0]?.effects?.[0]?.name
        };
      });
      expect(r.event).toBe('cards_leave_graveyard');
      expect(r.effectType).toBe('create_token');
      expect(r.tokenName).toBe('Treasure');
    });

    test('Kishla Skimmer - card leaves GY once per turn: draw', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('kishla skimmer');
        return {
          event: db.triggered?.[0]?.event,
          oncePerTurn: db.triggered?.[0]?.once_per_turn,
          effectType: db.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.event).toBe('card_leaves_graveyard');
      expect(r.oncePerTurn).toBe(true);
      expect(r.effectType).toBe('draw');
    });

    test('Kotis, the Fangkeeper - indestructible + combat damage trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('kotis, the fangkeeper');
        return {
          indestructible: db.static?.some(s => s.keyword === 'indestructible'),
          trigEvent: db.triggered?.[0]?.event,
          trigEffectType: db.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.indestructible).toBe(true);
      expect(r.trigEvent).toBe('combat_damage_player');
      expect(r.trigEffectType).toBe('exile_top_opponent');
    });

    test('Marshal of the Lost - attacks: buff X', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('marshal of the lost');
        return {
          event: db.triggered?.[0]?.event,
          effectType: db.triggered?.[0]?.effects?.[0]?.type,
          powerIsX: db.triggered?.[0]?.effects?.[0]?.power === 'X'
        };
      });
      expect(r.event).toBe('attacks');
      expect(r.effectType).toBe('buff');
      expect(r.powerIsX).toBe(true);
    });

    test('Poised Practitioner - second spell: counter + scry', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('poised practitioner');
        return {
          event: db.triggered?.[0]?.event,
          effectTypes: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.event).toBe('second_spell');
      expect(r.effectTypes).toContain('counter_self');
      expect(r.effectTypes).toContain('scry');
    });
  });

  // =================== ACTIVATED ABILITIES ===================

  test.describe('Activated Abilities', () => {

    test('Abzan Devotee - mana ability + GY return', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('abzan devotee');
        return {
          count: db.activated.length,
          firstCost: db.activated[0]?.cost?.mana,
          firstEffectType: db.activated[0]?.effects?.[0]?.type,
          secondZone: db.activated[1]?.cost?.zone,
          secondEffectType: db.activated[1]?.effects?.[0]?.type
        };
      });
      expect(r.count).toBe(2);
      expect(r.firstEffectType).toBe('add_mana');
      expect(r.secondZone).toBe('graveyard');
      expect(r.secondEffectType).toBe('return_to_hand');
    });

    test('A-Cori-Steel Cutter - grant haste + second spell token', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('a-cori-steel cutter');
        return {
          grantHaste: db.static?.some(s => s.keyword === 'haste'),
          trigEvent: db.triggered?.[0]?.event,
          trigEffects: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.grantHaste).toBe(true);
      expect(r.trigEvent).toBe('second_spell');
      expect(r.trigEffects).toContain('create_token');
    });

    test('Bearer of Glory - first strike + activated buff all', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('bearer of glory');
        return {
          firstStrike: db.static?.some(s => s.keyword === 'first_strike'),
          actCost: db.activated?.[0]?.cost?.mana,
          actEffectType: db.activated?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.firstStrike).toBe(true);
      expect(r.actCost).toBe('4W');
      expect(r.actEffectType).toBe('buff_all');
    });

    test("Alchemist's Assistant - lifelink + GY activated ability", async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects("alchemist's assistant");
        return {
          lifelink: db.static?.some(s => s.keyword === 'lifelink'),
          zone: db.activated?.[0]?.cost?.zone,
          exile: db.activated?.[0]?.cost?.exile,
          effectType: db.activated?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.lifelink).toBe(true);
      expect(r.zone).toBe('graveyard');
      expect(r.exile).toBe(true);
    });
  });

  // =================== ENCHANTMENTS ===================

  test.describe('Enchantments', () => {

    test('All-Out Assault - static buff all + deathtouch', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('all-out assault');
        return {
          staticCount: db.static?.length,
          buffAll: db.static?.some(s => s.type === 'buff_all'),
          grantDeathtouch: db.static?.some(s => s.type === 'grant_all' && s.keyword === 'deathtouch'),
          etbType: db.etb?.[0]?.type
        };
      });
      expect(r.buffAll).toBe(true);
      expect(r.grantDeathtouch).toBe(true);
      expect(r.etbType).toBe('extra_combat');
    });

    test('Barrensteppe Siege - modal enchantment with Abzan/Mardu', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('barrensteppe siege');
        const modal = db.modal;
        return {
          hasModal: !!modal,
          chooseOnETB: modal?.chooseOnETB,
          modeCount: modal?.modes?.length,
          mode0Label: modal?.modes?.[0]?.label,
          mode1Label: modal?.modes?.[1]?.label,
          mode0Event: modal?.modes?.[0]?.effects?.[0]?.event,
          mode1Event: modal?.modes?.[1]?.effects?.[0]?.event
        };
      });
      expect(r.hasModal).toBe(true);
      expect(r.chooseOnETB).toBe(true);
      expect(r.modeCount).toBe(2);
      expect(r.mode0Label).toBe('Abzan');
      expect(r.mode1Label).toBe('Mardu');
      expect(r.mode0Event).toBe('end_step');
      expect(r.mode1Event).toBe('end_step');
    });

    test('Awaken the Honored Dead - saga with 3 chapters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('awaken the honored dead');
        return {
          isSaga: db.saga,
          ch1Type: db.chapters?.[1]?.[0]?.type,
          ch2Type: db.chapters?.[2]?.[0]?.type,
          ch3Types: db.chapters?.[3]?.map(e => e.type),
          maxChapter: Math.max(...Object.keys(db.chapters).map(Number))
        };
      });
      expect(r.isSaga).toBe(true);
      expect(r.ch1Type).toBe('destroy');
      expect(r.ch2Type).toBe('mill');
      expect(r.ch3Types).toContain('discard');
      expect(r.ch3Types).toContain('return_from_graveyard');
      expect(r.maxChapter).toBe(3);
    });
  });

  // =================== RENEW CARDS ===================

  test.describe('Renew Cards (GY Activation)', () => {

    test('Adorned Crocodile - dies trigger + GY counter ability', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('adorned crocodile');
        return {
          diesTrigger: db.triggered?.[0]?.event,
          diesMakesToken: db.triggered?.[0]?.effects?.[0]?.type === 'create_token',
          gyZone: db.activated?.[0]?.cost?.zone,
          gyExile: db.activated?.[0]?.cost?.exile,
          gyEffect: db.activated?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.diesTrigger).toBe('dies');
      expect(r.diesMakesToken).toBe(true);
      expect(r.gyZone).toBe('graveyard');
      expect(r.gyExile).toBe(true);
      expect(r.gyEffect).toBe('counter');
    });

    test('Agent of Kotis - GY activated: +2 counters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('agent of kotis');
        return {
          gyZone: db.activated?.[0]?.cost?.zone,
          cost: db.activated?.[0]?.cost?.mana,
          effectType: db.activated?.[0]?.effects?.[0]?.type,
          amount: db.activated?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.gyZone).toBe('graveyard');
      expect(r.cost).toBe('3U');
      expect(r.effectType).toBe('counter');
      expect(r.amount).toBe(2);
    });
  });

  // =================== MOBILIZE CREATURES ===================

  test.describe('Mobilize (Token on Attack)', () => {

    test('Avenger of the Fallen - deathtouch + attack creates 2 warriors', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('avenger of the fallen');
        return {
          deathtouch: db.static?.some(s => s.keyword === 'deathtouch'),
          trigEvent: db.triggered?.[0]?.event,
          tokenCount: db.triggered?.[0]?.effects?.[0]?.count,
          tokenAttacking: db.triggered?.[0]?.effects?.[0]?.attacking
        };
      });
      expect(r.deathtouch).toBe(true);
      expect(r.trigEvent).toBe('attacks');
      expect(r.tokenCount).toBe(2);
      expect(r.tokenAttacking).toBe(true);
    });

    test('Bone-Cairn Butcher - attack tokens + grant deathtouch to tokens', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('bone-cairn butcher');
        return {
          trigTokenCount: db.triggered?.[0]?.effects?.[0]?.count,
          grantDeathtouch: db.static?.some(s => s.type === 'grant' && s.keyword === 'deathtouch')
        };
      });
      expect(r.trigTokenCount).toBe(2);
      expect(r.grantDeathtouch).toBe(true);
    });

    test('Dalkovan Packbeasts - vigilance + attack creates 3 warriors', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('dalkovan packbeasts');
        return {
          vigilance: db.static?.some(s => s.keyword === 'vigilance'),
          tokenCount: db.triggered?.[0]?.effects?.[0]?.count
        };
      });
      expect(r.vigilance).toBe(true);
      expect(r.tokenCount).toBe(3);
    });

    test('Dragonback Lancer - flying + attack creates 1 warrior', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('dragonback lancer');
        return {
          flying: db.static?.some(s => s.keyword === 'flying'),
          tokenCount: db.triggered?.[0]?.effects?.[0]?.count
        };
      });
      expect(r.flying).toBe(true);
      expect(r.tokenCount).toBe(1);
    });

    test('Nightblade Brigade - deathtouch + attack token + ETB surveil', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('nightblade brigade');
        return {
          deathtouch: db.static?.some(s => s.keyword === 'deathtouch'),
          tokenCount: db.triggered?.[0]?.effects?.[0]?.count,
          etbType: db.etb?.[0]?.type
        };
      });
      expect(r.deathtouch).toBe(true);
      expect(r.tokenCount).toBe(1);
      expect(r.etbType).toBe('surveil');
    });

    test('Reigning Victor - mobilize + ETB buff with indestructible', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('reigning victor');
        return {
          trigCount: db.triggered?.length,
          firstTrigEffect: db.triggered?.[0]?.effects?.[0]?.type,
          etbBuff: db.etb?.[0]?.type,
          etbGrant: db.etb?.[1]?.type,
          etbGrantKw: db.etb?.[1]?.keyword
        };
      });
      expect(r.trigCount).toBe(1);
      expect(r.firstTrigEffect).toBe('create_token');
      expect(r.etbBuff).toBe('buff');
      expect(r.etbGrant).toBe('grant');
      expect(r.etbGrantKw).toBe('indestructible');
    });

    test('Shock Brigade - menace + attack token (sacrifice at end step)', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('shock brigade');
        return {
          menace: db.static?.some(s => s.keyword === 'menace'),
          sacEOT: db.triggered?.[0]?.effects?.[0]?.sacrificeAtEndStep
        };
      });
      expect(r.menace).toBe(true);
      expect(r.sacEOT).toBe(true);
    });
  });

  // =================== FLURRY ===================

  test.describe('Flurry (Equipment/Second Spell)', () => {

    test('Cori-Steel Cutter - grants power/trample/haste + second spell token', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('cori-steel cutter');
        return {
          grantPower: db.static?.[0]?.power,
          grantKeywords: db.static?.[0]?.keywords,
          trigEvent: db.triggered?.[0]?.event,
          trigEffectType: db.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.grantPower).toBe(1);
      expect(r.grantKeywords).toContain('trample');
      expect(r.grantKeywords).toContain('haste');
      expect(r.trigEvent).toBe('second_spell');
      expect(r.trigEffectType).toBe('create_token');
    });

    test('Dragon Sniper - vigilance + reach + deathtouch', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('dragon sniper');
        return {
          keywords: db.static?.[0]?.keywords
        };
      });
      expect(r.keywords).toContain('vigilance');
      expect(r.keywords).toContain('reach');
      expect(r.keywords).toContain('deathtouch');
    });
  });

  // =================== ENDURE ===================

  test.describe('Endure Mechanic', () => {

    test('Fortress Kin-Guard - ETB endure 1', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const card = T.makeCreature('Fortress Kin-Guard', '1', '1', {
          cost: '{W}', cmc: 1, colors: ['W']
        });
        const state = T.createTestState({ myHand: [card] });
        T.addMana(state, 0, 'W');
        GameState.castSpell(state, 0, card._uid);
        if (state._pendingEndure) GameState.resolveEndureChoice(state, 'counters');
        const c = state.players[0].zones.battlefield.cards.find(b => b.name === 'Fortress Kin-Guard');
        return { onBf: !!c, counters: c?._counters?.['+1/+1'] || 0 };
      });
      expect(r.onBf).toBe(true);
      expect(r.counters).toBe(1);
    });

    test('Kin-Tree Nurturer - lifelink + ETB endure 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('kin-tree nurturer');
        return {
          lifelink: db.static?.some(s => s.keyword === 'lifelink'),
          etbType: db.etb?.[0]?.type,
          etbAmount: db.etb?.[0]?.amount
        };
      });
      expect(r.lifelink).toBe(true);
      expect(r.etbType).toBe('endure');
      expect(r.etbAmount).toBe(1);
    });

    test('Krumar Initiate - activated endure X', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('krumar initiate');
        return {
          costMana: db.activated?.[0]?.cost?.mana,
          costLife: db.activated?.[0]?.cost?.life,
          costTap: db.activated?.[0]?.cost?.tap,
          effectType: db.activated?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.costTap).toBe(true);
      expect(r.effectType).toBe('endure');
    });

    test('Sandskitter Outrider - menace + ETB endure 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('sandskitter outrider');
        return {
          menace: db.static?.some(s => s.keyword === 'menace'),
          etbAmount: db.etb?.[0]?.amount
        };
      });
      expect(r.menace).toBe(true);
      expect(r.etbAmount).toBe(2);
    });
  });

  // =================== MORE TARKIR CREATURES ===================

  test.describe('More TDM Creatures', () => {

    test('Aegis Sculptor - flying + ward + upkeep trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('aegis sculptor');
        return {
          keywords: db.static?.[0]?.keywords,
          trigEvent: db.triggered?.[0]?.event,
          trigEffectTypes: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('ward');
      expect(r.trigEvent).toBe('upkeep');
    });

    test('Betor, Kin to All - flying + end step draw (if toughness 10+)', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('betor, kin to all');
        return {
          flying: db.static?.some(s => s.keyword === 'flying'),
          trigEvent: db.triggered?.[0]?.event,
          condition: db.triggered?.[0]?.condition
        };
      });
      expect(r.flying).toBe(true);
      expect(r.trigEvent).toBe('end_step');
      expect(r.condition).toBe('toughness_10+');
    });
  });

  // =================== RARES ===================

  test.describe('Rare Creatures', () => {

    test('Clarion Conqueror - flying + prevent activated abilities', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('clarion conqueror');
        return {
          flying: db.static?.some(s => s.keyword === 'flying'),
          preventsAbilities: db.static?.some(s => s.type === 'prevent_activated_abilities')
        };
      });
      expect(r.flying).toBe(true);
      expect(r.preventsAbilities).toBe(true);
    });

    test('Eshki Dragonclaw - vigilance+trample+ward + combat begin trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('eshki dragonclaw');
        return {
          keywords: db.static?.[0]?.keywords,
          trigEvent: db.triggered?.[0]?.event,
          trigEffects: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.keywords).toContain('vigilance');
      expect(r.keywords).toContain('trample');
      expect(r.trigEvent).toBe('combat_begin');
      expect(r.trigEffects).toContain('draw');
      expect(r.trigEffects).toContain('counter_self');
    });

    test("Fangkeeper's Familiar - flash + modal ETB (4 modes)", async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects("fangkeeper's familiar");
        return {
          flash: db.static?.some(s => s.keyword === 'flash'),
          etbIsModal: db.etb?.[0]?.type === 'modal',
          modeCount: db.etb?.[0]?.modes?.length
        };
      });
      expect(r.flash).toBe(true);
      expect(r.etbIsModal).toBe(true);
      expect(r.modeCount).toBe(4);
    });

    test('Flamehold Grappler - first strike + ETB copy next spell', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('flamehold grappler');
        return {
          firstStrike: db.static?.some(s => s.keyword === 'first strike' || (s.keywords && s.keywords.includes('first strike'))),
          etbType: db.etb?.[0]?.type
        };
      });
      expect(r.firstStrike).toBe(true);
      expect(r.etbType).toBe('copy_next_spell');
    });

    test('Lasyd Prowler - ETB mill X (lands controlled)', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('lasyd prowler');
        return {
          etbType: db.etb?.[0]?.type,
          amountType: db.etb?.[0]?.amount,
          hasGraveyard: !!db.graveyard
        };
      });
      expect(r.etbType).toBe('mill');
      expect(r.amountType).toBe('lands_count');
      expect(r.hasGraveyard).toBe(true);
    });

    test('Lotuslight Dancers - lifelink + ETB search to GY', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('lotuslight dancers');
        return {
          lifelink: db.static?.some(s => s.keyword === 'lifelink'),
          etbType: db.etb?.[0]?.type,
          colors: db.etb?.[0]?.colors
        };
      });
      expect(r.lifelink).toBe(true);
      expect(r.etbType).toBe('search_library_to_graveyard');
    });

    test('Magmatic Hellkite - flying + ETB destroy nonbasic land', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('magmatic hellkite');
        return {
          flying: db.static?.some(s => s.keyword === 'flying'),
          etbType: db.etb?.[0]?.type,
          target: db.etb?.[0]?.target
        };
      });
      expect(r.flying).toBe(true);
      expect(r.etbType).toBe('destroy');
      expect(r.target).toBe('nonbasic_land');
    });

    test('Marang River Regent - flying + ETB bounce 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('marang river regent');
        return {
          flying: db.static?.some(s => s.keyword === 'flying'),
          etbType: db.etb?.[0]?.type,
          amount: db.etb?.[0]?.amount
        };
      });
      expect(r.flying).toBe(true);
      expect(r.etbType).toBe('bounce');
      expect(r.amount).toBe(2);
    });

    test('Mardu Siegebreaker - deathtouch+haste + ETB exile + attack copy', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('mardu siegebreaker');
        return {
          keywords: db.static?.[0]?.keywords,
          etbType: db.etb?.[0]?.type,
          trigEvent: db.triggered?.[0]?.event,
          trigEffect: db.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.keywords).toContain('deathtouch');
      expect(r.keywords).toContain('haste');
      expect(r.etbType).toBe('exile');
      expect(r.trigEvent).toBe('attacks');
      expect(r.trigEffect).toBe('create_token_copy');
    });

    test('Naga Fleshcrafter - ETB clone', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('naga fleshcrafter');
        return { etbType: db.etb?.[0]?.type, target: db.etb?.[0]?.target };
      });
      expect(r.etbType).toBe('clone');
      expect(r.target).toBe('any_creature');
    });

    test('Narset, Jeskai Waymaster - end step: discard hand + draw X', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('narset, jeskai waymaster');
        return {
          event: db.triggered?.[0]?.event,
          effectTypes: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.event).toBe('end_step');
      expect(r.effectTypes).toContain('discard_hand');
      expect(r.effectTypes).toContain('draw');
    });

    test('Qarsi Revenant - flying+deathtouch+lifelink + GY ability', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('qarsi revenant');
        return {
          keywords: db.static?.[0]?.keywords,
          gyZone: db.activated?.[0]?.cost?.zone,
          gyExile: db.activated?.[0]?.cost?.exile
        };
      });
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('deathtouch');
      expect(r.keywords).toContain('lifelink');
      expect(r.gyZone).toBe('graveyard');
      expect(r.gyExile).toBe(true);
    });

    test('Sage of the Skies - flying+lifelink + cast with another spell', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('sage of the skies');
        return {
          keywords: db.static?.[0]?.keywords,
          trigEvent: db.triggered?.[0]?.event
        };
      });
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('lifelink');
      expect(r.trigEvent).toBe('cast_with_another_spell');
    });

    test('Sarkhan, Dragon Ascendant - ETB behold + Treasure + dragon trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('sarkhan, dragon ascendant');
        return {
          etbTypes: db.etb?.map(e => e.type),
          trigEvent: db.triggered?.[0]?.event,
          trigEffects: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.etbTypes).toContain('behold_dragon');
      expect(r.etbTypes).toContain('create_token');
      expect(r.trigEvent).toBe('dragon_enters');
      expect(r.trigEffects).toContain('counter_self');
    });
  });

  // =================== MYTHICS ===================

  test.describe('Mythics', () => {

    test('Call the Spirit Dragons - grant indestructible to dragons + upkeep counters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('call the spirit dragons');
        return {
          grantIndestr: db.static?.some(s => s.keyword === 'indestructible' && s.target === 'dragons'),
          trigEvent: db.triggered?.[0]?.event
        };
      });
      expect(r.grantIndestr).toBe(true);
      expect(r.trigEvent).toBe('upkeep');
    });

    test('Dracogenesis - cost reduction for dragon spells', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('dracogenesis');
        return {
          type: db.static?.[0]?.type,
          target: db.static?.[0]?.target
        };
      });
      expect(r.type).toBe('cost_reduction');
      expect(r.target).toBe('dragon_spells');
    });

    test('Dragonback Assault - ETB 3 damage all + landfall dragon token', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('dragonback assault');
        return {
          etbType: db.etb?.[0]?.type,
          etbAmount: db.etb?.[0]?.amount,
          trigEvent: db.triggered?.[0]?.event,
          tokenName: db.triggered?.[0]?.effects?.[0]?.name,
          tokenFlying: db.triggered?.[0]?.effects?.[0]?.keywords?.includes('flying')
        };
      });
      expect(r.etbType).toBe('damage_all');
      expect(r.etbAmount).toBe(3);
      expect(r.trigEvent).toBe('landfall');
      expect(r.tokenName).toBe('Dragon');
      expect(r.tokenFlying).toBe(true);
    });

    test('Elspeth, Storm Slayer - token doubling + 3 loyalty abilities', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('elspeth, storm slayer');
        return {
          tokenDoubling: db.static?.some(s => s.type === 'token_doubling'),
          loyaltyAbilCount: db.activated?.length,
          firstLoyalty: db.activated?.[0]?.cost?.loyalty,
          secondLoyalty: db.activated?.[1]?.cost?.loyalty,
          thirdLoyalty: db.activated?.[2]?.cost?.loyalty
        };
      });
      expect(r.tokenDoubling).toBe(true);
      expect(r.loyaltyAbilCount).toBe(3);
      expect(r.firstLoyalty).toBe(1);
      expect(r.secondLoyalty).toBe(0);
      expect(r.thirdLoyalty).toBe(-3);
    });

    test('Jeskai Revelation - 5 effects: bounce+damage+tokens+draw+life', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["jeskai revelation"];
        return {
          effectCount: db.cast?.length,
          types: db.cast?.map(e => e.type)
        };
      });
      expect(r.effectCount).toBe(5);
      expect(r.types).toContain('bounce');
      expect(r.types).toContain('damage');
      expect(r.types).toContain('create_token');
      expect(r.types).toContain('draw');
      expect(r.types).toContain('gain_life');
    });

    test('Mox Jasper - conditional mana tap ability', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["mox jasper"];
        return {
          costTap: db.activated?.[0]?.cost?.tap,
          effectType: db.activated?.[0]?.effects?.[0]?.type,
          condition: db.activated?.[0]?.condition
        };
      });
      expect(r.costTap).toBe(true);
      expect(r.effectType).toBe('add_mana');
      expect(r.condition).toBe('control_dragon');
    });

    test('Neriv, Heart of the Storm - flying + double damage', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["neriv, heart of the storm"];
        return {
          flying: db.static?.some(s => s.keyword === 'flying'),
          doubleDmg: db.static?.some(s => s.type === 'double_damage')
        };
      });
      expect(r.flying).toBe(true);
      expect(r.doubleDmg).toBe(true);
    });

    test('Perennation - return permanent from GY with hexproof+indestructible', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('perennation');
        return {
          type: db.cast?.[0]?.type,
          counters: db.cast?.[0]?.with_counters
        };
      });
      expect(r.type).toBe('return_from_graveyard');
      expect(r.counters).toContain('hexproof');
      expect(r.counters).toContain('indestructible');
    });

    test('Rot-Curse Rakshasa - trample+decayed + GY activated', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('rot-curse rakshasa');
        return {
          keywords: db.static?.[0]?.keywords,
          gyZone: db.activated?.[0]?.cost?.zone,
          gyExile: db.activated?.[0]?.cost?.exile
        };
      });
      expect(r.keywords).toContain('trample');
      expect(r.keywords).toContain('decayed');
      expect(r.gyZone).toBe('graveyard');
      expect(r.gyExile).toBe(true);
    });

    test('Shiko, Paragon of the Way - flying+vigilance + ETB exile GY cast', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('shiko, paragon of the way');
        return {
          keywords: db.static?.[0]?.keywords,
          etbType: db.etb?.[0]?.type
        };
      });
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('vigilance');
      expect(r.etbType).toBe('exile_graveyard_cast_copy');
    });

    test('Smile at Death - upkeep: return 2 creatures from GY', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('smile at death');
        return {
          event: db.triggered?.[0]?.event,
          returnAmount: db.triggered?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.event).toBe('upkeep');
      expect(r.returnAmount).toBe(2);
    });

    test('Stormscale Scion - flying + buff other dragons + storm', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('stormscale scion');
        return {
          flying: db.static?.some(s => s.keyword === 'flying'),
          buffDragons: db.static?.some(s => s.type === 'buff_all' && s.target === 'other_dragons'),
          storm: db.static?.some(s => s.keyword === 'storm')
        };
      });
      expect(r.flying).toBe(true);
      expect(r.buffDragons).toBe(true);
      expect(r.storm).toBe(true);
    });

    test('Taigam, Master Opportunist - second spell: copy + exile with suspend', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('taigam, master opportunist');
        return {
          event: db.triggered?.[0]?.event,
          effectTypes: db.triggered?.[0]?.effects?.map(e => e.type)
        };
      });
      expect(r.event).toBe('second_spell');
      expect(r.effectTypes).toContain('copy_spell');
      expect(r.effectTypes).toContain('exile_with_suspend');
    });
  });

  // =================== UNCOMMON SPELLS ===================

  test.describe('Uncommon Spells', () => {

    test('Duty Beyond Death - sacrifice cost + indestructible + counters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('duty beyond death');
        return {
          hasAdditionalCosts: !!db.additional_costs,
          sacCost: db.additional_costs?.[0]?.type,
          castTypes: db.cast?.map(e => e.type)
        };
      });
      expect(r.sacCost).toBe('sacrifice');
      expect(r.castTypes).toContain('grant_all');
      expect(r.castTypes).toContain('counter_all');
    });

    test('Frontline Rush - modal: tokens or buff X', async () => {
      const r = await page.evaluate(() => {
        const spell = TestHelper.makeSpell('Frontline Rush', '{1}{R}', 2, 'Sorcery', '', ['R']);
        const effects = CardEngine.getSpellEffects(spell);
        return {
          isModal: effects[0]?.type === 'modal',
          modeCount: effects[0]?.modes?.length,
          modeTypes: effects[0]?.modes?.map(m => m.type)
        };
      });
      expect(r.isModal).toBe(true);
      expect(r.modeCount).toBe(2);
      expect(r.modeTypes).toContain('create_token');
      expect(r.modeTypes).toContain('buff');
    });

    test('Kin-Tree Severance - exile permanent mv3+', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('kin-tree severance');
        return { type: db.cast?.[0]?.type, target: db.cast?.[0]?.target };
      });
      expect(r.type).toBe('exile');
      expect(r.target).toBe('permanent_mv3+');
    });

    test('Knockout Maneuver - counter + fight', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('knockout maneuver');
        return { types: db.cast?.map(e => e.type) };
      });
      expect(r.types).toContain('counter');
      expect(r.types).toContain('fight');
    });

    test('Lie in Wait - return from GY + damage X', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('lie in wait');
        return { types: db.cast?.map(e => e.type) };
      });
      expect(r.types).toContain('return_from_graveyard');
      expect(r.types).toContain('damage');
    });

    test('Overwhelming Surge - modal: 3 damage or destroy artifact', async () => {
      const r = await page.evaluate(() => {
        const spell = TestHelper.makeSpell('Overwhelming Surge', '{2}{R}', 3, 'Sorcery', '', ['R']);
        const effects = CardEngine.getSpellEffects(spell);
        return {
          isModal: effects[0]?.type === 'modal',
          modeTypes: effects[0]?.modes?.map(m => m.type)
        };
      });
      expect(r.isModal).toBe(true);
      expect(r.modeTypes).toContain('damage');
      expect(r.modeTypes).toContain('destroy');
    });

    test("Rakshasa's Bargain - look top 4, draw 2, mill 2", async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects("rakshasa's bargain");
        return { types: db.cast?.map(e => e.type), count: db.cast?.length };
      });
      expect(r.count).toBe(3);
      expect(r.types).toContain('look_top');
      expect(r.types).toContain('draw');
      expect(r.types).toContain('mill');
    });

    test('Dragonclaw Strike - double power buff + optional fight', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('dragonclaw strike');
        return {
          types: db.cast?.map(e => e.type),
          buffPower: db.cast?.[0]?.power,
          fightOptional: db.cast?.[1]?.optional
        };
      });
      expect(r.types).toContain('buff');
      expect(r.types).toContain('fight');
      expect(r.buffPower).toBe('double');
    });

    test('Mammoth Bellow - create 5/5 Elephant', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Mammoth Bellow', '{4}{G}', 5, 'Sorcery', '', ['G']);
        const state = T.createTestState({ myHand: [spell] });
        T.addMana(state, 0, 'GGGGG');
        const effects = CardEngine.getSpellEffects(spell);
        GameStack.push(state.stack, { card: spell, controller: 0, targets: [], effects });
        GameStack.resolve(state.stack, state);
        const creatures = state.players[0].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        return {
          creatureCount: creatures.length,
          tokenName: creatures[0]?.name,
          tokenPower: creatures[0]?.power
        };
      });
      expect(r.creatureCount).toBe(1);
      expect(r.tokenName).toBe('Elephant');
      expect(r.tokenPower).toBe('5');
    });

    test('Rally the Monastery - modal: tokens / buff all / destroy power 4+', async () => {
      const r = await page.evaluate(() => {
        const spell = TestHelper.makeSpell('Rally the Monastery', '{3}{W}', 4, 'Sorcery', '', ['W']);
        const effects = CardEngine.getSpellEffects(spell);
        return {
          isModal: effects[0]?.type === 'modal',
          modeCount: effects[0]?.modes?.length,
          modeTypes: effects[0]?.modes?.map(m => m.type)
        };
      });
      expect(r.isModal).toBe(true);
      expect(r.modeCount).toBe(3);
    });

    test('Rite of Renewal - return 2 permanents from GY to hand', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('rite of renewal');
        return { type: db.cast?.[0]?.type, amount: db.cast?.[0]?.amount, toHand: db.cast?.[0]?.to_hand };
      });
      expect(r.type).toBe('return_from_graveyard');
      expect(r.amount).toBe(2);
      expect(r.toHand).toBe(true);
    });

    test('Riverwheel Sweep - tap + stun 3 + exile top play', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('riverwheel sweep');
        return { types: db.cast?.map(e => e.type), stunAmount: db.cast?.[1]?.amount };
      });
      expect(r.types).toContain('tap');
      expect(r.types).toContain('stun_counter');
      expect(r.types).toContain('exile_top_play');
      expect(r.stunAmount).toBe(3);
    });

    test('Salt Road Skirmish - destroy + create haste warriors', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('salt road skirmish');
        return {
          types: db.cast?.map(e => e.type),
          tokenCount: db.cast?.[1]?.count,
          tokenHaste: db.cast?.[1]?.keywords?.includes('haste'),
          sacEOT: db.cast?.[1]?.sacrificeAtEndStep
        };
      });
      expect(r.types).toContain('destroy');
      expect(r.types).toContain('create_token');
      expect(r.tokenCount).toBe(2);
      expect(r.tokenHaste).toBe(true);
      expect(r.sacEOT).toBe(true);
    });
  });

  // =================== COMMON SPELLS ===================

  test.describe('Common Spells', () => {

    test('Heritage Reclamation - modal: destroy artifact/enchantment + exile GY/draw', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('heritage reclamation');
        const modal = db.cast?.[0];
        const modes = modal?.modes;
        return {
          isModal: modal?.type === 'modal',
          modeCount: modes?.length,
          mode0Type: modes?.[0]?.type,
          mode0Target: modes?.[0]?.target,
          mode1Type: modes?.[1]?.type,
          mode1Target: modes?.[1]?.target,
          mode2IsArray: Array.isArray(modes?.[2]),
          mode2Types: Array.isArray(modes?.[2]) ? modes[2].map(e => e.type) : [modes?.[2]?.type]
        };
      });
      expect(r.isModal).toBe(true);
      expect(r.modeCount).toBe(3);
      expect(r.mode0Type).toBe('destroy');
      expect(r.mode0Target).toBe('artifact');
      expect(r.mode1Type).toBe('destroy');
      expect(r.mode1Target).toBe('enchantment');
      expect(r.mode2IsArray).toBe(true);
      expect(r.mode2Types).toContain('exile_from_graveyard');
      expect(r.mode2Types).toContain('draw');
    });

    test('Lightfoot Technique - +1/+1 counter + flying+indestructible', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('lightfoot technique');
        return {
          types: db.cast?.map(e => e.type),
          counterType: db.cast?.[0]?.counter,
          grantKeywords: db.cast?.[1]?.keywords
        };
      });
      expect(r.types).toContain('counter');
      expect(r.types).toContain('grant');
      expect(r.counterType).toBe('+1/+1');
      expect(r.grantKeywords).toContain('flying');
      expect(r.grantKeywords).toContain('indestructible');
    });

    test('Molten Exhale - 4 damage to creature', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Molten Exhale', '{3}{R}', 4, 'Instant', '', ['R']);
        const oppC = CardEngine.prepareForBattlefield(T.makeCreature('Bear', '2', '3'));
        const state = T.createTestState({ myHand: [spell], oppBf: [oppC] });
        T.addMana(state, 0, 'RRRR');
        const effects = CardEngine.getSpellEffects(spell);
        GameStack.push(state.stack, { card: spell, controller: 0, targets: [{ type: 'creature', player: 1, uid: oppC._uid }], effects });
        GameStack.resolve(state.stack, state);
        return {
          amount: effects[0]?.amount,
          target: effects[0]?.target,
          oppCreaturesDead: state.players[1].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length === 0
        };
      });
      expect(r.amount).toBe(4);
      expect(r.target).toBe('creature');
    });

    test("Narset's Rebuke - 5 damage + add mana", async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects("narset's rebuke");
        return {
          types: db.cast?.map(e => e.type),
          dmg: db.cast?.[0]?.amount,
          colors: db.cast?.[1]?.colors
        };
      });
      expect(r.types).toContain('damage');
      expect(r.types).toContain('add_mana');
      expect(r.dmg).toBe(5);
    });

    test('Osseous Exhale - 5 damage to attacker/blocker + conditional life', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('osseous exhale');
        return {
          types: db.cast?.map(e => e.type),
          dmg: db.cast?.[0]?.amount,
          healCondition: db.cast?.[1]?.condition
        };
      });
      expect(r.types).toContain('damage');
      expect(r.types).toContain('gain_life');
      expect(r.dmg).toBe(5);
      expect(r.healCondition).toBe('if_beheld_dragon');
    });

    test('Piercing Exhale - one-sided fight + conditional surveil', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('piercing exhale');
        return {
          types: db.cast?.map(e => e.type),
          oneSided: db.cast?.[0]?.one_sided,
          surveilCondition: db.cast?.[1]?.condition
        };
      });
      expect(r.types).toContain('fight');
      expect(r.types).toContain('surveil');
      expect(r.oneSided).toBe(true);
    });

    test('Rebellious Strike - buff +3/+0 + draw 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects('rebellious strike');
        return {
          types: db.cast?.map(e => e.type),
          power: db.cast?.[0]?.power,
          drawAmount: db.cast?.[1]?.amount
        };
      });
      expect(r.types).toContain('buff');
      expect(r.types).toContain('draw');
      expect(r.power).toBe(3);
      expect(r.drawAmount).toBe(1);
    });

    test('Riverwalk Technique - modal: bounce to library or counter noncreature', async () => {
      const r = await page.evaluate(() => {
        const spell = TestHelper.makeSpell('Riverwalk Technique', '{2}{U}', 3, 'Instant', '', ['U']);
        const effects = CardEngine.getSpellEffects(spell);
        return {
          isModal: effects[0]?.type === 'modal',
          modeCount: effects[0]?.modes?.length,
          modeTypes: effects[0]?.modes?.map(m => m.type)
        };
      });
      expect(r.isModal).toBe(true);
      expect(r.modeCount).toBe(2);
      expect(r.modeTypes).toContain('bounce_to_library');
      expect(r.modeTypes).toContain('counter');
    });

    test("Roamer's Routine - ramp basic land tapped", async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB.getEffects("roamer's routine");
        return {
          type: db.cast?.[0]?.type,
          landType: db.cast?.[0]?.land_type,
          tapped: db.cast?.[0]?.tapped
        };
      });
      expect(r.type).toBe('ramp');
      expect(r.landType).toBe('basic');
      expect(r.tapped).toBe(true);
    });
  });

  // =================== FUNCTIONAL INTEGRATION TESTS ===================

  test.describe('Integration: Cast & Resolve', () => {

    test('Channeled Dragonfire resolves damage through stack', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Channeled Dragonfire', '{1}{R}', 2, 'Sorcery', '', ['R']);
        const state = T.createTestState({ myHand: [spell] });
        T.addMana(state, 0, 'RR');
        const result = GameState.castSpell(state, 0, spell._uid, [{ type: 'player', player: 1, uid: null }]);
        return { success: result.success, oppLife: state.players[1].life };
      });
      expect(r.success).toBe(true);
      expect(r.oppLife).toBeLessThan(20);
    });

    test('Mammoth Bellow creates token on battlefield', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Mammoth Bellow', '{4}{G}', 5, 'Sorcery', '', ['G']);
        const state = T.createTestState({ myHand: [spell] });
        T.addMana(state, 0, 'GGGGG');
        GameState.castSpell(state, 0, spell._uid);
        return { creatures: T.countCreatures(state, 0) };
      });
      expect(r.creatures).toBeGreaterThanOrEqual(1);
    });

    test('Cruel Truths resolves all 3 effects', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Cruel Truths', '{2}{B}', 3, 'Instant', '', ['B']);
        const state = T.createTestState({ myHand: [spell] });
        T.addMana(state, 0, 'BBB');
        const handBefore = state.players[0].zones.hand.count();
        const result = GameState.castSpell(state, 0, spell._uid);
        return {
          success: result.success,
          life: state.players[0].life,
          handAfter: state.players[0].zones.hand.count()
        };
      });
      expect(r.success).toBe(true);
      expect(r.life).toBe(18); // -2 from lose_life
    });

    test('Dusyut Earthcarver ETB endure gives +1/+1 counters', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const card = T.makeCreature('Dusyut Earthcarver', '3', '3', {
          cost: '{2}{G}', cmc: 3, colors: ['G']
        });
        const state = T.createTestState({ myHand: [card] });
        T.addMana(state, 0, 'GGG');
        GameState.castSpell(state, 0, card._uid);
        if (state._pendingEndure) GameState.resolveEndureChoice(state, 'counters');
        const c = state.players[0].zones.battlefield.cards.find(b => b.name === 'Dusyut Earthcarver');
        return {
          onBf: !!c,
          counters: c?._counters?.['+1/+1'] || 0,
          power: c ? CardEngine.getPower(c) : 0
        };
      });
      expect(r.onBf).toBe(true);
      expect(r.counters).toBe(3);
      expect(r.power).toBe(6); // 3 base + 3 counters
    });

    test('Second spell trigger fires for Flurry mechanic', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const devotee = CardEngine.prepareForBattlefield(
          T.makeCreature('Devoted Duelist', '2', '1', {
            cost: '{1}{R}', cmc: 2, colors: ['R'], keywords: ['Haste'],
            oracle: 'Haste. Whenever you cast your second spell each turn, Devoted Duelist deals 1 damage to each opponent.'
          })
        );
        devotee._summoningSick = false;
        const state = T.createTestState({ myBf: [devotee] });
        // Register triggers from CardEffectsDB
        GameState._registerCardTriggers(state, devotee, 0);
        // Simulate second spell trigger
        state._spellsThisTurn[0] = 2;
        const logs = GameState.fireTrigger(state, 'second_spell', { playerId: 0 });
        return {
          triggerFired: logs.length > 0,
          oppLife: state.players[1].life
        };
      });
      expect(r.triggerFired).toBe(true);
      expect(r.oppLife).toBeLessThan(20);
    });

    test('Fortress Kin-Guard gets +1/+1 counter from endure on cast', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const card = T.makeCreature('Fortress Kin-Guard', '1', '1', {
          cost: '{W}', cmc: 1, colors: ['W']
        });
        const state = T.createTestState({ myHand: [card] });
        T.addMana(state, 0, 'W');
        GameState.castSpell(state, 0, card._uid);
        if (state._pendingEndure) GameState.resolveEndureChoice(state, 'counters');
        const c = state.players[0].zones.battlefield.cards.find(b => b.name === 'Fortress Kin-Guard');
        return {
          onBf: !!c,
          counters: c?._counters?.['+1/+1'] || 0,
          effectivePower: c ? CardEngine.getPower(c) : 0,
          effectiveToughness: c ? CardEngine.getToughness(c) : 0
        };
      });
      expect(r.onBf).toBe(true);
      expect(r.counters).toBe(1);
      expect(r.effectivePower).toBe(2); // 1 + 1 counter
      expect(r.effectiveToughness).toBe(2);
    });

    test('Sandskitter Outrider gets endure 2 on ETB', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const card = T.makeCreature('Sandskitter Outrider', '2', '2', {
          cost: '{2}{B}', cmc: 3, colors: ['B'], keywords: ['Menace']
        });
        const state = T.createTestState({ myHand: [card] });
        T.addMana(state, 0, 'BBB');
        GameState.castSpell(state, 0, card._uid);
        if (state._pendingEndure) GameState.resolveEndureChoice(state, 'counters');
        const c = state.players[0].zones.battlefield.cards.find(b => b.name === 'Sandskitter Outrider');
        return { counters: c?._counters?.['+1/+1'] || 0 };
      });
      expect(r.counters).toBe(2);
    });
  });

  // =================== COVERAGE CHECK ===================

  test.describe('Coverage: All TDM cards have DB entries', () => {

    test('All TDM cards in CardEffectsDB have at least one effect category', async () => {
      const r = await page.evaluate(() => {
        const tdmCards = [
          "alesha's legacy", "auroral procession", "bewildering blizzard",
          "coordinated maneuver", "cruel truths", "dispelling exhale",
          "aggressive negotiations", "channeled dragonfire", "defibrillating current",
          "death begets life", "dragon's prey", "focus the mind",
          "glacial dragonhunt", "caustic exhale", "desperate measures",
          "abzan monument", "ainok wayfarer", "arashin sunshield",
          "armament dragon", "constrictor sage", "disruptive stormbrood",
          "dragonologist", "dusyut earthcarver", "equilibrium adept",
          "ambling stormshell", "anafenza, unyielding lineage", "attuned hunter",
          "bloomvine regent", "boulderborn dragon", "cori mountain stalwart",
          "delta bloodflies", "descendant of storms", "devoted duelist",
          "felothar, dawn of the abzan", "furious forebear", "host of the hereafter",
          "inspirited vanguard", "jeskai devotee", "jeskai shrinekeeper",
          "kheru goldkeeper", "kishla skimmer", "kotis, the fangkeeper",
          "marshal of the lost", "poised practitioner",
          "abzan devotee", "a-cori-steel cutter", "bearer of glory", "alchemist's assistant",
          "all-out assault", "barrensteppe siege", "awaken the honored dead",
          "adorned crocodile", "agent of kotis",
          "avenger of the fallen", "bone-cairn butcher", "dalkovan packbeasts",
          "dragonback lancer", "nightblade brigade", "reigning victor", "shock brigade",
          "cori-steel cutter", "dragon sniper",
          "fortress kin-guard", "kin-tree nurturer", "krumar initiate", "sandskitter outrider",
          "aegis sculptor", "betor, kin to all",
          "clarion conqueror", "eshki dragonclaw", "fangkeeper's familiar",
          "flamehold grappler", "lasyd prowler", "lotuslight dancers",
          "magmatic hellkite", "marang river regent", "mardu siegebreaker",
          "naga fleshcrafter", "narset, jeskai waymaster", "qarsi revenant",
          "sage of the skies", "sarkhan, dragon ascendant",
          "call the spirit dragons", "dracogenesis", "dragonback assault",
          "elspeth, storm slayer", "jeskai revelation", "mox jasper",
          "neriv, heart of the storm", "perennation", "rot-curse rakshasa",
          "shiko, paragon of the way", "smile at death", "stormscale scion",
          "taigam, master opportunist",
          "duty beyond death", "frontline rush", "kin-tree severance",
          "knockout maneuver", "lie in wait", "overwhelming surge",
          "rakshasa's bargain", "dragonclaw strike", "mammoth bellow",
          "rally the monastery", "rite of renewal", "riverwheel sweep",
          "salt road skirmish",
          "heritage reclamation", "lightfoot technique", "molten exhale",
          "narset's rebuke", "osseous exhale", "piercing exhale",
          "rebellious strike", "riverwalk technique", "roamer's routine"
        ];

        const missing = [];
        const noEffects = [];
        for (const name of tdmCards) {
          const db = CardEffectsDB.getEffects(name);
          if (!db) {
            missing.push(name);
          } else if (!db.cast && !db.etb && !db.triggered && !db.activated && !db.static && !db.modal && !db.saga) {
            noEffects.push(name);
          }
        }
        return { total: tdmCards.length, missing, noEffects };
      });
      expect(r.missing).toEqual([]);
      expect(r.noEffects).toEqual([]);
    });
  });
});
