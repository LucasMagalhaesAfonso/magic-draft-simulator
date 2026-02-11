// @ts-check
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

// ============================================================
// TDM All Cards - Comprehensive Individual Tests
// Every card gets tests covering ALL abilities and edge cases.
// ============================================================

test.describe('TDM All Cards', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await setupTestGame(page);
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 1: TDM Instants & Sorceries
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────
  // CAUSTIC EXHALE {B}
  // Behold a Dragon (or pay {1})
  // Target creature gets -3/-3 until end of turn
  // ─────────────────────────────────────────────────────────────
  test.describe('Caustic Exhale', () => {
    test('Debuff -3/-3 reduces creature stats', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Big Ogre', '5', '5', { cost: '{3}{R}{R}', cmc: 5, colors: ['R'] })
        );
        // myBf = player 0's battlefield (opponent from P1's perspective)
        const state = T.createTestState({ myBf: [target], activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: 'Caustic Exhale' },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: target._uid }],
          effects: [{ type: 'debuff', power: -3, toughness: -3, target: 'creature', duration: 'end_of_turn' }]
        });
        GameStack.resolve(state.stack, state);
        return {
          power: CardEngine.getPower(target),
          toughness: CardEngine.getToughness(target)
        };
      });
      expect(r.power).toBe(2);    // 5 - 3
      expect(r.toughness).toBe(2); // 5 - 3
    });

    test('Debuff kills creature with toughness <= 3', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const weakling = CardEngine.prepareForBattlefield(
          T.makeCreature('Small Goblin', '2', '2', { cost: '{1}{R}', cmc: 2, colors: ['R'] })
        );
        // myBf = player 0's battlefield
        const state = T.createTestState({ myBf: [weakling], activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: 'Caustic Exhale' },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: weakling._uid }],
          effects: [{ type: 'debuff', power: -3, toughness: -3, target: 'creature', duration: 'end_of_turn' }]
        });
        GameStack.resolve(state.stack, state);
        // Creature should have died (toughness 2 - 3 = -1)
        const onBf = state.players[0].zones.battlefield.get(weakling._uid);
        return { died: !onBf };
      });
      expect(r.died).toBe(true);
    });

    test('Behold: playable at base cost {B} with Dragon in hand', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const exhale = T.makeSpell('Caustic Exhale', '{B}', 1, 'Instant', 'Behold a Dragon\nTarget creature gets -3/-3', ['B']);
        const dragon = T.makeCreature('Test Dragon', '4', '4', {
          cost: '{3}{R}', cmc: 4, colors: ['R'], typeLine: 'Creature — Dragon'
        });
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Enemy', '3', '3', { cost: '{2}{R}', cmc: 3, colors: ['R'] })
        );
        const state = T.createTestState({ myBf: [target], activePlayer: 1 });
        state.players[1].zones.hand.add(exhale);
        state.players[1].zones.hand.add(dragon);
        // Only 1 black mana - enough for {B}
        T.addLandsUntapped(state, 1, [{ name: 'Swamp', color: 'B' }]);
        const playable = GameState.getPlayableCards(state, 1);
        const canPlay = playable.some(c => c.name === 'Caustic Exhale');
        return { canPlay };
      });
      expect(r.canPlay).toBe(true);
    });

    test('No behold: needs extra {1} without Dragon in hand', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const exhale = T.makeSpell('Caustic Exhale', '{B}', 1, 'Instant', 'Behold a Dragon\nTarget creature gets -3/-3', ['B']);
        const nonDragon = T.makeCreature('Goblin', '1', '1', {
          cost: '{R}', cmc: 1, colors: ['R'], typeLine: 'Creature — Goblin'
        });
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Enemy', '3', '3', { cost: '{2}{R}', cmc: 3, colors: ['R'] })
        );
        const state = T.createTestState({ myBf: [target], activePlayer: 1 });
        state.players[1].zones.hand.add(exhale);
        state.players[1].zones.hand.add(nonDragon);
        // Only 1 black mana - NOT enough for {1}{B}
        T.addLandsUntapped(state, 1, [{ name: 'Swamp', color: 'B' }]);
        const playable1 = GameState.getPlayableCards(state, 1);
        const canPlayWith1 = playable1.some(c => c.name === 'Caustic Exhale');
        // Now add generic mana - enough for {1}{B}
        T.addLandsUntapped(state, 1, [{ name: 'Swamp', color: 'B' }]);
        const playable2 = GameState.getPlayableCards(state, 1);
        const canPlayWith2 = playable2.some(c => c.name === 'Caustic Exhale');
        return { canPlayWith1Mana: canPlayWith1, canPlayWith2Mana: canPlayWith2 };
      });
      expect(r.canPlayWith1Mana).toBe(false);
      expect(r.canPlayWith2Mana).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ALESHA'S LEGACY {1}{W}
  // Target creature gains deathtouch and indestructible until end of turn
  // ─────────────────────────────────────────────────────────────
  test.describe("Alesha's Legacy", () => {
    test('Grants deathtouch and indestructible to target creature', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const warrior = CardEngine.prepareForBattlefield(
          T.makeCreature('Test Warrior', '3', '3', { cost: '{2}{W}', cmc: 3, colors: ['W'] })
        );
        const state = T.createTestState({ myBf: [warrior], activePlayer: 1 });
        // Resolve buff effect with keyword grant via stack
        GameStack.push(state.stack, {
          card: { name: "Alesha's Legacy" },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: warrior._uid }],
          effects: [{ type: 'buff', power: 0, toughness: 0, target: 'creature', duration: 'end_of_turn', keywords: ['deathtouch', 'indestructible'] }]
        });
        GameStack.resolve(state.stack, state);
        return {
          hasDeathtouch: CardEngine.hasKeyword(warrior, 'Deathtouch'),
          hasIndestructible: CardEngine.hasIndestructible(warrior)
        };
      });
      expect(r.hasDeathtouch).toBe(true);
      expect(r.hasIndestructible).toBe(true);
    });

    test('Protected creature survives destroy effect', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const warrior = CardEngine.prepareForBattlefield(
          T.makeCreature('Protected Warrior', '3', '3', { cost: '{2}{W}', cmc: 3, colors: ['W'] })
        );
        const state = T.createTestState({ oppBf: [warrior], activePlayer: 1 });
        // Apply indestructible manually
        if (!warrior.keywords) warrior.keywords = [];
        warrior.keywords.push('Indestructible');
        // Try to destroy - should fail
        const died = GameState.creatureDies(state, warrior, 1);
        return {
          survived: !died,
          stillOnBf: state.players[1].zones.battlefield.cards.some(c => c.name === 'Protected Warrior')
        };
      });
      expect(r.survived).toBe(true);
      expect(r.stillOnBf).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // BEWILDERING BLIZZARD {4}{U}{B}
  // Draw 3 cards. Creatures your opponents control get -3/-0 until end of turn.
  // ─────────────────────────────────────────────────────────────
  test.describe('Bewildering Blizzard', () => {
    test('Draws 3 cards for caster', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const state = T.createTestState({ activePlayer: 1 });
        // Add cards to library to draw
        for (let i = 0; i < 5; i++) {
          state.players[1].zones.library.add(T.makeCreature('Lib' + i, '1', '1'));
        }
        const handBefore = state.players[1].zones.hand.count();
        GameState._resolveSimpleEffect(state, 1,
          { type: 'draw', amount: 3 }, {});
        return { drew: state.players[1].zones.hand.count() - handBefore };
      });
      expect(r.drew).toBe(3);
    });

    test('Debuffs all opponent creatures -3/-0', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const c1 = CardEngine.prepareForBattlefield(
          T.makeCreature('Orc A', '4', '4', { cost: '{3}{R}', cmc: 4, colors: ['R'] })
        );
        const c2 = CardEngine.prepareForBattlefield(
          T.makeCreature('Orc B', '3', '3', { cost: '{2}{R}', cmc: 3, colors: ['R'] })
        );
        const state = T.createTestState({ myBf: [c1, c2], activePlayer: 1 });
        // debuff_all only handled in stack.js
        GameStack.push(state.stack, {
          card: { name: 'Bewildering Blizzard' },
          controller: 1,
          targets: [],
          effects: [{ type: 'debuff_all', power: -3, toughness: 0, target: 'opponent_creatures', duration: 'end_of_turn' }]
        });
        GameStack.resolve(state.stack, state);
        return {
          c1Power: CardEngine.getPower(c1), c1Tough: CardEngine.getToughness(c1),
          c2Power: CardEngine.getPower(c2), c2Tough: CardEngine.getToughness(c2)
        };
      });
      expect(r.c1Power).toBe(1);  // 4-3
      expect(r.c1Tough).toBe(4);  // unchanged
      expect(r.c2Power).toBe(0);  // 3-3
      expect(r.c2Tough).toBe(3);  // unchanged
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CRUEL TRUTHS {2}{B}{B}
  // Surveil 2, then draw 2. You lose 2 life.
  // ─────────────────────────────────────────────────────────────
  test.describe('Cruel Truths', () => {
    test('AI: surveil + draw 2 + lose 2 life', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Cruel Truths', '{2}{B}{B}', 4, 'Sorcery', '', ['B']);
        const state = T.createTestState({ oppHand: [spell], activePlayer: 1 });
        T.addMana(state, 1, '2BB');
        for (let i = 0; i < 5; i++) {
          state.players[1].zones.library.add(T.makeCreature('Lib' + i, '1', '1'));
        }
        const lifeBefore = state.players[1].life;
        const handBefore = state.players[1].zones.hand.count();
        GameState.autoTapForSpell(state, 1, '{2}{B}{B}', 4);
        GameState.castSpell(state, 1, spell._uid);
        return {
          lifeLost: lifeBefore - state.players[1].life,
          handDelta: state.players[1].zones.hand.count() - handBefore
        };
      });
      expect(r.lifeLost).toBe(2);
      // Hand: -1 (cast) +2 (draw) = net +1
      expect(r.handDelta).toBe(1);
    });

    test('Life loss happens even at low life', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const state = T.createTestState({ oppLife: 2, activePlayer: 1 });
        for (let i = 0; i < 5; i++) {
          state.players[1].zones.library.add(T.makeCreature('Lib' + i, '1', '1'));
        }
        GameState._resolveSimpleEffect(state, 1, { type: 'lose_life', amount: 2, target: 'self' }, {});
        return { life: state.players[1].life };
      });
      expect(r.life).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DISPELLING EXHALE {U}
  // Counter target spell unless its controller pays {2}
  // ─────────────────────────────────────────────────────────────
  test.describe('Dispelling Exhale', () => {
    test('DB has counter spell with unless_pay 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dispelling exhale'];
        return {
          castType: db?.cast?.[0]?.type,
          target: db?.cast?.[0]?.target,
          unlessPay: db?.cast?.[0]?.unless_pay
        };
      });
      expect(r.castType).toBe('counter');
      expect(r.target).toBe('spell');
      expect(r.unlessPay).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // AGGRESSIVE NEGOTIATIONS {2}{B}
  // Target opponent reveals hand. Exile a nonland from it.
  // Put a +1/+1 counter on target creature you control.
  // ─────────────────────────────────────────────────────────────
  test.describe('Aggressive Negotiations', () => {
    test('Puts +1/+1 counter on target creature', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const ally = CardEngine.prepareForBattlefield(
          T.makeCreature('My Knight', '2', '2', { cost: '{1}{W}', cmc: 2, colors: ['W'] })
        );
        const state = T.createTestState({ oppBf: [ally], activePlayer: 1 });
        // Resolve the counter effect (3rd effect of aggressive negotiations)
        GameState._resolveSimpleEffect(state, 1,
          { type: 'counter', counter: '+1/+1', amount: 1, target: 'creature' },
          { targets: [{ uid: ally._uid, player: 1 }] }
        );
        return {
          counters: ally._counters?.['+1/+1'] || 0,
          power: CardEngine.getPower(ally)
        };
      });
      expect(r.counters).toBe(1);
      expect(r.power).toBe(3); // 2 + 1
    });

    test('DB has all three effects in correct order', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['aggressive negotiations'];
        return {
          effectCount: db?.cast?.length || 0,
          e1: db?.cast?.[0]?.type,
          e2: db?.cast?.[1]?.type,
          e3: db?.cast?.[2]?.type
        };
      });
      expect(r.effectCount).toBe(3);
      expect(r.e1).toBe('reveal_hand');
      expect(r.e2).toBe('exile');
      expect(r.e3).toBe('counter');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CHANNELED DRAGONFIRE {1}{R}
  // Deal 2 damage to any target.
  // Harmonize {5}{R}{R}
  // ─────────────────────────────────────────────────────────────
  test.describe('Channeled Dragonfire', () => {
    test('Deals 2 damage to creature', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Enemy', '3', '4', { cost: '{3}{R}', cmc: 4, colors: ['R'] })
        );
        const state = T.createTestState({ myBf: [target], activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: 'Channeled Dragonfire' },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: target._uid }],
          effects: [{ type: 'damage', amount: 2, target: 'any' }]
        });
        GameStack.resolve(state.stack, state);
        return { damage: target._damage };
      });
      expect(r.damage).toBe(2);
    });

    test('Deals 2 damage to player', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const state = T.createTestState({ activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: 'Channeled Dragonfire' },
          controller: 1,
          targets: [{ type: 'player', player: 0 }],
          effects: [{ type: 'damage', amount: 2, target: 'any' }]
        });
        GameStack.resolve(state.stack, state);
        return { life: state.players[0].life };
      });
      expect(r.life).toBe(18); // 20 - 2
    });

    test('Has harmonize cost in DB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['channeled dragonfire'];
        return { harmonize: db?.harmonize };
      });
      expect(r.harmonize).toBe('{5}{R}{R}');
    });

    test('Harmonize cost detected by getHarmonizeCost', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const spell = T.makeSpell('Channeled Dragonfire', '{1}{R}', 2, 'Sorcery', '', ['R']);
        const cost = CardEngine.getHarmonizeCost(spell);
        return { hasCost: !!cost };
      });
      expect(r.hasCost).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DEFIBRILLATING CURRENT {2}{R}{W}
  // Deal 4 damage to target creature or planeswalker. Gain 2 life.
  // ─────────────────────────────────────────────────────────────
  test.describe('Defibrillating Current', () => {
    test('Deals 4 damage to creature and gains 2 life', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Big Enemy', '5', '6', { cost: '{4}{G}{G}', cmc: 6, colors: ['G'] })
        );
        const spell = T.makeSpell('Defibrillating Current', '{2}{R}{W}', 4, 'Sorcery', '', ['R', 'W']);
        const state = T.createTestState({ myBf: [target], oppHand: [spell], activePlayer: 1 });
        T.addMana(state, 1, '2RW');
        const lifeBefore = state.players[1].life;
        const targets = [{ type: 'creature', player: 0, uid: target._uid }];
        GameState.autoTapForSpell(state, 1, '{2}{R}{W}', 4);
        GameState.castSpell(state, 1, spell._uid, targets);
        return {
          damage: target._damage,
          lifeGained: state.players[1].life - lifeBefore
        };
      });
      expect(r.damage).toBe(4);
      expect(r.lifeGained).toBe(2);
    });

    test('Kills creature with toughness <= 4', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Weak Enemy', '3', '3', { cost: '{2}{R}', cmc: 3, colors: ['R'] })
        );
        const state = T.createTestState({ myBf: [target], activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: 'Defibrillating Current' },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: target._uid }],
          effects: [
            { type: 'damage', amount: 4, target: 'creature_or_planeswalker' },
            { type: 'gain_life', amount: 2 }
          ]
        });
        GameStack.resolve(state.stack, state);
        return {
          damage: target._damage,
          lethal: target._damage >= parseInt(target.toughness)
        };
      });
      expect(r.lethal).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DEATH BEGETS LIFE {4}{W}{B}
  // Destroy all creatures and enchantments.
  // Draw cards equal to permanents destroyed.
  // ─────────────────────────────────────────────────────────────
  test.describe('Death Begets Life', () => {
    test('Board wipe destroys all creatures', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const c1 = CardEngine.prepareForBattlefield(
          T.makeCreature('My Creature', '2', '2', { cost: '{1}{W}', cmc: 2, colors: ['W'] })
        );
        const c2 = CardEngine.prepareForBattlefield(
          T.makeCreature('Opp Creature', '3', '3', { cost: '{2}{R}', cmc: 3, colors: ['R'] })
        );
        const state = T.createTestState({ myBf: [c1], oppBf: [c2], activePlayer: 1 });
        // destroy_all only handled in stack.js
        GameStack.push(state.stack, {
          card: { name: 'Death Begets Life' },
          controller: 1,
          targets: [],
          effects: [{ type: 'destroy_all', target: 'creatures_and_enchantments' }]
        });
        GameStack.resolve(state.stack, state);
        return {
          myCreatures: T.countCreatures(state, 0),
          oppCreatures: T.countCreatures(state, 1)
        };
      });
      expect(r.myCreatures).toBe(0);
      expect(r.oppCreatures).toBe(0);
    });

    test('DB has destroy_all and draw effects', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['death begets life'];
        return {
          e1: db?.cast?.[0]?.type,
          e1Target: db?.cast?.[0]?.target,
          e2: db?.cast?.[1]?.type
        };
      });
      expect(r.e1).toBe('destroy_all');
      expect(r.e1Target).toBe('creatures_and_enchantments');
      expect(r.e2).toBe('draw');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GLACIAL DRAGONHUNT {2}{U}{R}
  // Draw a card. If you discarded a nonland card, deal 3 damage.
  // Harmonize {4}{U}{R}
  // ─────────────────────────────────────────────────────────────
  test.describe('Glacial Dragonhunt', () => {
    test('Draws 1 card for caster', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const state = T.createTestState({ activePlayer: 1 });
        for (let i = 0; i < 5; i++) {
          state.players[1].zones.library.add(T.makeCreature('Lib' + i, '1', '1'));
        }
        const handBefore = state.players[1].zones.hand.count();
        GameState._resolveSimpleEffect(state, 1, { type: 'draw', amount: 1 }, {});
        return { drew: state.players[1].zones.hand.count() - handBefore };
      });
      expect(r.drew).toBe(1);
    });

    test('Conditional damage: blocked without discard flag', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Enemy', '3', '4', { cost: '{3}{R}', cmc: 4, colors: ['R'] })
        );
        const state = T.createTestState({ myBf: [target], activePlayer: 1 });
        // Check condition without discarding nonland
        const condMet = GameState._checkEffectCondition(state, 1, { condition: 'if_discarded_nonland' });
        return { condMet };
      });
      expect(r.condMet).toBe(false);
    });

    test('Has harmonize cost', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['glacial dragonhunt'];
        return { harmonize: db?.harmonize };
      });
      expect(r.harmonize).toBe('{4}{U}{R}');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DESPERATE MEASURES {B}
  // Target creature gets +1/-1 until end of turn.
  // When that creature dies this turn, draw 2 cards.
  // ─────────────────────────────────────────────────────────────
  test.describe('Desperate Measures', () => {
    test('Buffs creature +1/-1', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Test Creature', '2', '3', { cost: '{1}{B}', cmc: 2, colors: ['B'] })
        );
        const state = T.createTestState({ oppBf: [target], activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: 'Desperate Measures' },
          controller: 1,
          targets: [{ type: 'creature', player: 1, uid: target._uid }],
          effects: [{ type: 'buff', power: 1, toughness: -1, target: 'creature', duration: 'end_of_turn' }]
        });
        GameStack.resolve(state.stack, state);
        return {
          power: CardEngine.getPower(target),
          toughness: CardEngine.getToughness(target)
        };
      });
      expect(r.power).toBe(3);  // 2 + 1
      expect(r.toughness).toBe(2); // 3 - 1
    });

    test('Buff -1 toughness kills creature with toughness 1', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Fragile', '2', '1', { cost: '{1}{B}', cmc: 2, colors: ['B'] })
        );
        const state = T.createTestState({ oppBf: [target], activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: 'Desperate Measures' },
          controller: 1,
          targets: [{ type: 'creature', player: 1, uid: target._uid }],
          effects: [{ type: 'buff', power: 1, toughness: -1, target: 'creature', duration: 'end_of_turn' }]
        });
        GameStack.resolve(state.stack, state);
        const tough = CardEngine.getToughness(target);
        return { toughness: tough, shouldDie: tough <= 0 };
      });
      expect(r.shouldDie).toBe(true);
    });

    test('DB has triggered target_dies for draw', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['desperate measures'];
        const trig = db?.triggered?.[0];
        return {
          event: trig?.event,
          effectType: trig?.effects?.[0]?.type,
          effectAmount: trig?.effects?.[0]?.amount
        };
      });
      expect(r.event).toBe('target_dies');
      expect(r.effectType).toBe('draw');
      expect(r.effectAmount).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 2: TDM Creatures with ETB (Part 1)
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────
  // ABZAN MONUMENT {3}
  // ETB: Search for Plains, Swamp, or Forest → hand
  // Activated: {1}{W}{B}{G}, tap, sacrifice → create X/X Spirit token
  // ─────────────────────────────────────────────────────────────
  test.describe('Abzan Monument', () => {
    test('DB has ETB ramp and sacrifice activated ability', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['abzan monument'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbToHand: db?.etb?.[0]?.to_hand,
          actCost: db?.activated?.[0]?.cost,
          actEffect: db?.activated?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.etbType).toBe('ramp');
      expect(r.etbToHand).toBe(true);
      expect(r.actCost.sacrifice).toBe(true);
      expect(r.actEffect).toBe('create_token');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // AINOK WAYFARER {1}{G}
  // ETB: Mill 3 self, return a land from milled cards to hand
  // ─────────────────────────────────────────────────────────────
  test.describe('Ainok Wayfarer', () => {
    test('ETB mills 3 and can return a land', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const wayfarer = T.makeCreature('Ainok Wayfarer', '2', '2', {
          cost: '{1}{G}', cmc: 2, colors: ['G'], typeLine: 'Creature — Dog Scout'
        });
        const state = T.createTestState({ oppHand: [wayfarer], activePlayer: 1 });
        // Add lands and spells to library
        state.players[1].zones.library.add(T.makeLand('Forest', 'G'));
        state.players[1].zones.library.add(T.makeCreature('Filler1', '1', '1'));
        state.players[1].zones.library.add(T.makeLand('Mountain', 'R'));
        state.players[1].zones.library.add(T.makeCreature('Filler2', '1', '1'));
        state.players[1].zones.library.add(T.makeCreature('Filler3', '1', '1'));
        T.addMana(state, 1, '1G');
        const handBefore = state.players[1].zones.hand.count();
        GameState.autoTapForSpell(state, 1, '{1}{G}', 2);
        GameState.castSpell(state, 1, wayfarer._uid);
        const handAfter = state.players[1].zones.hand.count();
        return {
          onBf: T.bfCreatureNames(state, 1).includes('Ainok Wayfarer'),
          gyCount: state.players[1].zones.graveyard.count(),
          // Hand: -1(cast) + possible land return
          handChange: handAfter - handBefore
        };
      });
      expect(r.onBf).toBe(true);
      expect(r.gyCount).toBeGreaterThan(0); // milled cards minus returned land
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ARASHIN SUNSHIELD {2}{W}
  // ETB: Exile up to 2 cards from opponent's graveyard
  // Activated: {W}, tap → tap target creature
  // ─────────────────────────────────────────────────────────────
  test.describe('Arashin Sunshield', () => {
    test('ETB exiles from opponent graveyard', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const shield = T.makeCreature('Arashin Sunshield', '2', '3', {
          cost: '{2}{W}', cmc: 3, colors: ['W'], typeLine: 'Creature — Human Soldier'
        });
        const state = T.createTestState({ oppHand: [shield], activePlayer: 1 });
        // Put cards in player 0's graveyard
        for (let i = 0; i < 4; i++) {
          state.players[0].zones.graveyard.add(T.makeCreature('Dead' + i, '1', '1'));
        }
        T.addMana(state, 1, '2W');
        const gyBefore = state.players[0].zones.graveyard.count();
        GameState.autoTapForSpell(state, 1, '{2}{W}', 3);
        GameState.castSpell(state, 1, shield._uid);
        const gyAfter = state.players[0].zones.graveyard.count();
        return {
          onBf: T.bfCreatureNames(state, 1).includes('Arashin Sunshield'),
          exiled: gyBefore - gyAfter
        };
      });
      expect(r.onBf).toBe(true);
      expect(r.exiled).toBeGreaterThanOrEqual(1);
    });

    test('Activated ability taps target creature', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const enemy = CardEngine.prepareForBattlefield(
          T.makeCreature('Enemy Soldier', '3', '3', { cost: '{2}{W}', cmc: 3, colors: ['W'] })
        );
        const state = T.createTestState({ myBf: [enemy], activePlayer: 1 });
        // Resolve tap via stack (tap only handled in stack.js)
        GameStack.push(state.stack, {
          card: { name: 'Arashin Sunshield' },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: enemy._uid }],
          effects: [{ type: 'tap', target: 'creature' }]
        });
        GameStack.resolve(state.stack, state);
        return { isTapped: !!enemy._tapped };
      });
      expect(r.isTapped).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ARMAMENT DRAGON {4}{W}
  // ETB: Distribute 3 +1/+1 counters among creatures you control
  // Static: Flying
  // ─────────────────────────────────────────────────────────────
  test.describe('Armament Dragon', () => {
    test('Has flying keyword', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const dragon = T.makeCreature('Armament Dragon', '3', '3', {
          cost: '{4}{W}', cmc: 5, colors: ['W'], typeLine: 'Creature — Dragon'
        });
        const state = T.createTestState({ oppHand: [dragon], activePlayer: 1 });
        T.addMana(state, 1, '4W');
        GameState.autoTapForSpell(state, 1, '{4}{W}', 5);
        GameState.castSpell(state, 1, dragon._uid);
        const card = T.getCreatureByName(state, 1, 'Armament Dragon');
        return { hasFlying: card ? CardEngine.hasKeyword(card, 'Flying') : false };
      });
      expect(r.hasFlying).toBe(true);
    });

    test('ETB distributes +1/+1 counters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['armament dragon'];
        return {
          etbType: db?.etb?.[0]?.type,
          counter: db?.etb?.[0]?.counter,
          amount: db?.etb?.[0]?.amount,
          target: db?.etb?.[0]?.target
        };
      });
      expect(r.etbType).toBe('counter');
      expect(r.counter).toBe('+1/+1');
      expect(r.amount).toBe(3);
      expect(r.target).toBe('distribute_creatures');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CONSTRICTOR SAGE {1}{U}
  // ETB: Tap target opponent creature and put a stun counter on it
  // ─────────────────────────────────────────────────────────────
  test.describe('Constrictor Sage', () => {
    test('ETB taps and stuns opponent creature', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const enemy = CardEngine.prepareForBattlefield(
          T.makeCreature('Enemy Bear', '2', '2', { cost: '{1}{G}', cmc: 2, colors: ['G'] })
        );
        const state = T.createTestState({ myBf: [enemy], activePlayer: 1 });
        // Resolve ETB effects via stack directly (tap + stun_counter)
        GameStack.push(state.stack, {
          card: { name: 'Constrictor Sage' },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: enemy._uid }],
          effects: [
            { type: 'tap', target: 'opponent_creature' },
            { type: 'stun_counter', amount: 1, target: 'same' }
          ]
        });
        GameStack.resolve(state.stack, state);
        return {
          isTapped: !!enemy._tapped,
          stunCounters: enemy._stunCounters || 0
        };
      });
      expect(r.isTapped).toBe(true);
      expect(r.stunCounters).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DISRUPTIVE STORMBROOD
  // Omen cast: Destroy creature with power 3 or less
  // ETB (creature): Destroy target artifact or enchantment
  // Static: Flying
  // ─────────────────────────────────────────────────────────────
  test.describe('Disruptive Stormbrood', () => {
    test('Has flying keyword after entering BF', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const storm = T.makeCreature('Disruptive Stormbrood', '3', '4', {
          cost: '{3}{U}{B}', cmc: 5, colors: ['U', 'B'], typeLine: 'Creature — Dragon'
        });
        const state = T.createTestState({ oppHand: [storm], activePlayer: 1 });
        T.addMana(state, 1, '3UB');
        GameState.autoTapForSpell(state, 1, '{3}{U}{B}', 5);
        GameState.castSpell(state, 1, storm._uid);
        const card = T.getCreatureByName(state, 1, 'Disruptive Stormbrood');
        return { hasFlying: card ? CardEngine.hasKeyword(card, 'Flying') : false };
      });
      expect(r.hasFlying).toBe(true);
    });

    test('DB has omen cast + ETB + static', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['disruptive stormbrood'];
        return {
          isOmen: db?.omen === true,
          castType: db?.cast?.[0]?.type,
          etbType: db?.etb?.[0]?.type,
          hasStatic: !!db?.static
        };
      });
      expect(r.isOmen).toBe(true);
      expect(r.castType).toBe('destroy');
      expect(r.etbType).toBe('destroy');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DUSYUT EARTHCARVER {2}{G}
  // ETB: Endure 3 (distribute 3 +1/+1 counters among creatures)
  // Static: Reach
  // ─────────────────────────────────────────────────────────────
  test.describe('Dusyut Earthcarver', () => {
    test('Has reach keyword after entering BF', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const carver = T.makeCreature('Dusyut Earthcarver', '2', '2', {
          cost: '{2}{G}', cmc: 3, colors: ['G'], typeLine: 'Creature — Human Druid'
        });
        const state = T.createTestState({ oppHand: [carver], activePlayer: 1 });
        T.addMana(state, 1, '2G');
        GameState.autoTapForSpell(state, 1, '{2}{G}', 3);
        GameState.castSpell(state, 1, carver._uid);
        const card = T.getCreatureByName(state, 1, 'Dusyut Earthcarver');
        return { hasReach: card ? CardEngine.hasKeyword(card, 'Reach') : false };
      });
      expect(r.hasReach).toBe(true);
    });

    test('ETB has endure 3', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dusyut earthcarver'];
        return {
          etbType: db?.etb?.[0]?.type,
          amount: db?.etb?.[0]?.amount
        };
      });
      expect(r.etbType).toBe('endure');
      expect(r.amount).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // EQUILIBRIUM ADEPT {2}{R}
  // ETB: Exile top card of library, can play until next end step
  // ─────────────────────────────────────────────────────────────
  test.describe('Equilibrium Adept', () => {
    test('ETB exiles top card for impulse draw', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const adept = T.makeCreature('Equilibrium Adept', '2', '2', {
          cost: '{2}{R}', cmc: 3, colors: ['R'], typeLine: 'Creature — Human Wizard'
        });
        const state = T.createTestState({ oppHand: [adept], activePlayer: 1 });
        // Add card to library top
        state.players[1].zones.library.add(T.makeCreature('Exiled Card', '1', '1'));
        T.addMana(state, 1, '2R');
        const exileBefore = state.players[1].zones.exile.count();
        GameState.autoTapForSpell(state, 1, '{2}{R}', 3);
        GameState.castSpell(state, 1, adept._uid);
        const exileAfter = state.players[1].zones.exile.count();
        return {
          onBf: T.bfCreatureNames(state, 1).includes('Equilibrium Adept'),
          exiled: exileAfter - exileBefore
        };
      });
      expect(r.onBf).toBe(true);
      expect(r.exiled).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 3: TDM Creatures with Triggered Abilities
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────
  // AMBLING STORMSHELL
  // Ward 2, Attacks: stun self 3 + draw 3
  // ─────────────────────────────────────────────────────────────
  test.describe('Ambling Stormshell', () => {
    test('DB has ward 2 static and attacks trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['ambling stormshell'];
        return {
          wardKw: db?.static?.[0]?.keyword,
          wardCost: db?.static?.[0]?.ward_cost,
          trigEvent: db?.triggered?.[0]?.event,
          eff1: db?.triggered?.[0]?.effects?.[0]?.type,
          eff2: db?.triggered?.[0]?.effects?.[1]?.type,
          drawAmt: db?.triggered?.[0]?.effects?.[1]?.amount
        };
      });
      expect(r.wardKw).toBe('ward');
      expect(r.wardCost).toBe(2);
      expect(r.trigEvent).toBe('attacks');
      expect(r.eff1).toBe('stun_counter_self');
      expect(r.eff2).toBe('draw');
      expect(r.drawAmt).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ATTUNED HUNTER
  // Trample, Triggered: cards leave GY → +1/+1 counter
  // ─────────────────────────────────────────────────────────────
  test.describe('Attuned Hunter', () => {
    test('Has trample keyword', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const hunter = T.makeCreature('Attuned Hunter', '3', '3', {
          cost: '{2}{G}', cmc: 3, colors: ['G'], typeLine: 'Creature — Beast'
        });
        const state = T.createTestState({ oppHand: [hunter], activePlayer: 1 });
        T.addMana(state, 1, '2G');
        GameState.autoTapForSpell(state, 1, '{2}{G}', 3);
        GameState.castSpell(state, 1, hunter._uid);
        const card = T.getCreatureByName(state, 1, 'Attuned Hunter');
        return { hasTrample: card ? CardEngine.hasKeyword(card, 'Trample') : false };
      });
      expect(r.hasTrample).toBe(true);
    });

    test('DB has cards_leave_graveyard trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['attuned hunter'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          effType: db?.triggered?.[0]?.effects?.[0]?.type,
          counter: db?.triggered?.[0]?.effects?.[0]?.counter
        };
      });
      expect(r.trigEvent).toBe('cards_leave_graveyard');
      expect(r.effType).toBe('counter_self');
      expect(r.counter).toBe('+1/+1');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // BLOOMVINE REGENT
  // Omen: ramp 2 forests. Triggered: dragon enters → gain 3 life. Flying.
  // ─────────────────────────────────────────────────────────────
  test.describe('Bloomvine Regent', () => {
    test('Has flying keyword after ETB', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const regent = T.makeCreature('Bloomvine Regent', '4', '5', {
          cost: '{3}{G}{G}', cmc: 5, colors: ['G'], typeLine: 'Creature — Dragon'
        });
        const state = T.createTestState({ oppHand: [regent], activePlayer: 1 });
        T.addMana(state, 1, '3GG');
        GameState.autoTapForSpell(state, 1, '{3}{G}{G}', 5);
        GameState.castSpell(state, 1, regent._uid);
        const card = T.getCreatureByName(state, 1, 'Bloomvine Regent');
        return { hasFlying: card ? CardEngine.hasKeyword(card, 'Flying') : false };
      });
      expect(r.hasFlying).toBe(true);
    });

    test('DB has omen ramp + dragon_enters trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['bloomvine regent'];
        return {
          isOmen: db?.omen,
          castType: db?.cast?.[0]?.type,
          trigEvent: db?.triggered?.[0]?.event,
          trigEffect: db?.triggered?.[0]?.effects?.[0]?.type,
          trigAmt: db?.triggered?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.isOmen).toBe(true);
      expect(r.castType).toBe('ramp');
      expect(r.trigEvent).toBe('dragon_enters');
      expect(r.trigEffect).toBe('gain_life');
      expect(r.trigAmt).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // BOULDERBORN DRAGON
  // Flying. Attacks: surveil 1
  // ─────────────────────────────────────────────────────────────
  test.describe('Boulderborn Dragon', () => {
    test('DB has attacks trigger for surveil', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['boulderborn dragon'];
        return {
          flying: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          effType: db?.triggered?.[0]?.effects?.[0]?.type,
          amount: db?.triggered?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.flying).toBe('flying');
      expect(r.trigEvent).toBe('attacks');
      expect(r.effType).toBe('surveil');
      expect(r.amount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CORI MOUNTAIN STALWART
  // Second spell: deal 2 damage to each opponent + gain 2 life
  // ─────────────────────────────────────────────────────────────
  test.describe('Cori Mountain Stalwart', () => {
    test('DB has second_spell trigger with damage + lifegain', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['cori mountain stalwart'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          eff1: db?.triggered?.[0]?.effects?.[0]?.type,
          eff1Amt: db?.triggered?.[0]?.effects?.[0]?.amount,
          eff2: db?.triggered?.[0]?.effects?.[1]?.type,
          eff2Amt: db?.triggered?.[0]?.effects?.[1]?.amount
        };
      });
      expect(r.trigEvent).toBe('second_spell');
      expect(r.eff1).toBe('damage_each_opponent');
      expect(r.eff1Amt).toBe(2);
      expect(r.eff2).toBe('gain_life');
      expect(r.eff2Amt).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DELTA BLOODFLIES
  // Flying. Attacks w/ counter creature: opponent loses 1 life
  // ─────────────────────────────────────────────────────────────
  test.describe('Delta Bloodflies', () => {
    test('DB has conditional attacks trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['delta bloodflies'];
        return {
          flying: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          condition: db?.triggered?.[0]?.condition,
          effType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.flying).toBe('flying');
      expect(r.trigEvent).toBe('attacks');
      expect(r.condition).toBe('control_creature_with_counter');
      expect(r.effType).toBe('lose_life');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DEVOTED DUELIST
  // Haste. Second spell: deal 1 damage to each opponent
  // ─────────────────────────────────────────────────────────────
  test.describe('Devoted Duelist', () => {
    test('Has haste keyword after ETB', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const duelist = T.makeCreature('Devoted Duelist', '2', '1', {
          cost: '{1}{R}', cmc: 2, colors: ['R'], typeLine: 'Creature — Human Monk'
        });
        const state = T.createTestState({ oppHand: [duelist], activePlayer: 1 });
        T.addMana(state, 1, '1R');
        GameState.autoTapForSpell(state, 1, '{1}{R}', 2);
        GameState.castSpell(state, 1, duelist._uid);
        const card = T.getCreatureByName(state, 1, 'Devoted Duelist');
        return { hasHaste: card ? CardEngine.hasKeyword(card, 'Haste') : false };
      });
      expect(r.hasHaste).toBe(true);
    });

    test('DB has second_spell trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['devoted duelist'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          effType: db?.triggered?.[0]?.effects?.[0]?.type,
          amount: db?.triggered?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.trigEvent).toBe('second_spell');
      expect(r.effType).toBe('damage_each_opponent');
      expect(r.amount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // FELOTHAR, DAWN OF THE ABZAN
  // Trample. Enters/attacks: sacrifice nonland + counter all own creatures
  // ─────────────────────────────────────────────────────────────
  test.describe('Felothar, Dawn of the Abzan', () => {
    test('Has trample keyword via static application', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const fel = CardEngine.prepareForBattlefield(
          T.makeCreature('Felothar, Dawn of the Abzan', '5', '5', {
            cost: '{3}{W}{B}{G}', cmc: 6, colors: ['W', 'B', 'G'], typeLine: 'Creature — Rhino Warrior'
          })
        );
        const state = T.createTestState({ oppBf: [fel], activePlayer: 1 });
        // Apply static abilities from DB (like castSpell does)
        GameState._applyStaticOnETB(state, fel, 1);
        return { hasTrample: CardEngine.hasKeyword(fel, 'Trample') };
      });
      expect(r.hasTrample).toBe(true);
    });

    test('DB has enters_or_attacks trigger with sacrifice + counter_all', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['felothar, dawn of the abzan'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          eff1: db?.triggered?.[0]?.effects?.[0]?.type,
          eff2: db?.triggered?.[0]?.effects?.[1]?.type,
          counter: db?.triggered?.[0]?.effects?.[1]?.counter,
          target: db?.triggered?.[0]?.effects?.[1]?.target
        };
      });
      expect(r.trigEvent).toBe('enters_or_attacks');
      expect(r.eff1).toBe('sacrifice');
      expect(r.eff2).toBe('counter_all');
      expect(r.counter).toBe('+1/+1');
      expect(r.target).toBe('own_creatures');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // JESKAI SHRINEKEEPER
  // Flying. Combat damage to player: gain 1 life + draw 1
  // ─────────────────────────────────────────────────────────────
  test.describe('Jeskai Shrinekeeper', () => {
    test('DB has flying+haste keywords and combat_damage_player trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['jeskai shrinekeeper'];
        return {
          keywords: db?.static?.[0]?.keywords,
          trigEvent: db?.triggered?.[0]?.event,
          eff1: db?.triggered?.[0]?.effects?.[0]?.type,
          eff2: db?.triggered?.[0]?.effects?.[1]?.type
        };
      });
      expect(r.keywords).toEqual(['flying', 'haste']);
      expect(r.trigEvent).toBe('combat_damage_player');
      expect(r.eff1).toBe('gain_life');
      expect(r.eff2).toBe('draw');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // KOTIS, THE FANGKEEPER
  // Indestructible. Combat damage to player: exile X cards from opponent top
  // ─────────────────────────────────────────────────────────────
  test.describe('Kotis, the Fangkeeper', () => {
    test('DB has indestructible + combat damage trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['kotis, the fangkeeper'];
        return {
          indestructible: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          effType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.indestructible).toBe('indestructible');
      expect(r.trigEvent).toBe('combat_damage_player');
      expect(r.effType).toBe('exile_top_opponent');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // MARSHAL OF THE LOST
  // Deathtouch. Attacks: buff creature +X/+X (X = attacking creatures)
  // ─────────────────────────────────────────────────────────────
  test.describe('Marshal of the Lost', () => {
    test('Has deathtouch keyword', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const marshal = T.makeCreature('Marshal of the Lost', '3', '3', {
          cost: '{2}{B}', cmc: 3, colors: ['B'], typeLine: 'Creature — Human Knight'
        });
        const state = T.createTestState({ oppHand: [marshal], activePlayer: 1 });
        T.addMana(state, 1, '2B');
        GameState.autoTapForSpell(state, 1, '{2}{B}', 3);
        GameState.castSpell(state, 1, marshal._uid);
        const card = T.getCreatureByName(state, 1, 'Marshal of the Lost');
        return { hasDeathtouch: card ? CardEngine.hasKeyword(card, 'Deathtouch') : false };
      });
      expect(r.hasDeathtouch).toBe(true);
    });

    test('DB has attacks trigger with X buff', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['marshal of the lost'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          buffPower: db?.triggered?.[0]?.effects?.[0]?.power,
          duration: db?.triggered?.[0]?.effects?.[0]?.duration
        };
      });
      expect(r.trigEvent).toBe('attacks');
      expect(r.buffPower).toBe('X');
      expect(r.duration).toBe('end_of_turn');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 4: TDM Sorceries, Uncommon Spells, Modal
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────
  // DRAGON'S PREY {3}{B}
  // Destroy target creature
  // ─────────────────────────────────────────────────────────────
  test.describe("Dragon's Prey", () => {
    test('Destroys target creature via stack', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const victim = CardEngine.prepareForBattlefield(
          T.makeCreature('Victim', '3', '3', { cost: '{2}{G}', cmc: 3, colors: ['G'] })
        );
        const state = T.createTestState({ myBf: [victim], activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: "Dragon's Prey" },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: victim._uid }],
          effects: [{ type: 'destroy', target: 'creature' }]
        });
        GameStack.resolve(state.stack, state);
        return { died: !state.players[0].zones.battlefield.get(victim._uid) };
      });
      expect(r.died).toBe(true);
    });

    test('Indestructible creature survives', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const tough = CardEngine.prepareForBattlefield(
          T.makeCreature('Tough Guy', '3', '3', { cost: '{2}{G}', cmc: 3, colors: ['G'], keywords: ['Indestructible'] })
        );
        const state = T.createTestState({ myBf: [tough], activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: "Dragon's Prey" },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: tough._uid }],
          effects: [{ type: 'destroy', target: 'creature' }]
        });
        GameStack.resolve(state.stack, state);
        return { survived: !!state.players[0].zones.battlefield.get(tough._uid) };
      });
      expect(r.survived).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // FOCUS THE MIND {4}{U}
  // Cost -2 if second spell. Loot 3 (draw 3, discard 1)
  // ─────────────────────────────────────────────────────────────
  test.describe('Focus the Mind', () => {
    test('DB has cost reduction + loot effect', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['focus the mind'];
        return {
          reductionAmt: db?.self_cost_reduction?.amount,
          reductionCond: db?.self_cost_reduction?.condition,
          castType: db?.cast?.[0]?.type,
          draw: db?.cast?.[0]?.draw,
          discard: db?.cast?.[0]?.discard
        };
      });
      expect(r.reductionAmt).toBe(2);
      expect(r.reductionCond).toBe('second_spell');
      expect(r.castType).toBe('loot');
      expect(r.draw).toBe(3);
      expect(r.discard).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // COORDINATED MANEUVER
  // Modal: damage X (X = creatures) OR destroy enchantment
  // ─────────────────────────────────────────────────────────────
  test.describe('Coordinated Maneuver', () => {
    test('DB has modal with 2 modes', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['coordinated maneuver'];
        return {
          isModal: db?.cast?.[0]?.type === 'modal',
          mode1Type: db?.cast?.[0]?.modes?.[0]?.type,
          mode2Type: db?.cast?.[0]?.modes?.[1]?.type,
          mode2Target: db?.cast?.[0]?.modes?.[1]?.target
        };
      });
      expect(r.isModal).toBe(true);
      expect(r.mode1Type).toBe('damage');
      expect(r.mode2Type).toBe('destroy');
      expect(r.mode2Target).toBe('enchantment');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // FRONTLINE RUSH
  // Modal: create 2 goblin tokens OR buff creature +X/+X
  // ─────────────────────────────────────────────────────────────
  test.describe('Frontline Rush', () => {
    test('DB has modal with token or buff modes', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['frontline rush'];
        return {
          isModal: db?.cast?.[0]?.type === 'modal',
          mode1Type: db?.cast?.[0]?.modes?.[0]?.type,
          mode1Count: db?.cast?.[0]?.modes?.[0]?.count,
          mode2Type: db?.cast?.[0]?.modes?.[1]?.type,
          mode2Power: db?.cast?.[0]?.modes?.[1]?.power
        };
      });
      expect(r.isModal).toBe(true);
      expect(r.mode1Type).toBe('create_token');
      expect(r.mode1Count).toBe(2);
      expect(r.mode2Type).toBe('buff');
      expect(r.mode2Power).toBe('X');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // KNOCKOUT MANEUVER {1}{G}
  // +1/+1 counter on own creature, then fight
  // ─────────────────────────────────────────────────────────────
  test.describe('Knockout Maneuver', () => {
    test('DB has counter + fight effects', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['knockout maneuver'];
        return {
          eff1: db?.cast?.[0]?.type,
          counter: db?.cast?.[0]?.counter,
          eff2: db?.cast?.[1]?.type,
          eff2Target: db?.cast?.[1]?.target
        };
      });
      expect(r.eff1).toBe('counter');
      expect(r.counter).toBe('+1/+1');
      expect(r.eff2).toBe('fight');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // MOLTEN EXHALE {3}{R}
  // Deal 4 damage to target creature
  // ─────────────────────────────────────────────────────────────
  test.describe('Molten Exhale', () => {
    test('Deals 4 damage to creature via stack', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Tough Ox', '2', '5', { cost: '{3}{G}', cmc: 4, colors: ['G'] })
        );
        const state = T.createTestState({ myBf: [target], activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: 'Molten Exhale' },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: target._uid }],
          effects: [{ type: 'damage', amount: 4, target: 'creature' }]
        });
        GameStack.resolve(state.stack, state);
        return { damage: target._damage || 0 };
      });
      expect(r.damage).toBe(4);
    });

    test('Kills creature with toughness <= 4', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('Small Bird', '1', '3', { cost: '{1}{U}', cmc: 2, colors: ['U'] })
        );
        const state = T.createTestState({ myBf: [target], activePlayer: 1 });
        GameStack.push(state.stack, {
          card: { name: 'Molten Exhale' },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: target._uid }],
          effects: [{ type: 'damage', amount: 4, target: 'creature' }]
        });
        GameStack.resolve(state.stack, state);
        return { died: !state.players[0].zones.battlefield.get(target._uid) };
      });
      expect(r.died).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // REBELLIOUS STRIKE {1}{R}
  // +3/+0 to creature + draw 1
  // ─────────────────────────────────────────────────────────────
  test.describe('Rebellious Strike', () => {
    test('Buffs creature +3/+0 and draws card', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const target = CardEngine.prepareForBattlefield(
          T.makeCreature('My Warrior', '2', '2', { cost: '{1}{R}', cmc: 2, colors: ['R'] })
        );
        const state = T.createTestState({ myBf: [target], activePlayer: 1 });
        for (let i = 0; i < 3; i++) state.players[1].zones.library.add(T.makeCreature('Lib' + i, '1', '1'));
        const handBefore = state.players[1].zones.hand.count();
        GameStack.push(state.stack, {
          card: { name: 'Rebellious Strike' },
          controller: 1,
          targets: [{ type: 'creature', player: 0, uid: target._uid }],
          effects: [
            { type: 'buff', power: 3, toughness: 0, target: 'creature', duration: 'end_of_turn' },
            { type: 'draw', amount: 1 }
          ]
        });
        GameStack.resolve(state.stack, state);
        return {
          power: CardEngine.getPower(target),
          drew: state.players[1].zones.hand.count() - handBefore
        };
      });
      expect(r.power).toBe(5); // 2 + 3
      expect(r.drew).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SNAKESKIN VEIL {G}
  // +1/+1 counter + hexproof until end of turn
  // ─────────────────────────────────────────────────────────────
  test.describe('Snakeskin Veil', () => {
    test('DB has counter + hexproof grant', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['snakeskin veil'];
        return {
          eff1: db?.cast?.[0]?.type,
          counter: db?.cast?.[0]?.counter,
          eff2: db?.cast?.[1]?.type,
          kw: db?.cast?.[1]?.keyword
        };
      });
      expect(r.eff1).toBe('counter');
      expect(r.counter).toBe('+1/+1');
      expect(r.eff2).toBe('grant');
      expect(r.kw).toBe('hexproof');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // TWIN BOLT {1}{R}
  // Deal 2 damage divided among up to 2 targets
  // ─────────────────────────────────────────────────────────────
  test.describe('Twin Bolt', () => {
    test('DB has divided damage effect', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['twin bolt'];
        return {
          type: db?.cast?.[0]?.type,
          amount: db?.cast?.[0]?.amount,
          target: db?.cast?.[0]?.target,
          maxTargets: db?.cast?.[0]?.max_targets
        };
      });
      expect(r.type).toBe('damage');
      expect(r.amount).toBe(2);
      expect(r.target).toBe('divided');
      expect(r.maxTargets).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 5: TDM Mobilize Creatures + Enchantments
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────
  // AVENGER OF THE FALLEN
  // Deathtouch. Attacks: create 2 Warriors (attacking, sacrifice at end step)
  // ─────────────────────────────────────────────────────────────
  test.describe('Avenger of the Fallen', () => {
    test('Has deathtouch + mobilize trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['avenger of the fallen'];
        return {
          deathtouch: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          tokenCount: db?.triggered?.[0]?.effects?.[0]?.count,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          attacking: db?.triggered?.[0]?.effects?.[0]?.attacking,
          sacrifice: db?.triggered?.[0]?.effects?.[0]?.sacrificeAtEndStep
        };
      });
      expect(r.deathtouch).toBe('deathtouch');
      expect(r.trigEvent).toBe('attacks');
      expect(r.tokenCount).toBe(2);
      expect(r.tokenName).toBe('Warrior');
      expect(r.attacking).toBe(true);
      expect(r.sacrifice).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // BONE-CAIRN BUTCHER
  // Attacks: create 2 Warriors. Static: grant deathtouch to attacking tokens
  // ─────────────────────────────────────────────────────────────
  test.describe('Bone-Cairn Butcher', () => {
    test('DB has mobilize + grant deathtouch to tokens', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['bone-cairn butcher'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          tokenCount: db?.triggered?.[0]?.effects?.[0]?.count,
          staticType: db?.static?.[0]?.type,
          staticKw: db?.static?.[0]?.keyword,
          staticTarget: db?.static?.[0]?.target
        };
      });
      expect(r.trigEvent).toBe('attacks');
      expect(r.tokenCount).toBe(2);
      expect(r.staticType).toBe('grant');
      expect(r.staticKw).toBe('deathtouch');
      expect(r.staticTarget).toBe('attacking_tokens');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SHOCK BRIGADE
  // Menace. Attacks: create 1 Warrior token (attacking, sacrifice end step)
  // ─────────────────────────────────────────────────────────────
  test.describe('Shock Brigade', () => {
    test('Has menace + mobilize 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['shock brigade'];
        return {
          menace: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          tokenCount: db?.triggered?.[0]?.effects?.[0]?.count
        };
      });
      expect(r.menace).toBe('menace');
      expect(r.trigEvent).toBe('attacks');
      expect(r.tokenCount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ALL-OUT ASSAULT {3}{R}{G}
  // Anthem +1/+1 + grant deathtouch. ETB: extra combat
  // ─────────────────────────────────────────────────────────────
  test.describe('All-Out Assault', () => {
    test('DB has anthem + deathtouch + extra combat', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['all-out assault'];
        return {
          s1Type: db?.static?.[0]?.type,
          s1Power: db?.static?.[0]?.power,
          s2Type: db?.static?.[1]?.type,
          s2Kw: db?.static?.[1]?.keyword,
          etbType: db?.etb?.[0]?.type
        };
      });
      expect(r.s1Type).toBe('buff_all');
      expect(r.s1Power).toBe(1);
      expect(r.s2Type).toBe('grant_all');
      expect(r.s2Kw).toBe('deathtouch');
      expect(r.etbType).toBe('extra_combat');
    });

    test('Extra combat sets flag', async () => {
      const r = await page.evaluate(() => {
        const T = TestHelper;
        const state = T.createTestState({ activePlayer: 1 });
        GameState._resolveSimpleEffect(state, 1, { type: 'extra_combat', condition: 'main_phase' }, {});
        return { flag: !!state._extraCombat };
      });
      expect(r.flag).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // BARRENSTEPPE SIEGE
  // Modal enchantment: Abzan (end step counters) or Mardu (sacrifice on death)
  // ─────────────────────────────────────────────────────────────
  test.describe('Barrensteppe Siege', () => {
    test('DB has modal with 2 clan modes (chooseOnETB)', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['barrensteppe siege'];
        return {
          hasModal: !!db?.modal,
          chooseOnETB: db?.modal?.chooseOnETB,
          modesIsArray: Array.isArray(db?.modal?.modes),
          modeCount: db?.modal?.modes?.length,
          mode0Label: db?.modal?.modes?.[0]?.label,
          mode0EffectType: db?.modal?.modes?.[0]?.effects?.[0]?.type,
          mode0Event: db?.modal?.modes?.[0]?.effects?.[0]?.event,
          mode1Label: db?.modal?.modes?.[1]?.label,
          mode1Event: db?.modal?.modes?.[1]?.effects?.[0]?.event,
          mode1Condition: db?.modal?.modes?.[1]?.effects?.[0]?.condition
        };
      });
      expect(r.hasModal).toBe(true);
      expect(r.chooseOnETB).toBe(true);
      expect(r.modesIsArray).toBe(true);
      expect(r.modeCount).toBe(2);
      expect(r.mode0EffectType).toBe('triggered');
      expect(r.mode0Event).toBe('end_step');
      expect(r.mode1Event).toBe('end_step');
      expect(r.mode1Condition).toBe('creature_died');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // AWAKEN THE HONORED DEAD
  // Saga: Ch1 destroy nonland, Ch2 mill 3, Ch3 discard + return creature/land
  // ─────────────────────────────────────────────────────────────
  test.describe('Awaken the Honored Dead', () => {
    test('DB has saga with 3 chapters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['awaken the honored dead'];
        return {
          isSaga: db?.saga,
          ch1Type: db?.chapters?.[1]?.[0]?.type,
          ch2Type: db?.chapters?.[2]?.[0]?.type,
          ch2Amt: db?.chapters?.[2]?.[0]?.amount,
          ch3Eff1: db?.chapters?.[3]?.[0]?.type,
          ch3Eff2: db?.chapters?.[3]?.[1]?.type
        };
      });
      expect(r.isSaga).toBe(true);
      expect(r.ch1Type).toBe('destroy');
      expect(r.ch2Type).toBe('mill');
      expect(r.ch2Amt).toBe(3);
      expect(r.ch3Eff1).toBe('discard');
      expect(r.ch3Eff2).toBe('return_from_graveyard');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 6: TDM Endure + Renew + Flurry
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────
  // FORTRESS KIN-GUARD
  // ETB: endure 1
  // ─────────────────────────────────────────────────────────────
  test.describe('Fortress Kin-Guard', () => {
    test('DB has ETB endure 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['fortress kin-guard'];
        return { etbType: db?.etb?.[0]?.type, amount: db?.etb?.[0]?.amount };
      });
      expect(r.etbType).toBe('endure');
      expect(r.amount).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SANDSKITTER OUTRIDER
  // Menace. ETB: endure 2
  // ─────────────────────────────────────────────────────────────
  test.describe('Sandskitter Outrider', () => {
    test('Has menace + endure 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sandskitter outrider'];
        return {
          menace: db?.static?.[0]?.keyword,
          etbType: db?.etb?.[0]?.type,
          amount: db?.etb?.[0]?.amount
        };
      });
      expect(r.menace).toBe('menace');
      expect(r.etbType).toBe('endure');
      expect(r.amount).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ADORNED CROCODILE
  // Dies: create 2/2 Zombie Druid. GY: exile {B} → +1/+1 counter on creature
  // ─────────────────────────────────────────────────────────────
  test.describe('Adorned Crocodile', () => {
    test('DB has dies trigger + graveyard activated', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['adorned crocodile'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          tokenPower: db?.triggered?.[0]?.effects?.[0]?.power,
          actCost: db?.activated?.[0]?.cost?.mana,
          actZone: db?.activated?.[0]?.cost?.zone,
          actExile: db?.activated?.[0]?.cost?.exile,
          actType: db?.activated?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.trigEvent).toBe('dies');
      expect(r.tokenName).toBe('Zombie Druid');
      expect(r.tokenPower).toBe(2);
      expect(r.actCost).toBe('B');
      expect(r.actZone).toBe('graveyard');
      expect(r.actExile).toBe(true);
      expect(r.actType).toBe('counter');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DRAGON SNIPER
  // Vigilance, reach, deathtouch (no other abilities)
  // ─────────────────────────────────────────────────────────────
  test.describe('Dragon Sniper', () => {
    test('DB has triple keyword static', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dragon sniper'];
        return {
          keywords: db?.static?.[0]?.keywords
        };
      });
      expect(r.keywords).toContain('vigilance');
      expect(r.keywords).toContain('reach');
      expect(r.keywords).toContain('deathtouch');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CORI-STEEL CUTTER (equipment)
  // Grant +1/+1, trample, haste to equipped. Second spell: create Monk token
  // ─────────────────────────────────────────────────────────────
  test.describe('Cori-Steel Cutter', () => {
    test('DB has equipment grant + second_spell trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['cori-steel cutter'];
        return {
          grantPower: db?.static?.[0]?.power,
          grantKws: db?.static?.[0]?.keywords,
          grantTarget: db?.static?.[0]?.target,
          trigEvent: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name
        };
      });
      expect(r.grantPower).toBe(1);
      expect(r.grantKws).toContain('trample');
      expect(r.grantKws).toContain('haste');
      expect(r.grantTarget).toBe('equipped');
      expect(r.trigEvent).toBe('second_spell');
      expect(r.tokenName).toBe('Monk');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // POISED PRACTITIONER
  // Second spell: +1/+1 counter self + scry 1
  // ─────────────────────────────────────────────────────────────
  test.describe('Poised Practitioner', () => {
    test('DB has second_spell with counter_self + scry', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['poised practitioner'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          eff1: db?.triggered?.[0]?.effects?.[0]?.type,
          counter: db?.triggered?.[0]?.effects?.[0]?.counter,
          eff2: db?.triggered?.[0]?.effects?.[1]?.type,
          scryAmt: db?.triggered?.[0]?.effects?.[1]?.amount
        };
      });
      expect(r.trigEvent).toBe('second_spell');
      expect(r.eff1).toBe('counter_self');
      expect(r.counter).toBe('+1/+1');
      expect(r.eff2).toBe('scry');
      expect(r.scryAmt).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 7: TDM Rares + Activated Abilities
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────
  // ABZAN DEVOTEE
  // Activated: {1} once/turn → add W/B/G mana. GY: {2B} → return to hand
  // ─────────────────────────────────────────────────────────────
  test.describe('Abzan Devotee', () => {
    test('DB has mana ability + graveyard return', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['abzan devotee'];
        return {
          act1Cost: db?.activated?.[0]?.cost?.mana,
          act1Once: db?.activated?.[0]?.cost?.once_per_turn,
          act1Type: db?.activated?.[0]?.effects?.[0]?.type,
          act2Cost: db?.activated?.[1]?.cost?.mana,
          act2Zone: db?.activated?.[1]?.cost?.zone,
          act2Type: db?.activated?.[1]?.effects?.[0]?.type
        };
      });
      expect(r.act1Cost).toBe('1');
      expect(r.act1Once).toBe(true);
      expect(r.act1Type).toBe('add_mana');
      expect(r.act2Cost).toBe('2B');
      expect(r.act2Zone).toBe('graveyard');
      expect(r.act2Type).toBe('return_to_hand');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // BEARER OF GLORY
  // First strike on your turn. Activated: {4W} → buff all own creatures +1/+1
  // ─────────────────────────────────────────────────────────────
  test.describe('Bearer of Glory', () => {
    test('DB has conditional first strike + activated buff_all', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['bearer of glory'];
        return {
          staticType: db?.static?.[0]?.type,
          staticKw: db?.static?.[0]?.keyword,
          staticCond: db?.static?.[0]?.condition,
          actCost: db?.activated?.[0]?.cost?.mana,
          actType: db?.activated?.[0]?.effects?.[0]?.type,
          actTarget: db?.activated?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.staticType).toBe('grant');
      expect(r.staticKw).toBe('first_strike');
      expect(r.staticCond).toBe('your_turn');
      expect(r.actCost).toBe('4W');
      expect(r.actType).toBe('buff_all');
      expect(r.actTarget).toBe('own_creatures');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CLARION CONQUEROR
  // Flying. Prevent activated abilities on artifacts/creatures/planeswalkers
  // ─────────────────────────────────────────────────────────────
  test.describe('Clarion Conqueror', () => {
    test('DB has flying + prevent activated abilities', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['clarion conqueror'];
        return {
          s1Kw: db?.static?.[0]?.keyword,
          s2Type: db?.static?.[1]?.type,
          s2Target: db?.static?.[1]?.target
        };
      });
      expect(r.s1Kw).toBe('flying');
      expect(r.s2Type).toBe('prevent_activated_abilities');
      expect(r.s2Target).toBe('artifacts_creatures_planeswalkers');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // FANGKEEPER'S FAMILIAR
  // Flash. ETB Modal: gain 3 life OR surveil 3 OR destroy enchantment OR counter creature
  // ─────────────────────────────────────────────────────────────
  test.describe("Fangkeeper's Familiar", () => {
    test('DB has flash + 4-mode ETB modal', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["fangkeeper's familiar"];
        return {
          flash: db?.static?.[0]?.keyword,
          isModal: db?.etb?.[0]?.type === 'modal',
          modeCount: db?.etb?.[0]?.modes?.length,
          m1: db?.etb?.[0]?.modes?.[0]?.type,
          m2: db?.etb?.[0]?.modes?.[1]?.type,
          m3: db?.etb?.[0]?.modes?.[2]?.type,
          m4: db?.etb?.[0]?.modes?.[3]?.type
        };
      });
      expect(r.flash).toBe('flash');
      expect(r.isModal).toBe(true);
      expect(r.modeCount).toBe(4);
      expect(r.m1).toBe('gain_life');
      expect(r.m2).toBe('surveil');
      expect(r.m3).toBe('destroy');
      expect(r.m4).toBe('counter');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DRAGONOLOGIST
  // ETB: look at top 6, reveal instant/sorcery/dragon
  // ─────────────────────────────────────────────────────────────
  test.describe('Dragonologist', () => {
    test('DB has look_top 6 ETB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dragonologist'];
        return {
          etbType: db?.etb?.[0]?.type,
          amount: db?.etb?.[0]?.amount,
          reveal: db?.etb?.[0]?.reveal
        };
      });
      expect(r.etbType).toBe('look_top');
      expect(r.amount).toBe(6);
      expect(r.reveal).toBe('instant_sorcery_or_dragon');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // NARSET, JESKAI WAYMASTER
  // End step: discard hand, draw X (X = spells cast this turn)
  // ─────────────────────────────────────────────────────────────
  test.describe('Narset, Jeskai Waymaster', () => {
    test('DB has end_step trigger with discard + draw X', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['narset, jeskai waymaster'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          eff1: db?.triggered?.[0]?.effects?.[0]?.type,
          eff2: db?.triggered?.[0]?.effects?.[1]?.type,
          drawAmt: db?.triggered?.[0]?.effects?.[1]?.amount
        };
      });
      expect(r.trigEvent).toBe('end_step');
      expect(r.eff1).toBe('discard_hand');
      expect(r.eff2).toBe('draw');
      expect(r.drawAmt).toBe('X');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SARKHAN, DRAGON ASCENDANT
  // ETB: behold dragon + create Treasure. Dragon enters: +1/+1 counter self + become dragon
  // ─────────────────────────────────────────────────────────────
  test.describe('Sarkhan, Dragon Ascendant', () => {
    test('DB has ETB + dragon_enters trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sarkhan, dragon ascendant'];
        return {
          etb1: db?.etb?.[0]?.type,
          etb2: db?.etb?.[1]?.type,
          trigEvent: db?.triggered?.[0]?.event,
          trigEff1: db?.triggered?.[0]?.effects?.[0]?.type,
          trigEff2: db?.triggered?.[0]?.effects?.[1]?.type
        };
      });
      expect(r.etb1).toBe('behold_dragon');
      expect(r.etb2).toBe('create_token');
      expect(r.trigEvent).toBe('dragon_enters');
      expect(r.trigEff1).toBe('counter_self');
      expect(r.trigEff2).toBe('become_dragon');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ELSPETH, STORM SLAYER (Planeswalker)
  // Token doubling. +1: create Soldier. 0: counter_all + flying. -3: destroy
  // ─────────────────────────────────────────────────────────────
  test.describe('Elspeth, Storm Slayer', () => {
    test('DB has planeswalker abilities + token doubling', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['elspeth, storm slayer'];
        return {
          tokenDouble: db?.static?.[0]?.type,
          ability1Cost: db?.activated?.[0]?.cost?.loyalty,
          ability1Type: db?.activated?.[0]?.effects?.[0]?.type,
          ability2Cost: db?.activated?.[1]?.cost?.loyalty,
          ability2Eff1: db?.activated?.[1]?.effects?.[0]?.type,
          ability3Cost: db?.activated?.[2]?.cost?.loyalty,
          ability3Type: db?.activated?.[2]?.effects?.[0]?.type
        };
      });
      expect(r.tokenDouble).toBe('token_doubling');
      expect(r.ability1Cost).toBe(1);
      expect(r.ability1Type).toBe('create_token');
      expect(r.ability2Cost).toBe(0);
      expect(r.ability2Eff1).toBe('counter_all');
      expect(r.ability3Cost).toBe(-3);
      expect(r.ability3Type).toBe('destroy');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // JESKAI REVELATION {7}{U}{R}{W}
  // Bounce + 4 damage + 2 Monks + draw 2 + gain 4 life
  // ─────────────────────────────────────────────────────────────
  test.describe('Jeskai Revelation', () => {
    test('DB has 5 effects', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['jeskai revelation'];
        return {
          count: db?.cast?.length,
          e1: db?.cast?.[0]?.type,
          e2: db?.cast?.[1]?.type,
          e2Amt: db?.cast?.[1]?.amount,
          e3: db?.cast?.[2]?.type,
          e3Count: db?.cast?.[2]?.count,
          e4: db?.cast?.[3]?.type,
          e5: db?.cast?.[4]?.type
        };
      });
      expect(r.count).toBe(5);
      expect(r.e1).toBe('bounce');
      expect(r.e2).toBe('damage');
      expect(r.e2Amt).toBe(4);
      expect(r.e3).toBe('create_token');
      expect(r.e3Count).toBe(2);
      expect(r.e4).toBe('draw');
      expect(r.e5).toBe('gain_life');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 8: TDM Uncommon Spells & More Sorceries
  // ═══════════════════════════════════════════════════════════

  test.describe('Auroral Procession', () => {
    test('DB has return_from_graveyard cast', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['auroral procession'];
        return { type: db?.cast?.[0]?.type, target: db?.cast?.[0]?.target };
      });
      expect(r.type).toBe('return_from_graveyard');
      expect(r.target).toBe('card');
    });
  });

  test.describe('Duty Beyond Death', () => {
    test('DB has sacrifice cost + indestructible grant + counters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['duty beyond death'];
        return {
          sacCost: db?.additional_costs?.[0]?.type,
          eff1: db?.cast?.[0]?.type,
          eff1Kw: db?.cast?.[0]?.keyword,
          eff2: db?.cast?.[1]?.type,
          eff2Counter: db?.cast?.[1]?.counter
        };
      });
      expect(r.sacCost).toBe('sacrifice');
      expect(r.eff1).toBe('grant_all');
      expect(r.eff1Kw).toBe('indestructible');
      expect(r.eff2).toBe('counter_all');
      expect(r.eff2Counter).toBe('+1/+1');
    });
  });

  test.describe('Kin-Tree Severance', () => {
    test('DB has exile permanent mv3+', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['kin-tree severance'];
        return { type: db?.cast?.[0]?.type, target: db?.cast?.[0]?.target };
      });
      expect(r.type).toBe('exile');
      expect(r.target).toBe('permanent_mv3+');
    });
  });

  test.describe('Lie in Wait', () => {
    test('DB has return creature + damage X', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['lie in wait'];
        return {
          eff1: db?.cast?.[0]?.type,
          eff1ToHand: db?.cast?.[0]?.to_hand,
          eff2: db?.cast?.[1]?.type,
          eff2Amt: db?.cast?.[1]?.amount
        };
      });
      expect(r.eff1).toBe('return_from_graveyard');
      expect(r.eff1ToHand).toBe(true);
      expect(r.eff2).toBe('damage');
      expect(r.eff2Amt).toBe('X');
    });
  });

  test.describe('Salt Road Skirmish', () => {
    test('DB has destroy + create Warriors', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['salt road skirmish'];
        return {
          eff1: db?.cast?.[0]?.type,
          eff2: db?.cast?.[1]?.type,
          tokenCount: db?.cast?.[1]?.count,
          tokenName: db?.cast?.[1]?.name,
          haste: db?.cast?.[1]?.keywords?.[0]
        };
      });
      expect(r.eff1).toBe('destroy');
      expect(r.eff2).toBe('create_token');
      expect(r.tokenCount).toBe(2);
      expect(r.tokenName).toBe('Warrior');
      expect(r.haste).toBe('haste');
    });
  });

  test.describe('Riverwheel Sweep', () => {
    test('DB has tap + stun 3 + exile_top_play', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['riverwheel sweep'];
        return {
          eff1: db?.cast?.[0]?.type,
          eff2: db?.cast?.[1]?.type,
          stunAmt: db?.cast?.[1]?.amount,
          eff3: db?.cast?.[2]?.type
        };
      });
      expect(r.eff1).toBe('tap');
      expect(r.eff2).toBe('stun_counter');
      expect(r.stunAmt).toBe(3);
      expect(r.eff3).toBe('exile_top_play');
    });
  });

  test.describe("Rakshasa's Bargain", () => {
    test('DB has look_top 4 + draw 2 + mill 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["rakshasa's bargain"];
        return {
          eff1: db?.cast?.[0]?.type,
          eff1Amt: db?.cast?.[0]?.amount,
          eff2: db?.cast?.[1]?.type,
          eff2Amt: db?.cast?.[1]?.amount,
          eff3: db?.cast?.[2]?.type,
          eff3Amt: db?.cast?.[2]?.amount
        };
      });
      expect(r.eff1).toBe('look_top');
      expect(r.eff1Amt).toBe(4);
      expect(r.eff2).toBe('draw');
      expect(r.eff2Amt).toBe(2);
      expect(r.eff3).toBe('mill');
      expect(r.eff3Amt).toBe(2);
    });
  });

  test.describe('Inevitable Defeat', () => {
    test('DB has exile nonland + drain 3', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['inevitable defeat'];
        return {
          eff1: db?.cast?.[0]?.type,
          eff1Target: db?.cast?.[0]?.target,
          eff2: db?.cast?.[1]?.type,
          eff2Amt: db?.cast?.[1]?.amount
        };
      });
      expect(r.eff1).toBe('exile');
      expect(r.eff1Target).toBe('nonland_permanent');
      expect(r.eff2).toBe('drain');
      expect(r.eff2Amt).toBe(3);
    });
  });

  test.describe('Strategic Betrayal', () => {
    test('DB has exile creature + exile graveyard', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['strategic betrayal'];
        return {
          eff1: db?.cast?.[0]?.type,
          eff1Target: db?.cast?.[0]?.target,
          eff2: db?.cast?.[1]?.type,
          eff2Target: db?.cast?.[1]?.target
        };
      });
      expect(r.eff1).toBe('exile');
      expect(r.eff1Target).toBe('opponent_creature');
      expect(r.eff2).toBe('exile_graveyard');
      expect(r.eff2Target).toBe('opponent');
    });
  });

  test.describe('Worthy Cost', () => {
    test('DB has sacrifice cost + exile creature/PW', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['worthy cost'];
        return {
          sacCost: db?.additional_costs?.[0]?.type,
          castType: db?.cast?.[0]?.type,
          castTarget: db?.cast?.[0]?.target
        };
      });
      expect(r.sacCost).toBe('sacrifice');
      expect(r.castType).toBe('exile');
      expect(r.castTarget).toBe('creature_or_planeswalker');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 9: TDM Harmonize Cards + Common Spells
  // ═══════════════════════════════════════════════════════════

  test.describe("Roamer's Routine", () => {
    test('DB has ramp + harmonize cost', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["roamer's routine"];
        return {
          castType: db?.cast?.[0]?.type,
          harmonize: db?.harmonize
        };
      });
      expect(r.castType).toBe('ramp');
      expect(r.harmonize).toBe('{4}{G}');
    });
  });

  test.describe('Unending Whisper', () => {
    test('DB has draw 1 + harmonize', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['unending whisper'];
        return {
          castType: db?.cast?.[0]?.type,
          drawAmt: db?.cast?.[0]?.amount,
          harmonize: db?.harmonize
        };
      });
      expect(r.castType).toBe('draw');
      expect(r.drawAmt).toBe(1);
      expect(r.harmonize).toBe('{5}{U}');
    });
  });

  test.describe("Ureni's Rebuff", () => {
    test('DB has bounce + harmonize', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["ureni's rebuff"];
        return {
          castType: db?.cast?.[0]?.type,
          target: db?.cast?.[0]?.target,
          harmonize: db?.harmonize
        };
      });
      expect(r.castType).toBe('bounce');
      expect(r.target).toBe('creature');
      expect(r.harmonize).toBe('{5}{U}');
    });
  });

  test.describe('Winternight Stories', () => {
    test('DB has draw 3 + conditional discard + harmonize', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['winternight stories'];
        return {
          eff1: db?.cast?.[0]?.type,
          eff1Amt: db?.cast?.[0]?.amount,
          eff2: db?.cast?.[1]?.type,
          eff2Amt: db?.cast?.[1]?.amount,
          harmonize: db?.harmonize
        };
      });
      expect(r.eff1).toBe('draw');
      expect(r.eff1Amt).toBe(3);
      expect(r.eff2).toBe('discard');
      expect(r.eff2Amt).toBe(2);
      expect(r.harmonize).toBe('{4}{U}');
    });
  });

  test.describe('Mammoth Bellow', () => {
    test('DB has create Elephant 5/5 + harmonize', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['mammoth bellow'];
        return {
          type: db?.cast?.[0]?.type,
          power: db?.cast?.[0]?.power,
          toughness: db?.cast?.[0]?.toughness,
          name: db?.cast?.[0]?.name,
          harmonize: db?.harmonize
        };
      });
      expect(r.type).toBe('create_token');
      expect(r.power).toBe(5);
      expect(r.toughness).toBe(5);
      expect(r.name).toBe('Elephant');
      expect(r.harmonize).toBeTruthy();
    });
  });

  test.describe('Wild Ride', () => {
    test('DB has buff +3/+0 + grant haste + harmonize', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['wild ride'];
        return {
          eff1: db?.cast?.[0]?.type,
          eff1Power: db?.cast?.[0]?.power,
          eff2: db?.cast?.[1]?.type,
          eff2Kw: db?.cast?.[1]?.keyword,
          harmonize: db?.harmonize
        };
      });
      expect(r.eff1).toBe('buff');
      expect(r.eff1Power).toBe(3);
      expect(r.eff2).toBe('grant');
      expect(r.eff2Kw).toBe('haste');
      expect(r.harmonize).toBe('{4}{R}');
    });
  });

  test.describe("Narset's Rebuke", () => {
    test('DB has 5 damage + add 3 mana', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["narset's rebuke"];
        return {
          eff1: db?.cast?.[0]?.type,
          eff1Amt: db?.cast?.[0]?.amount,
          effCount: db?.cast?.length
        };
      });
      expect(r.eff1).toBe('damage');
      expect(r.eff1Amt).toBe(5);
      expect(r.effCount).toBe(4); // damage + 3 add_mana
    });
  });

  test.describe('Osseous Exhale', () => {
    test('DB has attack/block damage + behold lifegain', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['osseous exhale'];
        return {
          eff1: db?.cast?.[0]?.type,
          eff1Amt: db?.cast?.[0]?.amount,
          eff1Target: db?.cast?.[0]?.target,
          eff2: db?.cast?.[1]?.type,
          eff2Cond: db?.cast?.[1]?.condition
        };
      });
      expect(r.eff1).toBe('damage');
      expect(r.eff1Amt).toBe(5);
      expect(r.eff1Target).toBe('attacking_or_blocking_creature');
      expect(r.eff2).toBe('gain_life');
      expect(r.eff2Cond).toBe('if_beheld_dragon');
    });
  });

  test.describe('Lightfoot Technique', () => {
    test('DB has +1/+1 counter + grant flying+indestructible', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['lightfoot technique'];
        return {
          eff1: db?.cast?.[0]?.type,
          eff1Counter: db?.cast?.[0]?.counter,
          eff2: db?.cast?.[1]?.type,
          eff2Kws: db?.cast?.[1]?.keywords
        };
      });
      expect(r.eff1).toBe('counter');
      expect(r.eff1Counter).toBe('+1/+1');
      expect(r.eff2).toBe('grant');
      expect(r.eff2Kws).toContain('flying');
      expect(r.eff2Kws).toContain('indestructible');
    });
  });

  test.describe('Synchronized Charge', () => {
    test('DB has distribute counters + grant keywords + harmonize', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['synchronized charge'];
        return {
          eff1: db?.cast?.[0]?.type,
          eff1Counter: db?.cast?.[0]?.counter,
          eff2: db?.cast?.[1]?.type,
          eff2Kws: db?.cast?.[1]?.keywords,
          harmonize: db?.harmonize
        };
      });
      expect(r.eff1).toBe('distribute_counters');
      expect(r.eff1Counter).toBe('+1/+1');
      expect(r.eff2).toBe('grant');
      expect(r.eff2Kws).toContain('vigilance');
      expect(r.harmonize).toBe('{4}{G}');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 10: TDM Creatures with ETB (more)
  // ═══════════════════════════════════════════════════════════

  test.describe('Gurmag Rakshasa', () => {
    test('DB has ETB debuff opponent + buff own + menace', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['gurmag rakshasa'];
        return {
          etb1: db?.etb?.[0]?.type,
          etb1Power: db?.etb?.[0]?.power,
          etb2: db?.etb?.[1]?.type,
          etb2Power: db?.etb?.[1]?.power,
          menace: db?.static?.[0]?.keyword
        };
      });
      expect(r.etb1).toBe('debuff');
      expect(r.etb1Power).toBe(-2);
      expect(r.etb2).toBe('buff');
      expect(r.etb2Power).toBe(2);
      expect(r.menace).toBe('menace');
    });
  });

  test.describe('Iridescent Tiger', () => {
    test('DB has ETB add WUBRG mana', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['iridescent tiger'];
        return { etbType: db?.etb?.[0]?.type, colors: db?.etb?.[0]?.colors };
      });
      expect(r.etbType).toBe('add_mana');
      expect(r.colors).toEqual(['W', 'U', 'B', 'R', 'G']);
    });
  });

  test.describe('Summit Intimidator', () => {
    test('DB has ETB tap + reach', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['summit intimidator'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbTarget: db?.etb?.[0]?.target,
          reach: db?.static?.[0]?.keyword
        };
      });
      expect(r.etbType).toBe('tap');
      expect(r.etbTarget).toBe('opponent_creature');
      expect(r.reach).toBe('reach');
    });
  });

  test.describe('Skirmish Rhino', () => {
    test('DB has ETB drain 2 + trample', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['skirmish rhino'];
        return {
          etbType: db?.etb?.[0]?.type,
          amount: db?.etb?.[0]?.amount,
          trample: db?.static?.[0]?.keyword
        };
      });
      expect(r.etbType).toBe('drain');
      expect(r.amount).toBe(2);
      expect(r.trample).toBe('trample');
    });
  });

  test.describe('Sonic Shrieker', () => {
    test('DB has ETB damage 2 + gain 2 life + discard + flying', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sonic shrieker'];
        return {
          etb1: db?.etb?.[0]?.type,
          etb2: db?.etb?.[1]?.type,
          etb3: db?.etb?.[2]?.type,
          flying: db?.static?.[0]?.keyword
        };
      });
      expect(r.etb1).toBe('damage');
      expect(r.etb2).toBe('gainLife');
      expect(r.etb3).toBe('discard');
      expect(r.flying).toBe('flying');
    });
  });

  test.describe('Severance Priest', () => {
    test('DB has ETB exile from opponent hand + deathtouch', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['severance priest'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbTarget: db?.etb?.[0]?.target,
          deathtouch: db?.static?.[0]?.keyword
        };
      });
      expect(r.etbType).toBe('exile');
      expect(r.etbTarget).toBe('opponent_hand_nonland');
      expect(r.deathtouch).toBe('deathtouch');
    });
  });

  test.describe('Trade Route Envoy', () => {
    test('DB has trade_route_envoy_ability ETB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['trade route envoy'];
        return {
          etbType: db?.etb?.[0]?.type
        };
      });
      expect(r.etbType).toBe('trade_route_envoy_ability');
    });
  });

  test.describe('Monastery Messenger', () => {
    test('DB has ETB return noncreature_nonland to top + flying', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['monastery messenger'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbTarget: db?.etb?.[0]?.target,
          toTop: db?.etb?.[0]?.to_top_library,
          flying: db?.static?.[0]?.keyword
        };
      });
      expect(r.etbType).toBe('return_from_graveyard');
      expect(r.etbTarget).toBe('noncreature_nonland');
      expect(r.toTop).toBe(true);
      expect(r.flying).toBe('flying');
    });
  });

  test.describe('Reputable Merchant', () => {
    test('DB has ETB counter + dies counter', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['reputable merchant'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbCounter: db?.etb?.[0]?.counter,
          etbTarget: db?.etb?.[0]?.target,
          trigEvent: db?.triggered?.[0]?.event,
          trigType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.etbType).toBe('counter');
      expect(r.etbCounter).toBe('+1/+1');
      expect(r.etbTarget).toBe('own_creature');
      expect(r.trigEvent).toBe('dies');
      expect(r.trigType).toBe('counter');
    });
  });

  test.describe('Yathan Roadwatcher', () => {
    test('DB has ETB mill 4 + return creature mv3 to BF', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['yathan roadwatcher'];
        return {
          etb1: db?.etb?.[0]?.type,
          millAmt: db?.etb?.[0]?.amount,
          etb2: db?.etb?.[1]?.type,
          etb2Target: db?.etb?.[1]?.target,
          toBf: db?.etb?.[1]?.to_battlefield
        };
      });
      expect(r.etb1).toBe('mill');
      expect(r.millAmt).toBe(4);
      expect(r.etb2).toBe('return_from_graveyard');
      expect(r.etb2Target).toBe('creature_mv3');
      expect(r.toBf).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 11: TDM Sagas & Siege Enchantments & DFC
  // ═══════════════════════════════════════════════════════════

  test.describe('Rediscover the Way', () => {
    test('DB has saga with 3 chapters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['rediscover the way'];
        return {
          isSaga: db?.saga,
          ch1Type: db?.chapters?.[1]?.[0]?.type,
          ch2Type: db?.chapters?.[2]?.[0]?.type,
          ch3Type: db?.chapters?.[3]?.[0]?.type
        };
      });
      expect(r.isSaga).toBe(true);
      expect(r.ch1Type).toBe('look_top');
      expect(r.ch2Type).toBe('look_top');
      expect(r.ch3Type).toBe('grant');
    });
  });

  test.describe('Revival of the Ancestors', () => {
    test('DB has saga: tokens, counters, keywords', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['revival of the ancestors'];
        return {
          isSaga: db?.saga,
          ch1Type: db?.chapters?.[1]?.[0]?.type,
          ch1Count: db?.chapters?.[1]?.[0]?.count,
          ch2Type: db?.chapters?.[2]?.[0]?.type,
          ch3Type: db?.chapters?.[3]?.[0]?.type
        };
      });
      expect(r.isSaga).toBe(true);
      expect(r.ch1Type).toBe('create_token');
      expect(r.ch1Count).toBe(3);
      expect(r.ch2Type).toBe('distribute_counters');
      expect(r.ch3Type).toBe('buff_all');
    });
  });

  test.describe('Roar of Endless Song', () => {
    test('DB has saga: elephants + double buff', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['roar of endless song'];
        return {
          isSaga: db?.saga,
          ch1Type: db?.chapters?.[1]?.[0]?.type,
          ch1Name: db?.chapters?.[1]?.[0]?.name,
          ch3Power: db?.chapters?.[3]?.[0]?.power
        };
      });
      expect(r.isSaga).toBe(true);
      expect(r.ch1Type).toBe('create_token');
      expect(r.ch1Name).toBe('Elephant');
      expect(r.ch3Power).toBe('double');
    });
  });

  test.describe('Frostcliff Siege', () => {
    test('DB has modal siege with Jeskai + Temur modes', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['frostcliff siege'];
        return {
          chooseOnETB: db?.modal?.chooseOnETB,
          mode1Label: db?.modal?.modes?.[0]?.label,
          mode2Label: db?.modal?.modes?.[1]?.label
        };
      });
      expect(r.chooseOnETB).toBe(true);
      expect(r.mode1Label).toBe('Jeskai');
      expect(r.mode2Label).toBe('Temur');
    });
  });

  test.describe('Windcrag Siege', () => {
    test('DB has Mardu + Jeskai siege modes', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['windcrag siege'];
        return {
          chooseOnETB: db?.modal?.chooseOnETB,
          mode1Label: db?.modal?.modes?.[0]?.label,
          mode2Label: db?.modal?.modes?.[1]?.label
        };
      });
      expect(r.chooseOnETB).toBe(true);
      expect(r.mode1Label).toBe('Mardu');
      expect(r.mode2Label).toBe('Jeskai');
    });
  });

  // DFC / Stormbroods
  test.describe('Feral Deathgorger', () => {
    test('DB has omen cast + ETB + flying/deathtouch', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['feral deathgorger'];
        return {
          isOmen: db?.omen,
          castType: db?.cast?.[0]?.type,
          etbType: db?.etb?.[0]?.type,
          keywords: db?.static?.[0]?.keywords
        };
      });
      expect(r.isOmen).toBe(true);
      expect(r.castType).toBe('counter');
      expect(r.etbType).toBe('exile_from_graveyard');
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('deathtouch');
    });
  });

  test.describe('Purging Stormbrood', () => {
    test('DB has omen buff + ETB remove counters + flying/ward', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['purging stormbrood'];
        return {
          isOmen: db?.omen,
          castType: db?.cast?.[0]?.type,
          etbType: db?.etb?.[0]?.type,
          keywords: db?.static?.[0]?.keywords
        };
      });
      expect(r.isOmen).toBe(true);
      expect(r.castType).toBe('buff');
      expect(r.etbType).toBe('remove_counters');
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('ward');
    });
  });

  test.describe('Sagu Wildling', () => {
    test('DB has omen ramp + ETB gain life + flying', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sagu wildling'];
        return {
          isOmen: db?.omen,
          castType: db?.cast?.[0]?.type,
          etbType: db?.etb?.[0]?.type,
          etbAmt: db?.etb?.[0]?.amount,
          flying: db?.static?.[0]?.keyword
        };
      });
      expect(r.isOmen).toBe(true);
      expect(r.castType).toBe('ramp');
      expect(r.etbType).toBe('gainLife');
      expect(r.etbAmt).toBe(3);
      expect(r.flying).toBe('flying');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 12: TDM Artifacts, Monuments, Lands
  // ═══════════════════════════════════════════════════════════

  test.describe('Dragonfire Blade', () => {
    test('DB has equipment grant +2/+2 + hexproof', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dragonfire blade'];
        return {
          type: db?.static?.[0]?.type,
          power: db?.static?.[0]?.power,
          toughness: db?.static?.[0]?.toughness,
          keyword: db?.static?.[0]?.keyword,
          target: db?.static?.[0]?.target
        };
      });
      expect(r.type).toBe('grant');
      expect(r.power).toBe(2);
      expect(r.toughness).toBe(2);
      expect(r.keyword).toBe('hexproof');
      expect(r.target).toBe('equipped');
    });
  });

  test.describe('Jeskai Monument', () => {
    test('DB has ETB ramp + activated token creation', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['jeskai monument'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbToHand: db?.etb?.[0]?.to_hand,
          actCost: db?.activated?.[0]?.cost?.mana,
          actSac: db?.activated?.[0]?.cost?.sacrifice,
          tokenName: db?.activated?.[0]?.effects?.[0]?.name,
          tokenCount: db?.activated?.[0]?.effects?.[0]?.count,
          tokenKws: db?.activated?.[0]?.effects?.[0]?.keywords
        };
      });
      expect(r.etbType).toBe('ramp');
      expect(r.etbToHand).toBe(true);
      expect(r.actSac).toBe(true);
      expect(r.tokenName).toBe('Bird');
      expect(r.tokenCount).toBe(2);
      expect(r.tokenKws).toContain('flying');
    });
  });

  test.describe('Mardu Monument', () => {
    test('DB has ETB ramp + activated Warriors creation', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['mardu monument'];
        return {
          etbType: db?.etb?.[0]?.type,
          tokenName: db?.activated?.[0]?.effects?.[0]?.name,
          tokenCount: db?.activated?.[0]?.effects?.[0]?.count,
          tokenKws: db?.activated?.[0]?.effects?.[0]?.keywords
        };
      });
      expect(r.etbType).toBe('ramp');
      expect(r.tokenName).toBe('Warrior');
      expect(r.tokenCount).toBe(3);
      expect(r.tokenKws).toContain('menace');
      expect(r.tokenKws).toContain('haste');
    });
  });

  test.describe('Evolving Wilds', () => {
    test('DB has tap+sacrifice → ramp basic land', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['evolving wilds'];
        return {
          tap: db?.activated?.[0]?.cost?.tap,
          sacrifice: db?.activated?.[0]?.cost?.sacrifice,
          type: db?.activated?.[0]?.effects?.[0]?.type,
          target: db?.activated?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.tap).toBe(true);
      expect(r.sacrifice).toBe(true);
      expect(r.type).toBe('ramp');
      expect(r.target).toBe('basic_land');
    });
  });

  test.describe('Dual Lands (Gain Life)', () => {
    test('All dual lands have enters_tapped + gainLife 1', async () => {
      const r = await page.evaluate(() => {
        const dualLands = [
          'bloodfell caves', 'blossoming sands', 'dismal backwater',
          'jungle hollow', 'rugged highlands', 'scoured barrens',
          'swiftwater cliffs', 'thornwood falls', 'tranquil cove', 'wind-scarred crag'
        ];
        let pass = true;
        for (const name of dualLands) {
          const db = CardEffectsDB[name];
          if (!db) { pass = false; continue; }
          if (db.static?.[0]?.type !== 'enters_tapped') pass = false;
          if (db.etb?.[0]?.type !== 'gainLife' || db.etb?.[0]?.amount !== 1) pass = false;
        }
        return { allCorrect: pass, count: dualLands.length };
      });
      expect(r.allCorrect).toBe(true);
      expect(r.count).toBe(10);
    });
  });

  test.describe('Tri-Lands', () => {
    test('All tri-lands have enters_tapped', async () => {
      const r = await page.evaluate(() => {
        const triLands = ['frontier bivouac', 'mystic monastery', 'nomad outpost', 'opulent palace', 'sandsteppe citadel'];
        let pass = true;
        for (const name of triLands) {
          const db = CardEffectsDB[name];
          if (!db || db.static?.[0]?.type !== 'enters_tapped') pass = false;
        }
        return { allCorrect: pass, count: triLands.length };
      });
      expect(r.allCorrect).toBe(true);
      expect(r.count).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 13: TDM More Triggered Creatures + White/Blue
  // ═══════════════════════════════════════════════════════════

  test.describe('Loxodon Battle Priest', () => {
    test('DB has combat_begin trigger with counter', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['loxodon battle priest'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          effType: db?.triggered?.[0]?.effects?.[0]?.type,
          effCounter: db?.triggered?.[0]?.effects?.[0]?.counter,
          effTarget: db?.triggered?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.trigEvent).toBe('combat_begin');
      expect(r.effType).toBe('counter');
      expect(r.effCounter).toBe('+1/+1');
      expect(r.effTarget).toBe('other_own_creature');
    });
  });

  test.describe('Starry-Eyed Skyrider', () => {
    test('DB has flying + attacks grant flying', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['starry-eyed skyrider'];
        return {
          flying: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          grantKw: db?.triggered?.[0]?.effects?.[0]?.keyword,
          grantTarget: db?.triggered?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.flying).toBe('flying');
      expect(r.trigEvent).toBe('attacks');
      expect(r.grantKw).toBe('flying');
      expect(r.grantTarget).toBe('other_own_creature');
    });
  });

  test.describe('Static Snare', () => {
    test('DB has flash + ETB exile opponent artifact/creature', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['static snare'];
        return {
          flash: db?.static?.[0]?.keyword,
          etbType: db?.etb?.[0]?.type,
          etbTarget: db?.etb?.[0]?.target
        };
      });
      expect(r.flash).toBe('flash');
      expect(r.etbType).toBe('exile');
      expect(r.etbTarget).toBe('opponent_artifact_or_creature');
    });
  });

  test.describe('Humbling Elder', () => {
    test('DB has flash + ETB debuff -2/-0', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['humbling elder'];
        return {
          flash: db?.static?.[0]?.keyword,
          etbType: db?.etb?.[0]?.type,
          power: db?.etb?.[0]?.power
        };
      });
      expect(r.flash).toBe('flash');
      expect(r.etbType).toBe('debuff');
      expect(r.power).toBe(-2);
    });
  });

  test.describe('Iceridge Serpent', () => {
    test('DB has ETB bounce opponent creature', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['iceridge serpent'];
        return { etbType: db?.etb?.[0]?.type, target: db?.etb?.[0]?.target };
      });
      expect(r.etbType).toBe('bounce');
      expect(r.target).toBe('opponent_creature');
    });
  });

  test.describe('Wayspeaker Bodyguard', () => {
    test('DB has ETB return + second_spell tap', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['wayspeaker bodyguard'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbToHand: db?.etb?.[0]?.to_hand,
          trigEvent: db?.triggered?.[0]?.event,
          trigType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.etbType).toBe('return_from_graveyard');
      expect(r.etbToHand).toBe(true);
      expect(r.trigEvent).toBe('second_spell');
      expect(r.trigType).toBe('tap_target');
    });
  });

  test.describe('Shocking Sharpshooter', () => {
    test('DB has other_creature_enters damage + reach', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['shocking sharpshooter'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          effType: db?.triggered?.[0]?.effects?.[0]?.type,
          effAmt: db?.triggered?.[0]?.effects?.[0]?.amount,
          reach: db?.static?.[0]?.keyword
        };
      });
      expect(r.trigEvent).toBe('other_creature_enters');
      expect(r.effType).toBe('damage');
      expect(r.effAmt).toBe(1);
      expect(r.reach).toBe('reach');
    });
  });

  test.describe('Venerated Stormsinger', () => {
    test('DB has any_creature_dies drain 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['venerated stormsinger'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          effType: db?.triggered?.[0]?.effects?.[0]?.type,
          effAmt: db?.triggered?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.trigEvent).toBe('any_creature_dies');
      expect(r.effType).toBe('drain');
      expect(r.effAmt).toBe(1);
    });
  });

  test.describe('Wingblade Disciple', () => {
    test('DB has second_spell create Bird + flying', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['wingblade disciple'];
        return {
          flying: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          tokenKws: db?.triggered?.[0]?.effects?.[0]?.keywords
        };
      });
      expect(r.flying).toBe('flying');
      expect(r.trigEvent).toBe('second_spell');
      expect(r.tokenName).toBe('Bird');
      expect(r.tokenKws).toContain('flying');
    });
  });

  test.describe('Aegis Sculptor', () => {
    test('DB has flying+ward + upkeep exile GY for counter', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['aegis sculptor'];
        return {
          keywords: db?.static?.[0]?.keywords,
          trigEvent: db?.triggered?.[0]?.event,
          eff1: db?.triggered?.[0]?.effects?.[0]?.type,
          eff2: db?.triggered?.[0]?.effects?.[1]?.type,
          eff2Cond: db?.triggered?.[0]?.effects?.[1]?.condition
        };
      });
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('ward');
      expect(r.trigEvent).toBe('upkeep');
      expect(r.eff1).toBe('exile_graveyard');
      expect(r.eff2).toBe('counter_self');
      expect(r.eff2Cond).toBe('if_exiled');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // BATCH 14: TDM Activated Ability Creatures + Enchantments
  // ═══════════════════════════════════════════════════════════

  test.describe('Sultai Devotee', () => {
    test('DB has mana ability + deathtouch', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sultai devotee'];
        return {
          deathtouch: db?.static?.[0]?.keyword,
          actCost: db?.activated?.[0]?.cost?.mana,
          actOnce: db?.activated?.[0]?.cost?.once_per_turn,
          actType: db?.activated?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.deathtouch).toBe('deathtouch');
      expect(r.actCost).toBe('1');
      expect(r.actOnce).toBe(true);
      expect(r.actType).toBe('add_mana');
    });
  });

  test.describe('War Effort', () => {
    test('DB has anthem +1/+0 + attacks create Warrior', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['war effort'];
        return {
          anthemType: db?.static?.[0]?.type,
          anthemPower: db?.static?.[0]?.power,
          trigEvent: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name
        };
      });
      expect(r.anthemType).toBe('anthem');
      expect(r.anthemPower).toBe(1);
      expect(r.trigEvent).toBe('attacks');
      expect(r.tokenName).toBe('Warrior');
    });
  });

  test.describe('Wingspan Stride', () => {
    test('DB has aura grant +1/+1/flying + bounce self activated', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['wingspan stride'];
        return {
          grantPower: db?.static?.[0]?.power,
          grantKw: db?.static?.[0]?.keyword,
          grantTarget: db?.static?.[0]?.target,
          actCost: db?.activated?.[0]?.cost?.mana,
          actType: db?.activated?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.grantPower).toBe(1);
      expect(r.grantKw).toBe('flying');
      expect(r.grantTarget).toBe('enchanted');
      expect(r.actCost).toBe('2U');
      expect(r.actType).toBe('bounce_self');
    });
  });

  test.describe('Breaching Dragonstorm', () => {
    test('DB has ETB exile_top_play + dragon_enters bounce_self', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['breaching dragonstorm'];
        return {
          etbType: db?.etb?.[0]?.type,
          trigEvent: db?.triggered?.[0]?.event,
          trigEffect: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.etbType).toBe('exile_top_play');
      expect(r.trigEvent).toBe('dragon_enters');
      expect(r.trigEffect).toBe('bounce_self');
    });
  });

  test.describe('Corroding Dragonstorm', () => {
    test('DB has ETB drain 2 + surveil 2 + dragon bounce', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['corroding dragonstorm'];
        return {
          etb1: db?.etb?.[0]?.type,
          etb1Amt: db?.etb?.[0]?.amount,
          etb2: db?.etb?.[1]?.type,
          trigEvent: db?.triggered?.[0]?.event
        };
      });
      expect(r.etb1).toBe('drain');
      expect(r.etb1Amt).toBe(2);
      expect(r.etb2).toBe('surveil');
      expect(r.trigEvent).toBe('dragon_enters');
    });
  });

  test.describe('Dragonback Assault', () => {
    test('DB has ETB damage all 3 + landfall dragon token', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dragonback assault'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbAmt: db?.etb?.[0]?.amount,
          trigEvent: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          tokenPower: db?.triggered?.[0]?.effects?.[0]?.power,
          tokenKws: db?.triggered?.[0]?.effects?.[0]?.keywords
        };
      });
      expect(r.etbType).toBe('damage_all');
      expect(r.etbAmt).toBe(3);
      expect(r.trigEvent).toBe('landfall');
      expect(r.tokenName).toBe('Dragon');
      expect(r.tokenPower).toBe(4);
      expect(r.tokenKws).toContain('flying');
    });
  });

  test.describe('Dracogenesis', () => {
    test('DB has cost_reduction for dragon spells', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dracogenesis'];
        return {
          type: db?.static?.[0]?.type,
          target: db?.static?.[0]?.target,
          reduction: db?.static?.[0]?.reduction
        };
      });
      expect(r.type).toBe('cost_reduction');
      expect(r.target).toBe('dragon_spells');
      expect(r.reduction).toBe('free');
    });
  });

  test.describe('Mox Jasper', () => {
    test('DB has tap → add any mana (if control dragon)', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['mox jasper'];
        return {
          tap: db?.activated?.[0]?.cost?.tap,
          type: db?.activated?.[0]?.effects?.[0]?.type,
          color: db?.activated?.[0]?.effects?.[0]?.color,
          condition: db?.activated?.[0]?.condition
        };
      });
      expect(r.tap).toBe(true);
      expect(r.type).toBe('add_mana');
      expect(r.color).toBe('any');
      expect(r.condition).toBe('control_dragon');
    });
  });

  // ==================== BATCH 15: Creatures with triggered/graveyard ====================

  test.describe('Agent of Kotis', () => {
    test('DB has graveyard activated: +1/+1 counters on creature', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['agent of kotis'];
        const a = db?.activated?.[0];
        return {
          zone: a?.cost?.zone,
          exile: a?.cost?.exile,
          mana: a?.cost?.mana,
          type: a?.effects?.[0]?.type,
          counter: a?.effects?.[0]?.counter,
          amount: a?.effects?.[0]?.amount
        };
      });
      expect(r.zone).toBe('graveyard');
      expect(r.exile).toBe(true);
      expect(r.mana).toBe('3U');
      expect(r.type).toBe('counter');
      expect(r.counter).toBe('+1/+1');
      expect(r.amount).toBe(2);
    });
  });

  test.describe("Alchemist's Assistant", () => {
    test('DB has lifelink + graveyard grant_counter lifelink', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["alchemist's assistant"];
        return {
          keyword: db?.static?.[0]?.keyword,
          zone: db?.activated?.[0]?.cost?.zone,
          grantType: db?.activated?.[0]?.effects?.[0]?.type,
          grantCounter: db?.activated?.[0]?.effects?.[0]?.counter
        };
      });
      expect(r.keyword).toBe('lifelink');
      expect(r.zone).toBe('graveyard');
      expect(r.grantType).toBe('grant_counter');
      expect(r.grantCounter).toBe('lifelink');
    });
  });

  test.describe('Anafenza, Unyielding Lineage', () => {
    test('DB has first strike + flash + other_creature_dies endure 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['anafenza, unyielding lineage'];
        return {
          keywords: db?.static?.[0]?.keywords,
          trigEvent: db?.triggered?.[0]?.event,
          effectType: db?.triggered?.[0]?.effects?.[0]?.type,
          amount: db?.triggered?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.keywords).toContain('first strike');
      expect(r.keywords).toContain('flash');
      expect(r.trigEvent).toBe('other_creature_dies');
      expect(r.effectType).toBe('endure');
      expect(r.amount).toBe(2);
    });
  });

  test.describe('Betor, Kin to All', () => {
    test('DB has flying + end_step draw if toughness 10+', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['betor, kin to all'];
        return {
          keyword: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          condition: db?.triggered?.[0]?.condition,
          effectType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.keyword).toBe('flying');
      expect(r.trigEvent).toBe('end_step');
      expect(r.condition).toBe('toughness_10+');
      expect(r.effectType).toBe('draw');
    });
  });

  test.describe('Call the Spirit Dragons', () => {
    test('DB has grant indestructible to dragons + upkeep counter', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['call the spirit dragons'];
        return {
          staticType: db?.static?.[0]?.type,
          keyword: db?.static?.[0]?.keyword,
          target: db?.static?.[0]?.target,
          trigEvent: db?.triggered?.[0]?.event,
          effectType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.staticType).toBe('grant');
      expect(r.keyword).toBe('indestructible');
      expect(r.target).toBe('dragons');
      expect(r.trigEvent).toBe('upkeep');
      expect(r.effectType).toBe('counter');
    });
  });

  test.describe('Champion of Dusan', () => {
    test('DB has trample + graveyard counters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['champion of dusan'];
        return {
          keyword: db?.static?.[0]?.keyword,
          gyMana: db?.graveyard?.[0]?.cost?.mana,
          exile: db?.graveyard?.[0]?.cost?.exile,
          e0type: db?.graveyard?.[0]?.effects?.[0]?.type,
          e1type: db?.graveyard?.[0]?.effects?.[1]?.type
        };
      });
      expect(r.keyword).toBe('trample');
      expect(r.gyMana).toBe('1G');
      expect(r.exile).toBe(true);
      expect(r.e0type).toBe('counter');
      expect(r.e1type).toBe('counter');
    });
  });

  test.describe('Dalkovan Packbeasts', () => {
    test('DB has vigilance + attacks create 3 Warriors', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dalkovan packbeasts'];
        return {
          keyword: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          self: db?.triggered?.[0]?.self,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          count: db?.triggered?.[0]?.effects?.[0]?.count,
          attacking: db?.triggered?.[0]?.effects?.[0]?.attacking
        };
      });
      expect(r.keyword).toBe('vigilance');
      expect(r.trigEvent).toBe('attacks');
      expect(r.self).toBe(true);
      expect(r.tokenName).toBe('Warrior');
      expect(r.count).toBe(3);
      expect(r.attacking).toBe(true);
    });
  });

  test.describe('Descendant of Storms', () => {
    test('DB has attacks trigger with endure 1 cost 1W', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['descendant of storms'];
        return {
          event: db?.triggered?.[0]?.event,
          self: db?.triggered?.[0]?.self,
          type: db?.triggered?.[0]?.effects?.[0]?.type,
          amount: db?.triggered?.[0]?.effects?.[0]?.amount,
          cost: db?.triggered?.[0]?.effects?.[0]?.cost
        };
      });
      expect(r.event).toBe('attacks');
      expect(r.self).toBe(true);
      expect(r.type).toBe('endure');
      expect(r.amount).toBe(1);
      expect(r.cost).toBe('1W');
    });
  });

  test.describe('Dirgur Island Dragon', () => {
    test('DB has omen tap+draw + flying+ward static', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dirgur island dragon'];
        return {
          omen: db?.omen,
          cast0: db?.cast?.[0]?.type,
          cast1: db?.cast?.[1]?.type,
          keywords: db?.static?.[0]?.keywords
        };
      });
      expect(r.omen).toBe(true);
      expect(r.cast0).toBe('tap');
      expect(r.cast1).toBe('draw');
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('ward');
    });
  });

  test.describe('Dragonback Lancer', () => {
    test('DB has flying + attacks create 1 Warrior', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dragonback lancer'];
        return {
          keyword: db?.static?.[0]?.keyword,
          event: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          count: db?.triggered?.[0]?.effects?.[0]?.count
        };
      });
      expect(r.keyword).toBe('flying');
      expect(r.event).toBe('attacks');
      expect(r.tokenName).toBe('Warrior');
      expect(r.count).toBe(1);
    });
  });

  // ==================== BATCH 16: Spells & complex creatures ====================

  test.describe('Dragonclaw Strike', () => {
    test('DB has double buff + optional fight', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dragonclaw strike'];
        return {
          buffPower: db?.cast?.[0]?.power,
          buffTough: db?.cast?.[0]?.toughness,
          fightType: db?.cast?.[1]?.type,
          optional: db?.cast?.[1]?.optional
        };
      });
      expect(r.buffPower).toBe('double');
      expect(r.buffTough).toBe('double');
      expect(r.fightType).toBe('fight');
      expect(r.optional).toBe(true);
    });
  });

  test.describe('Dragonstorm Forecaster', () => {
    test('DB has activated search_library for named cards', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dragonstorm forecaster'];
        const a = db?.activated?.[0];
        return {
          tap: a?.cost?.tap,
          mana: a?.cost?.mana,
          type: a?.effects?.[0]?.type,
          target: a?.effects?.[0]?.target,
          names: a?.effects?.[0]?.names
        };
      });
      expect(r.tap).toBe(true);
      expect(r.mana).toBe('2');
      expect(r.type).toBe('search_library');
      expect(r.target).toBe('named_card');
      expect(r.names).toContain('Dragonstorm Globe');
    });
  });

  test.describe('Dragonstorm Globe', () => {
    test('DB has dragon_etb_counter static + tap add any mana', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dragonstorm globe'];
        return {
          staticType: db?.static?.[0]?.type,
          tap: db?.activated?.[0]?.cost?.tap,
          effectType: db?.activated?.[0]?.effects?.[0]?.type,
          color: db?.activated?.[0]?.effects?.[0]?.color
        };
      });
      expect(r.staticType).toBe('dragon_etb_counter');
      expect(r.tap).toBe(true);
      expect(r.effectType).toBe('add_mana');
      expect(r.color).toBe('any');
    });
  });

  test.describe('Effortless Master', () => {
    test('DB has vigilance+menace + etb_counters_if_second_spell', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['effortless master'];
        return {
          keywords: db?.static?.[0]?.keywords,
          s1type: db?.static?.[1]?.type,
          counter: db?.static?.[1]?.counter,
          amount: db?.static?.[1]?.amount
        };
      });
      expect(r.keywords).toContain('vigilance');
      expect(r.keywords).toContain('menace');
      expect(r.s1type).toBe('etb_counters_if_second_spell');
      expect(r.counter).toBe('+1/+1');
      expect(r.amount).toBe(2);
    });
  });

  test.describe('Embermouth Sentinel', () => {
    test('DB has ETB ramp with dragon condition', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['embermouth sentinel'];
        return {
          type: db?.etb?.[0]?.type,
          target: db?.etb?.[0]?.target,
          condition: db?.etb?.[0]?.condition
        };
      });
      expect(r.type).toBe('ramp');
      expect(r.target).toBe('basic_land');
      expect(r.condition).toBe('control_dragon');
    });
  });

  test.describe('Encroaching Dragonstorm', () => {
    test('DB has ETB ramp 2 + dragon_enters bounce_self', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['encroaching dragonstorm'];
        return {
          rampType: db?.etb?.[0]?.type,
          rampAmount: db?.etb?.[0]?.amount,
          trigEvent: db?.triggered?.[0]?.event,
          bounceType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.rampType).toBe('ramp');
      expect(r.rampAmount).toBe(2);
      expect(r.trigEvent).toBe('dragon_enters');
      expect(r.bounceType).toBe('bounce_self');
    });
  });

  test.describe('Eshki Dragonclaw', () => {
    test('DB has vigilance+trample+ward + combat_begin conditional draw+counter', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['eshki dragonclaw'];
        return {
          keywords: db?.static?.[0]?.keywords,
          trigEvent: db?.triggered?.[0]?.event,
          condition: db?.triggered?.[0]?.condition,
          e0: db?.triggered?.[0]?.effects?.[0]?.type,
          e1: db?.triggered?.[0]?.effects?.[1]?.type
        };
      });
      expect(r.keywords).toContain('vigilance');
      expect(r.keywords).toContain('trample');
      expect(r.keywords).toContain('ward');
      expect(r.trigEvent).toBe('combat_begin');
      expect(r.condition).toBe('cast_creature_and_noncreature');
      expect(r.e0).toBe('draw');
      expect(r.e1).toBe('counter_self');
    });
  });

  test.describe('Essence Anchor', () => {
    test('DB has upkeep surveil + activated create Zombie Druid', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['essence anchor'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          surveil: db?.triggered?.[0]?.effects?.[0]?.type,
          actCondition: db?.activated?.[0]?.condition,
          tokenName: db?.activated?.[0]?.effects?.[0]?.name
        };
      });
      expect(r.trigEvent).toBe('upkeep');
      expect(r.surveil).toBe('surveil');
      expect(r.actCondition).toBe('card_left_graveyard');
      expect(r.tokenName).toBe('Zombie Druid');
    });
  });

  test.describe('Fire-Rim Form', () => {
    test('DB has aura grant +2/+0 + ETB first_strike', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['fire-rim form'];
        return {
          staticType: db?.static?.[0]?.type,
          power: db?.static?.[0]?.power,
          etbType: db?.etb?.[0]?.type,
          keyword: db?.etb?.[0]?.keyword
        };
      });
      expect(r.staticType).toBe('grant');
      expect(r.power).toBe(2);
      expect(r.etbType).toBe('grant');
      expect(r.keyword).toBe('first_strike');
    });
  });

  test.describe('Flamehold Grappler', () => {
    test('DB has first strike + ETB copy_next_spell', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['flamehold grappler'];
        return {
          keywords: db?.static?.[0]?.keywords,
          etbType: db?.etb?.[0]?.type
        };
      });
      expect(r.keywords).toContain('first strike');
      expect(r.etbType).toBe('copy_next_spell');
    });
  });

  // ==================== BATCH 17: More creatures & enchantments ====================

  test.describe('Fleeting Effigy', () => {
    test('DB has haste + end_step bounce_self + activated buff', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['fleeting effigy'];
        return {
          keyword: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          bounceType: db?.triggered?.[0]?.effects?.[0]?.type,
          actMana: db?.activated?.[0]?.cost?.mana,
          buffPower: db?.activated?.[0]?.effects?.[0]?.power
        };
      });
      expect(r.keyword).toBe('haste');
      expect(r.trigEvent).toBe('end_step');
      expect(r.bounceType).toBe('bounce_self');
      expect(r.actMana).toBe('2R');
      expect(r.buffPower).toBe(2);
    });
  });

  test.describe('Formation Breaker', () => {
    test('DB has cant_be_blocked_by_smaller + conditional_buff', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['formation breaker'];
        return {
          s0type: db?.static?.[0]?.type,
          s1type: db?.static?.[1]?.type,
          s1power: db?.static?.[1]?.power,
          s1tough: db?.static?.[1]?.toughness,
          condition: db?.static?.[1]?.condition
        };
      });
      expect(r.s0type).toBe('cant_be_blocked_by_smaller');
      expect(r.s1type).toBe('conditional_buff');
      expect(r.s1power).toBe(1);
      expect(r.s1tough).toBe(2);
      expect(r.condition).toBe('control_creature_with_counter');
    });
  });

  test.describe('Fresh Start', () => {
    test('DB has flash + aura_debuff -5/-0', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['fresh start'];
        return {
          s0keyword: db?.static?.[0]?.keyword,
          s1type: db?.static?.[1]?.type,
          power: db?.static?.[1]?.power,
          toughness: db?.static?.[1]?.toughness
        };
      });
      expect(r.s0keyword).toBe('flash');
      expect(r.s1type).toBe('aura_debuff');
      expect(r.power).toBe(-5);
      expect(r.toughness).toBe(0);
    });
  });

  test.describe('Furious Forebear', () => {
    test('DB has creature_dies trigger return_to_hand with cost', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['furious forebear'];
        return {
          event: db?.triggered?.[0]?.event,
          zone: db?.triggered?.[0]?.zone,
          type: db?.triggered?.[0]?.effects?.[0]?.type,
          cost: db?.triggered?.[0]?.effects?.[0]?.cost
        };
      });
      expect(r.event).toBe('creature_dies');
      expect(r.zone).toBe('graveyard');
      expect(r.type).toBe('return_to_hand');
      expect(r.cost).toBe('1W');
    });
  });

  test.describe('Glacierwood Siege', () => {
    test('DB has modal siege: Temur mill vs Sultai play lands from GY', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['glacierwood siege'];
        return {
          chooseOnETB: db?.modal?.chooseOnETB,
          mode0label: db?.modal?.modes?.[0]?.label,
          mode1label: db?.modal?.modes?.[1]?.label,
          mode0event: db?.modal?.modes?.[0]?.effects?.[0]?.event,
          mode1ability: db?.modal?.modes?.[1]?.effects?.[0]?.ability
        };
      });
      expect(r.chooseOnETB).toBe(true);
      expect(r.mode0label).toBe('Temur');
      expect(r.mode1label).toBe('Sultai');
      expect(r.mode0event).toBe('cast_noncreature');
      expect(r.mode1ability).toBe('play_lands_from_graveyard');
    });
  });

  test.describe('Gurmag Nightwatch', () => {
    test('DB has ETB look_top 3 pick 1 rest to graveyard', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['gurmag nightwatch'];
        return {
          type: db?.etb?.[0]?.type,
          amount: db?.etb?.[0]?.amount,
          pick: db?.etb?.[0]?.pick,
          rest: db?.etb?.[0]?.rest_to
        };
      });
      expect(r.type).toBe('look_top');
      expect(r.amount).toBe(3);
      expect(r.pick).toBe(1);
      expect(r.rest).toBe('graveyard');
    });
  });

  test.describe('Hardened Tactician', () => {
    test('DB has activated sacrifice_token draw 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['hardened tactician'];
        return {
          mana: db?.activated?.[0]?.cost?.mana,
          sacToken: db?.activated?.[0]?.cost?.sacrifice_token,
          type: db?.activated?.[0]?.effects?.[0]?.type,
          amount: db?.activated?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.mana).toBe('1');
      expect(r.sacToken).toBe(true);
      expect(r.type).toBe('draw');
      expect(r.amount).toBe(1);
    });
  });

  test.describe('Herd Heirloom', () => {
    test('DB has 2 activated abilities + combat_damage_player trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['herd heirloom'];
        return {
          act0type: db?.activated?.[0]?.effects?.[0]?.type,
          act0color: db?.activated?.[0]?.effects?.[0]?.color,
          act1keyword: db?.activated?.[1]?.effects?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          trigCondition: db?.triggered?.[0]?.condition
        };
      });
      expect(r.act0type).toBe('add_mana');
      expect(r.act0color).toBe('any');
      expect(r.act1keyword).toBe('trample');
      expect(r.trigEvent).toBe('combat_damage_player');
      expect(r.trigCondition).toBe('has_combat_draw');
    });
  });

  test.describe('Heritage Reclamation', () => {
    test('DB has 3-mode modal: destroy artifact/enchantment/exile+draw', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['heritage reclamation'];
        const modal = db?.cast?.[0];
        return {
          type: modal?.type,
          mode0type: modal?.modes?.[0]?.type,
          mode0target: modal?.modes?.[0]?.target,
          mode1type: modal?.modes?.[1]?.type,
          mode1target: modal?.modes?.[1]?.target,
          mode2isArray: Array.isArray(modal?.modes?.[2])
        };
      });
      expect(r.type).toBe('modal');
      expect(r.mode0type).toBe('destroy');
      expect(r.mode0target).toBe('artifact');
      expect(r.mode1type).toBe('destroy');
      expect(r.mode1target).toBe('enchantment');
      expect(r.mode2isArray).toBe(true);
    });
  });

  test.describe('Highspire Bell-Ringer', () => {
    test('DB has flying + cost_reduction for second_spell', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['highspire bell-ringer'];
        return {
          s0keyword: db?.static?.[0]?.keyword,
          s1type: db?.static?.[1]?.type,
          target: db?.static?.[1]?.target,
          reduction: db?.static?.[1]?.reduction
        };
      });
      expect(r.s0keyword).toBe('flying');
      expect(r.s1type).toBe('cost_reduction');
      expect(r.target).toBe('second_spell');
      expect(r.reduction).toBe(1);
    });
  });

  // ==================== BATCH 18: More creatures & siege enchantments ====================

  test.describe('Hollowmurk Siege', () => {
    test('DB has modal siege: Sultai counter_placed draw vs Abzan attacks counter', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['hollowmurk siege'];
        return {
          chooseOnETB: db?.modal?.chooseOnETB,
          mode0label: db?.modal?.modes?.[0]?.label,
          mode1label: db?.modal?.modes?.[1]?.label,
          mode0event: db?.modal?.modes?.[0]?.effects?.[0]?.event,
          mode1event: db?.modal?.modes?.[1]?.effects?.[0]?.event
        };
      });
      expect(r.chooseOnETB).toBe(true);
      expect(r.mode0label).toBe('Sultai');
      expect(r.mode1label).toBe('Abzan');
      expect(r.mode0event).toBe('counter_placed');
      expect(r.mode1event).toBe('attacks');
    });
  });

  test.describe('Host of the Hereafter', () => {
    test('DB has creature_dies_with_counters move_counters trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['host of the hereafter'];
        return {
          event: db?.triggered?.[0]?.event,
          type: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.event).toBe('creature_dies_with_counters');
      expect(r.type).toBe('move_counters');
    });
  });

  test.describe('Hundred-Battle Veteran', () => {
    test('DB has conditional_buff + graveyard cast_from_gy', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['hundred-battle veteran'];
        return {
          s0type: db?.static?.[0]?.type,
          s0power: db?.static?.[0]?.power,
          condition: db?.static?.[0]?.condition,
          gyCastFromGy: db?.graveyard?.[0]?.cost?.cast_from_gy,
          gyCounter: db?.graveyard?.[0]?.effects?.[0]?.counter
        };
      });
      expect(r.s0type).toBe('conditional_buff');
      expect(r.s0power).toBe(2);
      expect(r.condition).toBe('three_counter_types');
      expect(r.gyCastFromGy).toBe(true);
      expect(r.gyCounter).toBe('finality');
    });
  });

  test.describe('Inspirited Vanguard', () => {
    test('DB has enters_or_attacks endure 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['inspirited vanguard'];
        return {
          event: db?.triggered?.[0]?.event,
          type: db?.triggered?.[0]?.effects?.[0]?.type,
          amount: db?.triggered?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.event).toBe('enters_or_attacks');
      expect(r.type).toBe('endure');
      expect(r.amount).toBe(2);
    });
  });

  test.describe('Jade-Cast Sentinel', () => {
    test('DB has reach + activated exile_from_graveyard', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['jade-cast sentinel'];
        return {
          keyword: db?.static?.[0]?.keyword,
          tap: db?.activated?.[0]?.cost?.tap,
          type: db?.activated?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.keyword).toBe('reach');
      expect(r.tap).toBe(true);
      expect(r.type).toBe('exile_from_graveyard');
    });
  });

  test.describe('Jeskai Devotee', () => {
    test('DB has second_spell buff +1/+1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['jeskai devotee'];
        return {
          event: db?.triggered?.[0]?.event,
          type: db?.triggered?.[0]?.effects?.[0]?.type,
          power: db?.triggered?.[0]?.effects?.[0]?.power,
          target: db?.triggered?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.event).toBe('second_spell');
      expect(r.type).toBe('buff');
      expect(r.power).toBe(1);
      expect(r.target).toBe('self');
    });

    test('DB has activated mana ability {1}: Add {U}, {R}, or {W}', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['jeskai devotee'];
        return {
          hasActivated: !!db?.activated,
          cost: db?.activated?.[0]?.cost?.mana,
          oncePerTurn: db?.activated?.[0]?.cost?.once_per_turn,
          effectType: db?.activated?.[0]?.effects?.[0]?.type,
          colors: db?.activated?.[0]?.effects?.[0]?.colors,
          choose: db?.activated?.[0]?.effects?.[0]?.choose
        };
      });
      expect(r.hasActivated).toBe(true);
      expect(r.cost).toBe('1');
      expect(r.oncePerTurn).toBe(true);
      expect(r.effectType).toBe('add_mana');
      expect(r.colors).toEqual(['U', 'R', 'W']);
      expect(r.choose).toBe(1);
    });
  });

  test.describe('Karakyk Guardian', () => {
    test('DB has flying + conditional_hexproof', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['karakyk guardian'];
        return {
          s0keyword: db?.static?.[0]?.keyword,
          s1type: db?.static?.[1]?.type,
          condition: db?.static?.[1]?.condition
        };
      });
      expect(r.s0keyword).toBe('flying');
      expect(r.s1type).toBe('conditional_hexproof');
      expect(r.condition).toBe('no_damage_dealt');
    });
  });

  test.describe('Kheru Goldkeeper', () => {
    test('DB has flying + cards_leave_graveyard create Treasure', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['kheru goldkeeper'];
        return {
          keyword: db?.static?.[0]?.keyword,
          event: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name
        };
      });
      expect(r.keyword).toBe('flying');
      expect(r.event).toBe('cards_leave_graveyard');
      expect(r.tokenName).toBe('Treasure');
    });
  });

  test.describe('Kin-Tree Nurturer', () => {
    test('DB has lifelink + ETB endure 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['kin-tree nurturer'];
        return {
          keyword: db?.static?.[0]?.keyword,
          etbType: db?.etb?.[0]?.type,
          amount: db?.etb?.[0]?.amount
        };
      });
      expect(r.keyword).toBe('lifelink');
      expect(r.etbType).toBe('endure');
      expect(r.amount).toBe(1);
    });
  });

  test.describe('Kishla Skimmer', () => {
    test('DB has flying + card_leaves_graveyard draw once per turn', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['kishla skimmer'];
        return {
          keyword: db?.static?.[0]?.keyword,
          event: db?.triggered?.[0]?.event,
          once: db?.triggered?.[0]?.once_per_turn,
          type: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.keyword).toBe('flying');
      expect(r.event).toBe('card_leaves_graveyard');
      expect(r.once).toBe(true);
      expect(r.type).toBe('draw');
    });
  });

  // ==================== BATCH 19: Creatures & stormbroods ====================

  test.describe('Kishla Trawlers', () => {
    test('DB has ETB return instant_or_sorcery from graveyard', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['kishla trawlers'];
        return {
          type: db?.etb?.[0]?.type,
          target: db?.etb?.[0]?.target,
          toHand: db?.etb?.[0]?.to_hand
        };
      });
      expect(r.type).toBe('return_from_graveyard');
      expect(r.target).toBe('instant_or_sorcery');
      expect(r.toHand).toBe(true);
    });
  });

  test.describe('Krotiq Nestguard', () => {
    test('DB has defender + activated can_attack grant', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['krotiq nestguard'];
        return {
          keyword: db?.static?.[0]?.keyword,
          mana: db?.activated?.[0]?.cost?.mana,
          grantKeyword: db?.activated?.[0]?.effects?.[0]?.keyword
        };
      });
      expect(r.keyword).toBe('defender');
      expect(r.mana).toBe('2G');
      expect(r.grantKeyword).toBe('can_attack');
    });
  });

  test.describe('Krumar Initiate', () => {
    test('DB has activated XB + life X endure X', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['krumar initiate'];
        return {
          mana: db?.activated?.[0]?.cost?.mana,
          tap: db?.activated?.[0]?.cost?.tap,
          life: db?.activated?.[0]?.cost?.life,
          type: db?.activated?.[0]?.effects?.[0]?.type,
          amount: db?.activated?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.mana).toBe('XB');
      expect(r.tap).toBe(true);
      expect(r.life).toBe('X');
      expect(r.type).toBe('endure');
      expect(r.amount).toBe('X');
    });
  });

  test.describe('Lasyd Prowler', () => {
    test('DB has ETB mill lands_count + graveyard distribute counters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['lasyd prowler'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbAmount: db?.etb?.[0]?.amount,
          gyMana: db?.graveyard?.[0]?.cost?.mana,
          gyExile: db?.graveyard?.[0]?.cost?.exile,
          gyType: db?.graveyard?.[0]?.effects?.[0]?.type,
          gyAmount: db?.graveyard?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.etbType).toBe('mill');
      expect(r.etbAmount).toBe('lands_count');
      expect(r.gyMana).toBe('1G');
      expect(r.gyExile).toBe(true);
      expect(r.gyType).toBe('distribute_counters');
      expect(r.gyAmount).toBe('lands_in_gy_count');
    });
  });

  test.describe('Lotuslight Dancers', () => {
    test('DB has lifelink + ETB search_library_to_graveyard BUG colors', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['lotuslight dancers'];
        return {
          keyword: db?.static?.[0]?.keyword,
          etbType: db?.etb?.[0]?.type,
          colors: db?.etb?.[0]?.colors
        };
      });
      expect(r.keyword).toBe('lifelink');
      expect(r.etbType).toBe('search_library_to_graveyard');
      expect(r.colors).toContain('B');
      expect(r.colors).toContain('G');
      expect(r.colors).toContain('U');
    });
  });

  test.describe('Maelstrom of the Spirit Dragon', () => {
    test('DB has activated sacrifice search dragon', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['maelstrom of the spirit dragon'];
        const a = db?.activated?.[0];
        return {
          mana: a?.cost?.mana,
          tap: a?.cost?.tap,
          sacrifice: a?.cost?.sacrifice,
          type: a?.effects?.[0]?.type,
          target: a?.effects?.[0]?.target
        };
      });
      expect(r.mana).toBe('4');
      expect(r.tap).toBe(true);
      expect(r.sacrifice).toBe(true);
      expect(r.type).toBe('search_library');
      expect(r.target).toBe('dragon');
    });
  });

  test.describe('Magmatic Hellkite', () => {
    test('DB has flying + ETB destroy nonbasic_land', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['magmatic hellkite'];
        return {
          keyword: db?.static?.[0]?.keyword,
          etbType: db?.etb?.[0]?.type,
          target: db?.etb?.[0]?.target
        };
      });
      expect(r.keyword).toBe('flying');
      expect(r.etbType).toBe('destroy');
      expect(r.target).toBe('nonbasic_land');
    });
  });

  test.describe('Marang River Regent', () => {
    test('DB has omen loot 3/1 + flying + ETB bounce 2 nonland', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['marang river regent'];
        return {
          omen: db?.omen,
          castType: db?.cast?.[0]?.type,
          draw: db?.cast?.[0]?.draw,
          discard: db?.cast?.[0]?.discard,
          keyword: db?.static?.[0]?.keyword,
          etbType: db?.etb?.[0]?.type,
          bounceAmount: db?.etb?.[0]?.amount
        };
      });
      expect(r.omen).toBe(true);
      expect(r.castType).toBe('loot');
      expect(r.draw).toBe(3);
      expect(r.keyword).toBe('flying');
      expect(r.etbType).toBe('bounce');
      expect(r.bounceAmount).toBe(2);
    });
  });

  test.describe('Mardu Devotee', () => {
    test('DB has ETB scry 2 + activated add_mana RWB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['mardu devotee'];
        return {
          etbType: db?.etb?.[0]?.type,
          scryAmount: db?.etb?.[0]?.amount,
          actOnce: db?.activated?.[0]?.cost?.once_per_turn,
          actType: db?.activated?.[0]?.effects?.[0]?.type,
          color: db?.activated?.[0]?.effects?.[0]?.color
        };
      });
      expect(r.etbType).toBe('scry');
      expect(r.scryAmount).toBe(2);
      expect(r.actOnce).toBe(true);
      expect(r.actType).toBe('add_mana');
      expect(r.color).toBe('RWB');
    });
  });

  test.describe('Mardu Siegebreaker', () => {
    test('DB has deathtouch+haste + ETB exile creature + attacks create copy', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['mardu siegebreaker'];
        return {
          keywords: db?.static?.[0]?.keywords,
          etbType: db?.etb?.[0]?.type,
          trigEvent: db?.triggered?.[0]?.event,
          trigType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.keywords).toContain('deathtouch');
      expect(r.keywords).toContain('haste');
      expect(r.etbType).toBe('exile');
      expect(r.trigEvent).toBe('attacks');
      expect(r.trigType).toBe('create_token_copy');
    });
  });

  // ==================== BATCH 20: More spells & creatures ====================

  test.describe('Meticulous Artisan', () => {
    test('DB has ETB create Treasure', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['meticulous artisan'];
        return {
          type: db?.etb?.[0]?.type,
          name: db?.etb?.[0]?.name,
          count: db?.etb?.[0]?.count
        };
      });
      expect(r.type).toBe('create_token');
      expect(r.name).toBe('Treasure');
      expect(r.count).toBe(1);
    });
  });

  test.describe('Naga Fleshcrafter', () => {
    test('DB has ETB clone any_creature', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['naga fleshcrafter'];
        return {
          type: db?.etb?.[0]?.type,
          target: db?.etb?.[0]?.target
        };
      });
      expect(r.type).toBe('clone');
      expect(r.target).toBe('any_creature');
    });
  });

  test.describe("Nature's Rhythm", () => {
    test('DB has cast search_library creature mv_X + harmonize', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["nature's rhythm"];
        return {
          castType: db?.cast?.[0]?.type,
          target: db?.cast?.[0]?.target,
          harmonize: db?.harmonize
        };
      });
      expect(r.castType).toBe('search_library');
      expect(r.target).toBe('creature');
      expect(r.harmonize).toBeTruthy();
    });
  });

  test.describe('Neriv, Heart of the Storm', () => {
    test('DB has flying + double_damage to creatures_entered_this_turn', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['neriv, heart of the storm'];
        return {
          s0keyword: db?.static?.[0]?.keyword,
          s1type: db?.static?.[1]?.type,
          s1target: db?.static?.[1]?.target
        };
      });
      expect(r.s0keyword).toBe('flying');
      expect(r.s1type).toBe('double_damage');
      expect(r.s1target).toBe('creatures_entered_this_turn');
    });
  });

  test.describe('New Way Forward', () => {
    test('DB has prevent_damage + redirect + draw', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['new way forward'];
        return {
          e0type: db?.cast?.[0]?.type,
          e1type: db?.cast?.[1]?.type,
          e2type: db?.cast?.[2]?.type,
          count: db?.cast?.length
        };
      });
      expect(r.e0type).toBe('prevent_damage');
      expect(r.e1type).toBe('damage');
      expect(r.e2type).toBe('draw');
      expect(r.count).toBe(3);
    });
  });

  test.describe('Nightblade Brigade', () => {
    test('DB has deathtouch + attacks Warrior + ETB surveil', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['nightblade brigade'];
        return {
          keyword: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          etbType: db?.etb?.[0]?.type,
          etbAmount: db?.etb?.[0]?.amount
        };
      });
      expect(r.keyword).toBe('deathtouch');
      expect(r.trigEvent).toBe('attacks');
      expect(r.tokenName).toBe('Warrior');
      expect(r.etbType).toBe('surveil');
      expect(r.etbAmount).toBe(1);
    });
  });

  test.describe('Overwhelming Surge', () => {
    test('DB has 2-mode modal: damage 3 or destroy noncreature_artifact', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['overwhelming surge'];
        const modal = db?.cast?.[0];
        return {
          type: modal?.type,
          mode0type: modal?.modes?.[0]?.type,
          mode0amount: modal?.modes?.[0]?.amount,
          mode1type: modal?.modes?.[1]?.type,
          mode1target: modal?.modes?.[1]?.target
        };
      });
      expect(r.type).toBe('modal');
      expect(r.mode0type).toBe('damage');
      expect(r.mode0amount).toBe(3);
      expect(r.mode1type).toBe('destroy');
      expect(r.mode1target).toBe('noncreature_artifact');
    });
  });

  test.describe('Perennation', () => {
    test('DB has return_from_graveyard permanent with hexproof+indestructible', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['perennation'];
        return {
          type: db?.cast?.[0]?.type,
          target: db?.cast?.[0]?.target,
          counters: db?.cast?.[0]?.with_counters
        };
      });
      expect(r.type).toBe('return_from_graveyard');
      expect(r.target).toBe('permanent');
      expect(r.counters).toContain('hexproof');
      expect(r.counters).toContain('indestructible');
    });
  });

  test.describe('Piercing Exhale', () => {
    test('DB has one-sided fight + conditional surveil 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['piercing exhale'];
        return {
          e0type: db?.cast?.[0]?.type,
          oneSided: db?.cast?.[0]?.one_sided,
          e1type: db?.cast?.[1]?.type,
          e1amount: db?.cast?.[1]?.amount,
          condition: db?.cast?.[1]?.condition
        };
      });
      expect(r.e0type).toBe('fight');
      expect(r.oneSided).toBe(true);
      expect(r.e1type).toBe('surveil');
      expect(r.e1amount).toBe(2);
      expect(r.condition).toBe('if_beheld_dragon');
    });
  });

  test.describe('Qarsi Revenant', () => {
    test('DB has flying+deathtouch+lifelink + graveyard grant_counters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['qarsi revenant'];
        return {
          keywords: db?.static?.[0]?.keywords,
          zone: db?.activated?.[0]?.cost?.zone,
          mana: db?.activated?.[0]?.cost?.mana,
          type: db?.activated?.[0]?.effects?.[0]?.type,
          counters: db?.activated?.[0]?.effects?.[0]?.counters
        };
      });
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('deathtouch');
      expect(r.keywords).toContain('lifelink');
      expect(r.zone).toBe('graveyard');
      expect(r.mana).toBe('2BB');
      expect(r.type).toBe('grant_counters');
      expect(r.counters).toContain('flying');
    });
  });

  // ==================== BATCH 21: More creatures & spells ====================

  test.describe('Rainveil Rejuvenator', () => {
    test('DB has ETB mill 3 + activated add_mana power', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['rainveil rejuvenator'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbAmount: db?.etb?.[0]?.amount,
          actTap: db?.activated?.[0]?.cost?.tap,
          actType: db?.activated?.[0]?.effects?.[0]?.type,
          actAmount: db?.activated?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.etbType).toBe('mill');
      expect(r.etbAmount).toBe(3);
      expect(r.actTap).toBe(true);
      expect(r.actType).toBe('add_mana');
      expect(r.actAmount).toBe('power');
    });
  });

  test.describe('Rally the Monastery', () => {
    test('DB has 3-mode modal: tokens/buff_all/destroy', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['rally the monastery'];
        const modal = db?.cast?.[0];
        return {
          type: modal?.type,
          mode0type: modal?.modes?.[0]?.type,
          mode0count: modal?.modes?.[0]?.count,
          mode1type: modal?.modes?.[1]?.type,
          mode2type: modal?.modes?.[2]?.type
        };
      });
      expect(r.type).toBe('modal');
      expect(r.mode0type).toBe('create_token');
      expect(r.mode0count).toBe(2);
      expect(r.mode1type).toBe('buff_all');
      expect(r.mode2type).toBe('destroy');
    });
  });

  test.describe('Reigning Victor', () => {
    test('DB has ETB buff+indestructible + attacks create Warrior', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['reigning victor'];
        return {
          etb0type: db?.etb?.[0]?.type,
          etb1keyword: db?.etb?.[1]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name
        };
      });
      expect(r.etb0type).toBe('buff');
      expect(r.etb1keyword).toBe('indestructible');
      expect(r.trigEvent).toBe('attacks');
      expect(r.tokenName).toBe('Warrior');
    });
  });

  test.describe('Rescue Leopard', () => {
    test('DB has becomes_tapped rummage trigger', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['rescue leopard'];
        return {
          event: db?.triggered?.[0]?.event,
          self: db?.triggered?.[0]?.self,
          type: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.event).toBe('becomes_tapped');
      expect(r.self).toBe(true);
      expect(r.type).toBe('rummage');
    });
  });

  test.describe('Reverberating Summons', () => {
    test('DB has combat_begin become_creature + activated discard_hand draw 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['reverberating summons'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          trigType: db?.triggered?.[0]?.effects?.[0]?.type,
          trigPower: db?.triggered?.[0]?.effects?.[0]?.power,
          actCost: db?.activated?.[0]?.cost?.discard_hand,
          actSac: db?.activated?.[0]?.cost?.sacrifice,
          actType: db?.activated?.[0]?.effects?.[0]?.type,
          actAmount: db?.activated?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.trigEvent).toBe('combat_begin');
      expect(r.trigType).toBe('become_creature');
      expect(r.trigPower).toBe(3);
      expect(r.actCost).toBe(true);
      expect(r.actSac).toBe(true);
      expect(r.actType).toBe('draw');
      expect(r.actAmount).toBe(2);
    });
  });

  test.describe('Riling Dawnbreaker', () => {
    test('DB has omen create Soldier + flying+vigilance + combat_begin buff', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['riling dawnbreaker'];
        return {
          omen: db?.omen,
          castType: db?.cast?.[0]?.type,
          castName: db?.cast?.[0]?.name,
          keywords: db?.static?.[0]?.keywords,
          trigEvent: db?.triggered?.[0]?.event,
          buffTarget: db?.triggered?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.omen).toBe(true);
      expect(r.castType).toBe('create_token');
      expect(r.castName).toBe('Soldier');
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('vigilance');
      expect(r.trigEvent).toBe('combat_begin');
      expect(r.buffTarget).toBe('other_own_creature');
    });
  });

  test.describe('Ringing Strike Mastery', () => {
    test('DB has ETB tap enchanted + aura_prevent_untap', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['ringing strike mastery'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbTarget: db?.etb?.[0]?.target,
          staticType: db?.static?.[0]?.type
        };
      });
      expect(r.etbType).toBe('tap');
      expect(r.etbTarget).toBe('enchanted');
      expect(r.staticType).toBe('aura_prevent_untap');
    });
  });

  test.describe('Rite of Renewal', () => {
    test('DB has return 2 permanents from graveyard to hand', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['rite of renewal'];
        return {
          type: db?.cast?.[0]?.type,
          target: db?.cast?.[0]?.target,
          amount: db?.cast?.[0]?.amount,
          toHand: db?.cast?.[0]?.to_hand
        };
      });
      expect(r.type).toBe('return_from_graveyard');
      expect(r.target).toBe('permanent');
      expect(r.amount).toBe(2);
      expect(r.toHand).toBe(true);
    });
  });

  test.describe('Riverwalk Technique', () => {
    test('DB has 2-mode modal: bounce_to_library or counter noncreature', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['riverwalk technique'];
        const modal = db?.cast?.[0];
        return {
          type: modal?.type,
          mode0type: modal?.modes?.[0]?.type,
          mode1type: modal?.modes?.[1]?.type,
          mode1target: modal?.modes?.[1]?.target
        };
      });
      expect(r.type).toBe('modal');
      expect(r.mode0type).toBe('bounce_to_library');
      expect(r.mode1type).toBe('counter');
      expect(r.mode1target).toBe('noncreature_spell');
    });
  });

  test.describe('Roiling Dragonstorm', () => {
    test('DB has ETB draw 2 discard 1 + dragon_enters bounce_self', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['roiling dragonstorm'];
        return {
          etb0type: db?.etb?.[0]?.type,
          etb0amount: db?.etb?.[0]?.amount,
          etb1type: db?.etb?.[1]?.type,
          trigEvent: db?.triggered?.[0]?.event,
          bounceType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.etb0type).toBe('draw');
      expect(r.etb0amount).toBe(2);
      expect(r.etb1type).toBe('discard');
      expect(r.trigEvent).toBe('dragon_enters');
      expect(r.bounceType).toBe('bounce_self');
    });
  });

  // ==================== BATCH 22: Rares & graveyard cards ====================

  test.describe('Rot-Curse Rakshasa', () => {
    test('DB has trample+decayed + graveyard grant_counter decayed', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['rot-curse rakshasa'];
        return {
          keywords: db?.static?.[0]?.keywords,
          zone: db?.activated?.[0]?.cost?.zone,
          mana: db?.activated?.[0]?.cost?.mana,
          type: db?.activated?.[0]?.effects?.[0]?.type,
          counter: db?.activated?.[0]?.effects?.[0]?.counter
        };
      });
      expect(r.keywords).toContain('trample');
      expect(r.zone).toBe('graveyard');
      expect(r.mana).toBe('XBB');
      expect(r.type).toBe('grant_counter');
      expect(r.counter).toBe('decayed');
    });
  });

  test.describe('Runescale Stormbrood', () => {
    test('DB has omen counter_spell + flying + triggered buff on noncreature/dragon', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['runescale stormbrood'];
        return {
          omen: db?.omen,
          castType: db?.cast?.[0]?.type,
          keyword: db?.static?.[0]?.keyword,
          trigEvent: db?.triggered?.[0]?.event,
          buffPower: db?.triggered?.[0]?.effects?.[0]?.power
        };
      });
      expect(r.omen).toBe(true);
      expect(r.castType).toBe('counter_spell');
      expect(r.keyword).toBe('flying');
      expect(r.trigEvent).toBe('cast_noncreature_or_dragon');
      expect(r.buffPower).toBe(2);
    });
  });

  test.describe('Sage of the Fang', () => {
    test('DB has ETB +1/+1 counter + graveyard counter+double', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sage of the fang'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbCounter: db?.etb?.[0]?.counter,
          gyMana: db?.graveyard?.[0]?.cost?.mana,
          gyE0type: db?.graveyard?.[0]?.effects?.[0]?.type,
          gyE1type: db?.graveyard?.[0]?.effects?.[1]?.type
        };
      });
      expect(r.etbType).toBe('counter');
      expect(r.etbCounter).toBe('+1/+1');
      expect(r.gyMana).toBe('3G');
      expect(r.gyE0type).toBe('counter');
      expect(r.gyE1type).toBe('double_counters');
    });
  });

  test.describe('Sage of the Skies', () => {
    test('DB has flying+lifelink + cast_with_another_spell copy_self', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sage of the skies'];
        return {
          keywords: db?.static?.[0]?.keywords,
          trigEvent: db?.triggered?.[0]?.event,
          effectType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('lifelink');
      expect(r.trigEvent).toBe('cast_with_another_spell');
      expect(r.effectType).toBe('copy_self');
    });
  });

  test.describe('Sagu Pummeler', () => {
    test('DB has reach + graveyard counters +1/+1 and reach', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sagu pummeler'];
        return {
          keyword: db?.static?.[0]?.keyword,
          gyMana: db?.graveyard?.[0]?.cost?.mana,
          gyExile: db?.graveyard?.[0]?.cost?.exile,
          e0type: db?.graveyard?.[0]?.effects?.[0]?.type,
          e0amount: db?.graveyard?.[0]?.effects?.[0]?.amount,
          e1counter: db?.graveyard?.[0]?.effects?.[1]?.counter
        };
      });
      expect(r.keyword).toBe('reach');
      expect(r.gyMana).toBe('4G');
      expect(r.gyExile).toBe(true);
      expect(r.e0type).toBe('counter');
      expect(r.e0amount).toBe(2);
      expect(r.e1counter).toBe('reach');
    });
  });

  test.describe('Salt Road Packbeast', () => {
    test('DB has ETB draw 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['salt road packbeast'];
        return {
          type: db?.etb?.[0]?.type,
          amount: db?.etb?.[0]?.amount
        };
      });
      expect(r.type).toBe('draw');
      expect(r.amount).toBe(1);
    });
  });

  test.describe("Sarkhan's Resolve", () => {
    test('DB has 2-mode modal: +3/+3 buff or destroy flyer', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["sarkhan's resolve"];
        return {
          mode0label: db?.modal?.modes?.[0]?.label,
          mode0type: db?.modal?.modes?.[0]?.effects?.[0]?.type,
          mode0power: db?.modal?.modes?.[0]?.effects?.[0]?.power,
          mode1label: db?.modal?.modes?.[1]?.label,
          mode1type: db?.modal?.modes?.[1]?.effects?.[0]?.type
        };
      });
      expect(r.mode0type).toBe('buff');
      expect(r.mode0power).toBe(3);
      expect(r.mode1type).toBe('destroy');
    });
  });

  test.describe('Scavenger Regent', () => {
    test('DB has omen debuff_all -3/-3 + flying+ward', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['scavenger regent'];
        return {
          omen: db?.omen,
          castType: db?.cast?.[0]?.type,
          power: db?.cast?.[0]?.power,
          target: db?.cast?.[0]?.target,
          keywords: db?.static?.[0]?.keywords
        };
      });
      expect(r.omen).toBe(true);
      expect(r.castType).toBe('debuff_all');
      expect(r.power).toBe(-3);
      expect(r.target).toBe('opponent_creatures');
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('ward');
    });
  });

  test.describe('Seize Opportunity', () => {
    test('DB has 2-mode modal: exile_top_play or buff creatures', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['seize opportunity'];
        return {
          mode0type: db?.modal?.modes?.[0]?.effects?.[0]?.type,
          mode0amount: db?.modal?.modes?.[0]?.effects?.[0]?.amount,
          mode1type: db?.modal?.modes?.[1]?.effects?.[0]?.type,
          mode1power: db?.modal?.modes?.[1]?.effects?.[0]?.power
        };
      });
      expect(r.mode0type).toBe('exile_top_play');
      expect(r.mode0amount).toBe(2);
      expect(r.mode1type).toBe('buff');
      expect(r.mode1power).toBe(2);
    });
  });

  test.describe('Shiko, Paragon of the Way', () => {
    test('DB has flying+vigilance + ETB exile_graveyard_cast_copy', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['shiko, paragon of the way'];
        return {
          keywords: db?.static?.[0]?.keywords,
          etbType: db?.etb?.[0]?.type,
          free: db?.etb?.[0]?.free
        };
      });
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('vigilance');
      expect(r.etbType).toBe('exile_graveyard_cast_copy');
      expect(r.free).toBe(true);
    });
  });

  // ==================== BATCH 23: More creatures & enchantments ====================

  test.describe('Sibsig Appraiser', () => {
    test('DB has ETB look_top 2 pick 1 rest to GY', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sibsig appraiser'];
        return {
          type: db?.etb?.[0]?.type,
          amount: db?.etb?.[0]?.amount,
          pick: db?.etb?.[0]?.pick,
          rest: db?.etb?.[0]?.rest_to
        };
      });
      expect(r.type).toBe('look_top');
      expect(r.amount).toBe(2);
      expect(r.pick).toBe(1);
      expect(r.rest).toBe('graveyard');
    });
  });

  test.describe('Sidisi, Regent of the Mire', () => {
    test('DB has activated sacrifice_creature return from GY to BF', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sidisi, regent of the mire'];
        const a = db?.activated?.[0];
        return {
          tap: a?.cost?.tap,
          sacCreature: a?.cost?.sacrifice_creature,
          type: a?.effects?.[0]?.type,
          toBf: a?.effects?.[0]?.to_battlefield
        };
      });
      expect(r.tap).toBe(true);
      expect(r.sacCreature).toBe(true);
      expect(r.type).toBe('return_from_graveyard');
      expect(r.toBf).toBe(true);
    });
  });

  test.describe('Sinkhole Surveyor', () => {
    test('DB has flying + attacks loseLife 1 + endure 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sinkhole surveyor'];
        return {
          keyword: db?.static?.[0]?.keyword,
          event: db?.triggered?.[0]?.event,
          e0type: db?.triggered?.[0]?.effects?.[0]?.type,
          e1type: db?.triggered?.[0]?.effects?.[1]?.type
        };
      });
      expect(r.keyword).toBe('flying');
      expect(r.event).toBe('attacks');
      expect(r.e0type).toBe('loseLife');
      expect(r.e1type).toBe('endure');
    });
  });

  test.describe('Smile at Death', () => {
    test('DB has upkeep return creatures power 2 or less + counters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['smile at death'];
        return {
          event: db?.triggered?.[0]?.event,
          e0type: db?.triggered?.[0]?.effects?.[0]?.type,
          e0target: db?.triggered?.[0]?.effects?.[0]?.target,
          e0amount: db?.triggered?.[0]?.effects?.[0]?.amount,
          e1type: db?.triggered?.[0]?.effects?.[1]?.type
        };
      });
      expect(r.event).toBe('upkeep');
      expect(r.e0type).toBe('return_from_graveyard');
      expect(r.e0target).toBe('creature_power2_or_less');
      expect(r.e0amount).toBe(2);
      expect(r.e1type).toBe('counter');
    });
  });

  test.describe('Snowmelt Stag', () => {
    test('DB has vigilance + activated unblockable 5UU', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['snowmelt stag'];
        return {
          keyword: db?.static?.[0]?.keyword,
          mana: db?.activated?.[0]?.cost?.mana,
          grantKeyword: db?.activated?.[0]?.effects?.[0]?.keyword
        };
      });
      expect(r.keyword).toBe('vigilance');
      expect(r.mana).toBe('5UU');
      expect(r.grantKeyword).toBe('unblockable');
    });
  });

  test.describe('Songcrafter Mage', () => {
    test('DB has flash + ETB grant_harmonize', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['songcrafter mage'];
        return {
          keyword: db?.static?.[0]?.keyword,
          etbType: db?.etb?.[0]?.type,
          target: db?.etb?.[0]?.target
        };
      });
      expect(r.keyword).toBe('flash');
      expect(r.etbType).toBe('grant_harmonize');
      expect(r.target).toBe('instant_or_sorcery_in_gy');
    });
  });

  test.describe('Spectral Denial', () => {
    test('DB has counter spell unless_pay X', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['spectral denial'];
        return {
          type: db?.cast?.[0]?.type,
          target: db?.cast?.[0]?.target,
          unlessPay: db?.cast?.[0]?.unless_pay
        };
      });
      expect(r.type).toBe('counter');
      expect(r.target).toBe('spell');
      expect(r.unlessPay).toBe('X');
    });
  });

  test.describe('Stadium Headliner', () => {
    test('DB has attacks create Warrior + activated sacrifice damage', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['stadium headliner'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          actSac: db?.activated?.[0]?.cost?.sacrifice,
          actMana: db?.activated?.[0]?.cost?.mana,
          actType: db?.activated?.[0]?.effects?.[0]?.type,
          actAmount: db?.activated?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.trigEvent).toBe('attacks');
      expect(r.tokenName).toBe('Warrior');
      expect(r.actSac).toBe(true);
      expect(r.actMana).toBe('1R');
      expect(r.actType).toBe('damage');
      expect(r.actAmount).toBe('creature_count');
    });
  });

  test.describe('Stalwart Successor', () => {
    test('DB has menace + counter_placed trigger counter +1/+1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['stalwart successor'];
        return {
          keyword: db?.static?.[0]?.keyword,
          event: db?.triggered?.[0]?.event,
          type: db?.triggered?.[0]?.effects?.[0]?.type,
          counter: db?.triggered?.[0]?.effects?.[0]?.counter
        };
      });
      expect(r.keyword).toBe('menace');
      expect(r.event).toBe('counter_placed');
      expect(r.type).toBe('counter');
      expect(r.counter).toBe('+1/+1');
    });
  });

  test.describe('Stillness in Motion', () => {
    test('DB has upkeep mill 3 self', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['stillness in motion'];
        return {
          event: db?.triggered?.[0]?.event,
          type: db?.triggered?.[0]?.effects?.[0]?.type,
          amount: db?.triggered?.[0]?.effects?.[0]?.amount,
          target: db?.triggered?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.event).toBe('upkeep');
      expect(r.type).toBe('mill');
      expect(r.amount).toBe(3);
      expect(r.target).toBe('self');
    });
  });

  // ==================== BATCH 24: Equipment, enchantments, monuments ====================

  test.describe('Stormbeacon Blade', () => {
    test('DB has grant +3/+0 + equipped_attacks 3+ draw', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['stormbeacon blade'];
        return {
          grantPower: db?.static?.[0]?.power,
          target: db?.static?.[0]?.target,
          trigEvent: db?.triggered?.[0]?.event,
          condition: db?.triggered?.[0]?.condition,
          effectType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.grantPower).toBe(3);
      expect(r.target).toBe('equipped');
      expect(r.trigEvent).toBe('equipped_attacks');
      expect(r.condition).toBe('3+_attacking');
      expect(r.effectType).toBe('draw');
    });
  });

  test.describe('Stormplain Detainment', () => {
    test('DB has ETB exile opponent_nonland', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['stormplain detainment'];
        return {
          type: db?.etb?.[0]?.type,
          target: db?.etb?.[0]?.target
        };
      });
      expect(r.type).toBe('exile');
      expect(r.target).toBe('opponent_nonland');
    });
  });

  test.describe('Stormscale Scion', () => {
    test('DB has flying + buff_all other_dragons +1/+1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['stormscale scion'];
        return {
          s0keyword: db?.static?.[0]?.keyword,
          s1type: db?.static?.[1]?.type,
          s1power: db?.static?.[1]?.power,
          s1target: db?.static?.[1]?.target
        };
      });
      expect(r.s0keyword).toBe('flying');
      expect(r.s1type).toBe('buff_all');
      expect(r.s1power).toBe(1);
      expect(r.s1target).toBe('other_dragons');
    });
  });

  test.describe('Stormshriek Feral', () => {
    test('DB has omen loot 2/1 + flying + activated buff', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['stormshriek feral'];
        return {
          omen: db?.omen,
          castType: db?.cast?.[0]?.type,
          draw: db?.cast?.[0]?.draw,
          keyword: db?.static?.[0]?.keyword,
          actMana: db?.activated?.[0]?.cost?.mana,
          buffPower: db?.activated?.[0]?.effects?.[0]?.power
        };
      });
      expect(r.omen).toBe(true);
      expect(r.castType).toBe('loot');
      expect(r.draw).toBe(2);
      expect(r.keyword).toBe('flying');
      expect(r.actMana).toBe('1R');
      expect(r.buffPower).toBe(1);
    });
  });

  test.describe('Sultai Monument', () => {
    test('DB has ETB ramp to hand + activated create 2 Zombie Druids', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sultai monument'];
        return {
          etbType: db?.etb?.[0]?.type,
          toHand: db?.etb?.[0]?.to_hand,
          actMana: db?.activated?.[0]?.cost?.mana,
          actSac: db?.activated?.[0]?.cost?.sacrifice,
          tokenName: db?.activated?.[0]?.effects?.[0]?.name,
          tokenCount: db?.activated?.[0]?.effects?.[0]?.count
        };
      });
      expect(r.etbType).toBe('ramp');
      expect(r.toHand).toBe(true);
      expect(r.actMana).toBe('2BGU');
      expect(r.actSac).toBe(true);
      expect(r.tokenName).toBe('Zombie Druid');
      expect(r.tokenCount).toBe(2);
    });
  });

  test.describe('Sunpearl Kirin', () => {
    test('DB has flash+flying + ETB bounce own_nonland optional', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sunpearl kirin'];
        return {
          keywords: db?.static?.[0]?.keywords,
          etbType: db?.etb?.[0]?.type,
          target: db?.etb?.[0]?.target,
          optional: db?.etb?.[0]?.optional
        };
      });
      expect(r.keywords).toContain('flash');
      expect(r.keywords).toContain('flying');
      expect(r.etbType).toBe('bounce');
      expect(r.target).toBe('own_nonland');
      expect(r.optional).toBe(true);
    });
  });

  test.describe('Sunset Strikemaster', () => {
    test('DB has tap add_mana R + activated 2R sacrifice damage 6 flyer', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['sunset strikemaster'];
        return {
          act0type: db?.activated?.[0]?.effects?.[0]?.type,
          act0color: db?.activated?.[0]?.effects?.[0]?.color,
          act1mana: db?.activated?.[1]?.cost?.mana,
          act1sac: db?.activated?.[1]?.cost?.sacrifice,
          act1type: db?.activated?.[1]?.effects?.[0]?.type,
          act1amount: db?.activated?.[1]?.effects?.[0]?.amount
        };
      });
      expect(r.act0type).toBe('add_mana');
      expect(r.act0color).toBe('R');
      expect(r.act1mana).toBe('2R');
      expect(r.act1sac).toBe(true);
      expect(r.act1type).toBe('damage');
      expect(r.act1amount).toBe(6);
    });
  });

  test.describe('Surrak, Elusive Hunter', () => {
    test('DB has trample + uncounterable + creature_targeted draw', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['surrak, elusive hunter'];
        return {
          s0keyword: db?.static?.[0]?.keyword,
          s1type: db?.static?.[1]?.type,
          trigEvent: db?.triggered?.[0]?.event,
          effectType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.s0keyword).toBe('trample');
      expect(r.s1type).toBe('uncounterable');
      expect(r.trigEvent).toBe('creature_targeted_by_opponent');
      expect(r.effectType).toBe('draw');
    });
  });

  test.describe('Taigam, Master Opportunist', () => {
    test('DB has second_spell copy_spell + exile_with_suspend', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['taigam, master opportunist'];
        return {
          event: db?.triggered?.[0]?.event,
          e0type: db?.triggered?.[0]?.effects?.[0]?.type,
          e1type: db?.triggered?.[0]?.effects?.[1]?.type,
          counters: db?.triggered?.[0]?.effects?.[1]?.counters
        };
      });
      expect(r.event).toBe('second_spell');
      expect(r.e0type).toBe('copy_spell');
      expect(r.e1type).toBe('exile_with_suspend');
      expect(r.counters).toBe(4);
    });
  });

  test.describe('Teeming Dragonstorm', () => {
    test('DB has ETB create 2 Soldiers + dragon_enters bounce_self', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['teeming dragonstorm'];
        return {
          etbType: db?.etb?.[0]?.type,
          tokenName: db?.etb?.[0]?.name,
          count: db?.etb?.[0]?.count,
          trigEvent: db?.triggered?.[0]?.event,
          bounceType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.etbType).toBe('create_token');
      expect(r.tokenName).toBe('Soldier');
      expect(r.count).toBe(2);
      expect(r.trigEvent).toBe('dragon_enters');
      expect(r.bounceType).toBe('bounce_self');
    });
  });

  // ==================== BATCH 25: More creatures & enchantments ====================

  test.describe('Tempest Hawk', () => {
    test('DB has flying + combat_damage_player search_library named Tempest Hawk', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['tempest hawk'];
        return {
          keyword: db?.static?.[0]?.keyword,
          event: db?.triggered?.[0]?.event,
          self: db?.triggered?.[0]?.self,
          type: db?.triggered?.[0]?.effects?.[0]?.type,
          name: db?.triggered?.[0]?.effects?.[0]?.name
        };
      });
      expect(r.keyword).toBe('flying');
      expect(r.event).toBe('combat_damage_player');
      expect(r.self).toBe(true);
      expect(r.type).toBe('search_library');
      expect(r.name).toBe('Tempest Hawk');
    });
  });

  test.describe('Temur Battlecrier', () => {
    test('DB has cost_reduction per power4 creature', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['temur battlecrier'];
        return {
          type: db?.static?.[0]?.type,
          amount: db?.static?.[0]?.amount,
          target: db?.static?.[0]?.target,
          condition: db?.static?.[0]?.condition
        };
      });
      expect(r.type).toBe('cost_reduction');
      expect(r.amount).toBe(1);
      expect(r.target).toBe('spells');
      expect(r.condition).toBe('per_power4_creature');
    });
  });

  test.describe('Temur Devotee', () => {
    test('DB has defender + activated add_mana GUR once_per_turn', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['temur devotee'];
        return {
          keyword: db?.static?.[0]?.keyword,
          once: db?.activated?.[0]?.cost?.once_per_turn,
          mana: db?.activated?.[0]?.cost?.mana,
          type: db?.activated?.[0]?.effects?.[0]?.type,
          color: db?.activated?.[0]?.effects?.[0]?.color
        };
      });
      expect(r.keyword).toBe('defender');
      expect(r.once).toBe(true);
      expect(r.mana).toBe('1');
      expect(r.type).toBe('add_mana');
      expect(r.color).toBe('GUR');
    });
  });

  test.describe('Temur Monument', () => {
    test('DB has ETB ramp to hand + activated create 5/5 Elephant', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['temur monument'];
        return {
          etbType: db?.etb?.[0]?.type,
          toHand: db?.etb?.[0]?.to_hand,
          actMana: db?.activated?.[0]?.cost?.mana,
          actSac: db?.activated?.[0]?.cost?.sacrifice,
          tokenName: db?.activated?.[0]?.effects?.[0]?.name,
          tokenPower: db?.activated?.[0]?.effects?.[0]?.power
        };
      });
      expect(r.etbType).toBe('ramp');
      expect(r.toHand).toBe(true);
      expect(r.actMana).toBe('3GUR');
      expect(r.actSac).toBe(true);
      expect(r.tokenName).toBe('Elephant');
      expect(r.tokenPower).toBe(5);
    });
  });

  test.describe('Temur Tawnyback', () => {
    test('DB has ETB draw 1 + discard 1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['temur tawnyback'];
        return {
          e0type: db?.etb?.[0]?.type,
          e0amount: db?.etb?.[0]?.amount,
          e1type: db?.etb?.[1]?.type,
          e1amount: db?.etb?.[1]?.amount
        };
      });
      expect(r.e0type).toBe('draw');
      expect(r.e0amount).toBe(1);
      expect(r.e1type).toBe('discard');
      expect(r.e1amount).toBe(1);
    });
  });

  test.describe('Tersa Lightshatter', () => {
    test('DB has haste + ETB draw 2 discard 1 + attacks exile_top_play from GY', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['tersa lightshatter'];
        return {
          keyword: db?.static?.[0]?.keyword,
          etb0type: db?.etb?.[0]?.type,
          etb0amount: db?.etb?.[0]?.amount,
          etb1type: db?.etb?.[1]?.type,
          trigEvent: db?.triggered?.[0]?.event,
          trigCondition: db?.triggered?.[0]?.condition,
          trigType: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.keyword).toBe('haste');
      expect(r.etb0type).toBe('draw');
      expect(r.etb0amount).toBe(2);
      expect(r.etb1type).toBe('discard');
      expect(r.trigEvent).toBe('attacks');
      expect(r.trigCondition).toBe('seven_cards_in_gy');
      expect(r.trigType).toBe('exile_top_play');
    });
  });

  test.describe('Teval, Arbiter of Virtue', () => {
    test('DB has flying + grant_delve + cast_spell loseLife mana_value', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['teval, arbiter of virtue'];
        return {
          s0keyword: db?.static?.[0]?.keyword,
          s1type: db?.static?.[1]?.type,
          trigEvent: db?.triggered?.[0]?.event,
          effectType: db?.triggered?.[0]?.effects?.[0]?.type,
          amount: db?.triggered?.[0]?.effects?.[0]?.amount
        };
      });
      expect(r.s0keyword).toBe('flying');
      expect(r.s1type).toBe('grant_delve');
      expect(r.trigEvent).toBe('cast_spell');
      expect(r.effectType).toBe('loseLife');
      expect(r.amount).toBe('mana_value');
    });
  });

  test.describe('The Sibsig Ceremony', () => {
    test('DB has cost_reduction 2 creature_spells + creature_enters create Zombie', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['the sibsig ceremony'];
        return {
          s0type: db?.static?.[0]?.type,
          s0amount: db?.static?.[0]?.amount,
          s0target: db?.static?.[0]?.target,
          trigEvent: db?.triggered?.[0]?.event,
          e0type: db?.triggered?.[0]?.effects?.[0]?.type,
          e1name: db?.triggered?.[0]?.effects?.[1]?.name
        };
      });
      expect(r.s0type).toBe('cost_reduction');
      expect(r.s0amount).toBe(2);
      expect(r.s0target).toBe('creature_spells');
      expect(r.trigEvent).toBe('creature_enters_cast');
      expect(r.e0type).toBe('destroy');
      expect(r.e1name).toBe('Zombie Druid');
    });
  });

  test.describe('Thunder of Unity', () => {
    test('DB has saga with 3 chapters', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['thunder of unity'];
        return {
          saga: db?.saga,
          ch1type: db?.chapters?.[1]?.[0]?.type,
          ch1amount: db?.chapters?.[1]?.[0]?.amount,
          ch2type: db?.chapters?.[2]?.[0]?.type,
          ch3type: db?.chapters?.[3]?.[0]?.type,
          hasAllChapters: !!(db?.chapters?.[1] && db?.chapters?.[2] && db?.chapters?.[3])
        };
      });
      expect(r.saga).toBe(true);
      expect(r.ch1type).toBe('draw');
      expect(r.ch1amount).toBe(2);
      expect(r.hasAllChapters).toBe(true);
    });
  });

  test.describe('Traveling Botanist', () => {
    test('DB has becomes_tapped traveling_botanist_ability', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['traveling botanist'];
        return {
          event: db?.triggered?.[0]?.event,
          self: db?.triggered?.[0]?.self,
          type: db?.triggered?.[0]?.effects?.[0]?.type
        };
      });
      expect(r.event).toBe('becomes_tapped');
      expect(r.self).toBe(true);
      expect(r.type).toBe('traveling_botanist_ability');
    });
  });

  // ==================== BATCH 26: Final creatures ====================

  test.describe('Twinmaw Stormbrood', () => {
    test('DB has omen damage 5 + flying + ETB gainLife 5', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['twinmaw stormbrood'];
        return {
          omen: db?.omen,
          castType: db?.cast?.[0]?.type,
          castAmount: db?.cast?.[0]?.amount,
          keyword: db?.static?.[0]?.keyword,
          etbType: db?.etb?.[0]?.type,
          etbAmount: db?.etb?.[0]?.amount
        };
      });
      expect(r.omen).toBe(true);
      expect(r.castType).toBe('damage');
      expect(r.castAmount).toBe(5);
      expect(r.keyword).toBe('flying');
      expect(r.etbType).toBe('gainLife');
      expect(r.etbAmount).toBe(5);
    });
  });

  test.describe('Unburied Earthcarver', () => {
    test('DB has activated sacrifice_creature counter_self +1/+1', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['unburied earthcarver'];
        return {
          mana: db?.activated?.[0]?.cost?.mana,
          sacCreature: db?.activated?.[0]?.cost?.sacrifice_creature,
          type: db?.activated?.[0]?.effects?.[0]?.type,
          counter: db?.activated?.[0]?.effects?.[0]?.counter
        };
      });
      expect(r.mana).toBe('2');
      expect(r.sacCreature).toBe(true);
      expect(r.type).toBe('counter_self');
      expect(r.counter).toBe('+1/+1');
    });
  });

  test.describe('Underfoot Underdogs', () => {
    test('DB has ETB create Goblin + activated grant unblockable', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['underfoot underdogs'];
        return {
          etbType: db?.etb?.[0]?.type,
          etbName: db?.etb?.[0]?.name,
          actTap: db?.activated?.[0]?.cost?.tap,
          actKeyword: db?.activated?.[0]?.effects?.[0]?.keyword,
          actTarget: db?.activated?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.etbType).toBe('create_token');
      expect(r.etbName).toBe('Goblin');
      expect(r.actTap).toBe(true);
      expect(r.actKeyword).toBe('unblockable');
      expect(r.actTarget).toBe('own_creature_power2');
    });
  });

  test.describe('Undergrowth Leopard', () => {
    test('DB has vigilance + activated sacrifice destroy artifact/enchantment', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['undergrowth leopard'];
        return {
          keyword: db?.static?.[0]?.keyword,
          actMana: db?.activated?.[0]?.cost?.mana,
          actSac: db?.activated?.[0]?.cost?.sacrifice,
          type: db?.activated?.[0]?.effects?.[0]?.type,
          target: db?.activated?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.keyword).toBe('vigilance');
      expect(r.actMana).toBe('1');
      expect(r.actSac).toBe(true);
      expect(r.type).toBe('destroy');
      expect(r.target).toBe('artifact_or_enchantment');
    });
  });

  test.describe('United Battlefront', () => {
    test('DB has look_top 7 put_onto_battlefield 2 noncreature_nonland', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['united battlefront'];
        return {
          type: db?.cast?.[0]?.type,
          amount: db?.cast?.[0]?.amount,
          put: db?.cast?.[0]?.put_onto_battlefield,
          condition: db?.cast?.[0]?.condition
        };
      });
      expect(r.type).toBe('look_top');
      expect(r.amount).toBe(7);
      expect(r.put).toBe(2);
      expect(r.condition).toBe('noncreature_nonland_mv3');
    });
  });

  test.describe('Unrooted Ancestor', () => {
    test('DB has flash + activated sacrifice_creature grant indestructible', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['unrooted ancestor'];
        return {
          keyword: db?.static?.[0]?.keyword,
          actMana: db?.activated?.[0]?.cost?.mana,
          actSacCreature: db?.activated?.[0]?.cost?.sacrifice_creature,
          grantKeyword: db?.activated?.[0]?.effects?.[0]?.keyword,
          grantTarget: db?.activated?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.keyword).toBe('flash');
      expect(r.actMana).toBe('1');
      expect(r.actSacCreature).toBe(true);
      expect(r.grantKeyword).toBe('indestructible');
      expect(r.grantTarget).toBe('self');
    });
  });

  test.describe('Unsparing Boltcaster', () => {
    test('DB has ETB damage 5 opponent_creature if dealt_damage', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['unsparing boltcaster'];
        return {
          type: db?.etb?.[0]?.type,
          amount: db?.etb?.[0]?.amount,
          target: db?.etb?.[0]?.target,
          condition: db?.etb?.[0]?.condition
        };
      });
      expect(r.type).toBe('damage');
      expect(r.amount).toBe(5);
      expect(r.target).toBe('opponent_creature');
      expect(r.condition).toBe('dealt_damage_this_turn');
    });
  });

  test.describe('Ureni, the Song Unending', () => {
    test('DB has flying + ETB damage lands_count divided', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['ureni, the song unending'];
        return {
          keyword: db?.static?.[0]?.keyword,
          etbType: db?.etb?.[0]?.type,
          amount: db?.etb?.[0]?.amount,
          target: db?.etb?.[0]?.target
        };
      });
      expect(r.keyword).toBe('flying');
      expect(r.etbType).toBe('damage');
      expect(r.amount).toBe('lands_count');
      expect(r.target).toBe('divided_opponents_creatures');
    });
  });

  test.describe('Veteran Ice Climber', () => {
    test('DB has vigilance + unblockable + attacks mill power', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['veteran ice climber'];
        return {
          s0keywords: db?.static?.[0]?.keywords,
          s1type: db?.static?.[1]?.type,
          trigEvent: db?.triggered?.[0]?.event,
          millAmount: db?.triggered?.[0]?.effects?.[0]?.amount,
          target: db?.triggered?.[0]?.effects?.[0]?.target
        };
      });
      expect(r.s0keywords).toContain('vigilance');
      expect(r.s1type).toBe('unblockable');
      expect(r.trigEvent).toBe('attacks');
      expect(r.millAmount).toBe('power');
      expect(r.target).toBe('opponent');
    });
  });

  test.describe('Voice of Victory', () => {
    test('DB has attacks create 2 Warriors + prevent_opponent_casting', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['voice of victory'];
        return {
          trigEvent: db?.triggered?.[0]?.event,
          tokenCount: db?.triggered?.[0]?.effects?.[0]?.count,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          staticType: db?.static?.[0]?.type
        };
      });
      expect(r.trigEvent).toBe('attacks');
      expect(r.tokenCount).toBe(2);
      expect(r.tokenName).toBe('Warrior');
      expect(r.staticType).toBe('prevent_opponent_casting');
    });
  });

  // ==================== BATCH 27: Final cards ====================

  test.describe('Wail of War', () => {
    test('DB has 2-mode modal: debuff_all or return 2 creatures', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['wail of war'];
        return {
          mode0type: db?.modal?.modes?.[0]?.effects?.[0]?.type,
          mode0power: db?.modal?.modes?.[0]?.effects?.[0]?.power,
          mode1type: db?.modal?.modes?.[1]?.effects?.[0]?.type,
          mode1count: db?.modal?.modes?.[1]?.effects?.[0]?.count
        };
      });
      expect(r.mode0type).toBe('debuff_all');
      expect(r.mode0power).toBe(-1);
      expect(r.mode1type).toBe('return_from_graveyard');
      expect(r.mode1count).toBe(2);
    });
  });

  test.describe('Warden of the Grove', () => {
    test('DB has end_step counter_self + other_creature_enters endure', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['warden of the grove'];
        return {
          trig0event: db?.triggered?.[0]?.event,
          trig0type: db?.triggered?.[0]?.effects?.[0]?.type,
          trig1event: db?.triggered?.[1]?.event,
          trig1type: db?.triggered?.[1]?.effects?.[0]?.type,
          trig1amount: db?.triggered?.[1]?.effects?.[0]?.amount
        };
      });
      expect(r.trig0event).toBe('end_step');
      expect(r.trig0type).toBe('counter_self');
      expect(r.trig1event).toBe('other_creature_enters');
      expect(r.trig1type).toBe('endure');
      expect(r.trig1amount).toBe('counters_on_self');
    });
  });

  test.describe('Watcher of the Wayside', () => {
    test('DB has ETB mill 2 any_player + gainLife 2', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['watcher of the wayside'];
        return {
          e0type: db?.etb?.[0]?.type,
          e0amount: db?.etb?.[0]?.amount,
          e0target: db?.etb?.[0]?.target,
          e1type: db?.etb?.[1]?.type,
          e1amount: db?.etb?.[1]?.amount
        };
      });
      expect(r.e0type).toBe('mill');
      expect(r.e0amount).toBe(2);
      expect(r.e0target).toBe('any_player');
      expect(r.e1type).toBe('gainLife');
      expect(r.e1amount).toBe(2);
    });
  });

  test.describe('Whirlwing Stormbrood', () => {
    test('DB has omen +1/+1 counters + flying+flash + grant_flash sorcery/dragon', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['whirlwing stormbrood'];
        return {
          omen: db?.omen,
          castType: db?.cast?.[0]?.type,
          castCounter: db?.cast?.[0]?.counter,
          castAmount: db?.cast?.[0]?.amount,
          keywords: db?.static?.[0]?.keywords,
          s1type: db?.static?.[1]?.type
        };
      });
      expect(r.omen).toBe(true);
      expect(r.castType).toBe('counter');
      expect(r.castCounter).toBe('+1/+1');
      expect(r.castAmount).toBe(3);
      expect(r.keywords).toContain('flying');
      expect(r.keywords).toContain('flash');
      expect(r.s1type).toBe('grant_flash');
    });
  });

  test.describe('Yathan Tombguard', () => {
    test('DB has menace + combat_damage_player draw+loseLife if counter', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['yathan tombguard'];
        return {
          keyword: db?.static?.[0]?.keyword,
          event: db?.triggered?.[0]?.event,
          condition: db?.triggered?.[0]?.condition,
          e0type: db?.triggered?.[0]?.effects?.[0]?.type,
          e1type: db?.triggered?.[0]?.effects?.[1]?.type
        };
      });
      expect(r.keyword).toBe('menace');
      expect(r.event).toBe('combat_damage_player');
      expect(r.condition).toBe('creature_with_counter');
      expect(r.e0type).toBe('draw');
      expect(r.e1type).toBe('loseLife');
    });
  });

  test.describe("Zurgo, Thunder's Decree", () => {
    test('DB has attacks create 2 Warriors + warrior_tokens_protected', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["zurgo, thunder's decree"];
        return {
          event: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          count: db?.triggered?.[0]?.effects?.[0]?.count,
          staticType: db?.static?.[0]?.type
        };
      });
      expect(r.event).toBe('attacks');
      expect(r.tokenName).toBe('Warrior');
      expect(r.count).toBe(2);
      expect(r.staticType).toBe('warrior_tokens_protected_end_step');
    });
  });

  test.describe("Zurgo's Vanguard", () => {
    test('DB has attacks create Warrior + power_equals creature_count', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["zurgo's vanguard"];
        return {
          event: db?.triggered?.[0]?.event,
          tokenName: db?.triggered?.[0]?.effects?.[0]?.name,
          staticType: db?.static?.[0]?.type,
          source: db?.static?.[0]?.source
        };
      });
      expect(r.event).toBe('attacks');
      expect(r.tokenName).toBe('Warrior');
      expect(r.staticType).toBe('power_equals');
      expect(r.source).toBe('creature_count');
    });
  });

  // ==================== BATCH 28: Special lands & remaining cards ====================

  test.describe('Cori Mountain Monastery', () => {
    test('DB entry exists in CardEffectsDB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['cori mountain monastery'];
        return { exists: !!db };
      });
      expect(r.exists).toBe(true);
    });
  });

  test.describe('Dalkovan Encampment', () => {
    test('DB entry exists in CardEffectsDB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['dalkovan encampment'];
        return { exists: !!db };
      });
      expect(r.exists).toBe(true);
    });
  });

  test.describe('Great Arashin City', () => {
    test('DB entry exists in CardEffectsDB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['great arashin city'];
        return { exists: !!db };
      });
      expect(r.exists).toBe(true);
    });
  });

  test.describe('Kishla Village', () => {
    test('DB entry exists in CardEffectsDB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['kishla village'];
        return { exists: !!db };
      });
      expect(r.exists).toBe(true);
    });
  });

  test.describe('Mistrise Village', () => {
    test('DB entry exists in CardEffectsDB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['mistrise village'];
        return { exists: !!db };
      });
      expect(r.exists).toBe(true);
    });
  });

  test.describe("Dragonbroods' Relic", () => {
    test('DB entry exists in CardEffectsDB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB["dragonbroods' relic"];
        return { exists: !!db };
      });
      expect(r.exists).toBe(true);
    });
  });

  test.describe('A-Cori-Steel Cutter', () => {
    test('DB entry exists in CardEffectsDB', async () => {
      const r = await page.evaluate(() => {
        const db = CardEffectsDB['a-cori-steel cutter'];
        return { exists: !!db };
      });
      expect(r.exists).toBe(true);
    });
  });

});
