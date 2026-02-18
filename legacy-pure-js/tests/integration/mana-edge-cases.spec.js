/**
 * Mana Edge Case Tests (Layer L)
 *
 * Tests mana parsing, payment, tapping logic, and edge cases:
 * Hybrid mana, Phyrexian, colorless, CMC safety nets,
 * dual land tapping preference, convoke, pool integration
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

test.describe('Mana Edge Cases', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  // =================== parseCost ===================

  test('parseCost: standard colored mana', async () => {
    const result = await page.evaluate(() => {
      return ManaSystem.parseCost('{2}{G}{R}');
    });
    expect(result.generic).toBe(2);
    expect(result.colored.G).toBe(1);
    expect(result.colored.R).toBe(1);
    expect(result.total).toBe(4);
  });

  test('parseCost: hybrid mana treated as generic', async () => {
    const result = await page.evaluate(() => {
      return ManaSystem.parseCost('{G/U}{G/U}');
    });
    expect(result.generic).toBe(2); // hybrid = generic
    expect(result.colored.G).toBe(0);
    expect(result.colored.U).toBe(0);
    expect(result.total).toBe(2);
  });

  test('parseCost: Phyrexian mana treated as colored', async () => {
    const result = await page.evaluate(() => {
      return ManaSystem.parseCost('{G/P}{R}');
    });
    expect(result.colored.G).toBe(1); // Phyrexian = colored
    expect(result.colored.R).toBe(1);
    expect(result.total).toBe(2);
  });

  test('parseCost: colorless {C} and snow {S} treated as generic', async () => {
    const result = await page.evaluate(() => {
      const c = ManaSystem.parseCost('{C}');
      const s = ManaSystem.parseCost('{S}');
      return { c, s };
    });
    expect(result.c.generic).toBe(1);
    expect(result.c.total).toBe(1);
    expect(result.s.generic).toBe(1);
    expect(result.s.total).toBe(1);
  });

  test('parseCost: X costs are ignored (0)', async () => {
    const result = await page.evaluate(() => {
      return ManaSystem.parseCost('{X}{R}{R}');
    });
    expect(result.generic).toBe(0); // X ignored
    expect(result.colored.R).toBe(2);
    expect(result.total).toBe(2);
  });

  test('parseCost: empty/null input returns zeros', async () => {
    const result = await page.evaluate(() => {
      const empty = ManaSystem.parseCost('');
      const nil = ManaSystem.parseCost(null);
      const undef = ManaSystem.parseCost(undefined);
      return { empty, nil, undef };
    });
    expect(result.empty.total).toBe(0);
    expect(result.nil.total).toBe(0);
    expect(result.undef.total).toBe(0);
  });

  // =================== canPay ===================

  test('canPay: exact match succeeds', async () => {
    const result = await page.evaluate(() => {
      const pool = { W: 0, U: 0, B: 0, R: 2, G: 1, C: 0 };
      return ManaSystem.canPay(pool, '{1}{R}{G}', 3);
    });
    expect(result).toBe(true);
  });

  test('canPay: wrong color fails', async () => {
    const result = await page.evaluate(() => {
      const pool = { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 };
      return ManaSystem.canPay(pool, '{1}{G}', 2);
    });
    expect(result).toBe(false); // no G available
  });

  test('canPay: CMC safety net when parsed total < cmc', async () => {
    const result = await page.evaluate(() => {
      // Cost string only has {G} (total=1) but cmc is 5
      // Safety net should use cmc=5
      const pool = { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 };
      return ManaSystem.canPay(pool, '{G}', 5);
    });
    expect(result).toBe(false); // only 3 mana, need 5
  });

  test('canPay: empty mana_cost falls back to CMC', async () => {
    const result = await page.evaluate(() => {
      const pool = { W: 0, U: 0, B: 0, R: 3, G: 2, C: 0 };
      return ManaSystem.canPay(pool, '', 4);
    });
    expect(result).toBe(true); // 5 total >= 4 cmc
  });

  test('canPay: hybrid pays with any color', async () => {
    const result = await page.evaluate(() => {
      const pool = { W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 };
      return ManaSystem.canPay(pool, '{G/U}{G/U}', 2);
    });
    expect(result).toBe(true); // hybrid = generic, R works
  });

  // =================== payMana ===================

  test('payMana: drains smallest pools first for generic', async () => {
    const result = await page.evaluate(() => {
      const pool = { W: 1, U: 0, B: 0, R: 3, G: 0, C: 0 };
      const after = ManaSystem.payMana(pool, '{2}{R}', 3);
      return after;
    });
    // Step 1: pay {R} colored → R: 3→2
    // Step 2: pay 2 generic, sort pools: W(1), R(2) → drain W(1) then R(1)
    // Result: W=0, R=1
    expect(result.R).toBe(1);
    expect(result.W).toBe(0);
  });

  // =================== getLandManaColors ===================

  test('getLandManaColors: basic lands detected by type line', async () => {
    const result = await page.evaluate(() => {
      const forest = { type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' };
      const island = { type_line: 'Basic Land — Island', oracle_text: '{T}: Add {U}.' };
      const mountain = { type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.' };
      return {
        forest: ManaSystem.getLandManaColors(forest),
        island: ManaSystem.getLandManaColors(island),
        mountain: ManaSystem.getLandManaColors(mountain)
      };
    });
    expect(result.forest).toEqual(['G']);
    expect(result.island).toEqual(['U']);
    expect(result.mountain).toEqual(['R']);
  });

  test('getLandManaColors: dual land produces both colors', async () => {
    const result = await page.evaluate(() => {
      const dual = { type_line: 'Land — Forest Mountain', oracle_text: '' };
      return ManaSystem.getLandManaColors(dual);
    });
    // Should have both G and R (Forest = G, Mountain = R)
    expect(result).toContain('G');
    expect(result).toContain('R');
    expect(result.length).toBe(2);
  });

  test('getLandManaColors: oracle text "add {W}" detected', async () => {
    const result = await page.evaluate(() => {
      // getLandManaColors checks for "add {x}" in oracle_text
      const land = { type_line: 'Land', oracle_text: '{T}: Add {W}. {T}: Add {B}.' };
      return ManaSystem.getLandManaColors(land);
    });
    expect(result).toContain('W');
    expect(result).toContain('B');
  });

  test('getLandManaColors: unknown land falls back to color_identity', async () => {
    const result = await page.evaluate(() => {
      const land = { type_line: 'Land', oracle_text: 'Some exotic ability.', color_identity: ['U', 'R'] };
      return ManaSystem.getLandManaColors(land);
    });
    expect(result).toContain('U');
    expect(result).toContain('R');
  });

  // =================== canAfford ===================

  test('canAfford: counts untapped lands, ignores tapped', async () => {
    const result = await page.evaluate(() => {
      const state = TestHelper.createTestState();

      // Add 2 untapped forests + 1 tapped forest
      const f1 = CardEngine.prepareForBattlefield(TestHelper.makeLand('Forest', 'G'));
      const f2 = CardEngine.prepareForBattlefield(TestHelper.makeLand('Forest', 'G'));
      const f3 = CardEngine.prepareForBattlefield(TestHelper.makeLand('Forest', 'G'));
      f1._summoningSick = false;
      f2._summoningSick = false;
      f3._summoningSick = false;
      f3._tapped = true;
      state.players[0].zones.battlefield.add(f1);
      state.players[0].zones.battlefield.add(f2);
      state.players[0].zones.battlefield.add(f3);

      const card2 = { mana_cost: '{1}{G}', cmc: 2 };
      const card3 = { mana_cost: '{2}{G}', cmc: 3 };

      return {
        canAfford2: ManaSystem.canAfford(state, 0, card2),
        canAfford3: ManaSystem.canAfford(state, 0, card3)
      };
    });
    expect(result.canAfford2).toBe(true);  // 2 untapped lands >= 2 cmc
    expect(result.canAfford3).toBe(false); // only 2 untapped, need 3
  });

  test('canAfford: dual lands count as 1 mana source, not 2', async () => {
    const result = await page.evaluate(() => {
      const state = TestHelper.createTestState();

      // Add 2 dual lands (Forest/Mountain)
      for (let i = 0; i < 2; i++) {
        const dual = CardEngine.prepareForBattlefield({
          id: 'dual_'+i, _uid: 'dual_'+i, name: 'Stomping Ground',
          type_line: 'Land — Mountain Forest',
          mana_cost: '', cmc: 0,
          oracle_text: '', colors: [], color_identity: ['R', 'G'],
          keywords: [], rarity: 'rare'
        });
        dual._summoningSick = false;
        state.players[0].zones.battlefield.add(dual);
      }

      const card2 = { mana_cost: '{R}{G}', cmc: 2 };
      const card3 = { mana_cost: '{1}{R}{G}', cmc: 3 };

      return {
        canAfford2: ManaSystem.canAfford(state, 0, card2),
        canAfford3: ManaSystem.canAfford(state, 0, card3)
      };
    });
    expect(result.canAfford2).toBe(true);  // 2 duals can pay {R}{G}
    expect(result.canAfford3).toBe(false); // only 2 land sources, need 3 total
  });

  // =================== autoTapForSpell ===================

  test('autoTapForSpell: prefers single-color lands for colored requirements', async () => {
    const result = await page.evaluate(() => {
      const state = TestHelper.createTestState();

      // 1 basic Forest, 1 basic Mountain, 1 dual Forest/Mountain
      const forest = CardEngine.prepareForBattlefield(TestHelper.makeLand('Forest', 'G'));
      const mountain = CardEngine.prepareForBattlefield(TestHelper.makeLand('Mountain', 'R'));
      const dual = CardEngine.prepareForBattlefield({
        id: 'dual', _uid: 'dual_0', name: 'Stomping Ground',
        type_line: 'Land — Mountain Forest',
        mana_cost: '', cmc: 0, oracle_text: '',
        colors: [], color_identity: ['R', 'G'],
        keywords: [], rarity: 'rare'
      });
      forest._summoningSick = false;
      mountain._summoningSick = false;
      dual._summoningSick = false;
      state.players[0].zones.battlefield.add(forest);
      state.players[0].zones.battlefield.add(mountain);
      state.players[0].zones.battlefield.add(dual);

      // Cast {1}{G} - should tap Forest for G, then something for generic
      const tapped = GameState.autoTapForSpell(state, 0, '{1}{G}', 2);

      // Forest should be tapped (single-color for G)
      // Either Mountain or Dual tapped for generic
      return {
        forestTapped: forest._tapped,
        tappedCount: tapped.length,
        pool: state.manaPool[0]
      };
    });
    expect(result.forestTapped).toBe(true); // single-color preferred
    expect(result.tappedCount).toBe(2);
  });

  test('autoTapForSpell: uses existing pool mana before tapping lands', async () => {
    const result = await page.evaluate(() => {
      const state = TestHelper.createTestState();

      // Add pool mana first
      state.manaPool[0] = { W: 0, U: 0, B: 0, R: 1, G: 1, C: 0 };

      // 2 forests on battlefield
      const f1 = CardEngine.prepareForBattlefield(TestHelper.makeLand('Forest', 'G'));
      const f2 = CardEngine.prepareForBattlefield(TestHelper.makeLand('Forest', 'G'));
      f1._summoningSick = false;
      f2._summoningSick = false;
      state.players[0].zones.battlefield.add(f1);
      state.players[0].zones.battlefield.add(f2);

      // Cast {1}{G} (cmc 2) - pool already has 1G + 1R = 2 mana
      const tapped = GameState.autoTapForSpell(state, 0, '{1}{G}', 2);

      return {
        tappedCount: tapped.length,
        f1Tapped: f1._tapped,
        f2Tapped: f2._tapped
      };
    });
    expect(result.tappedCount).toBe(0); // no lands needed, pool covers it
    expect(result.f1Tapped).toBe(false);
    expect(result.f2Tapped).toBe(false);
  });

  // =================== Convoke ===================

  test('autoConvoke: taps weakest creatures first', async () => {
    const result = await page.evaluate(() => {
      const state = TestHelper.createTestState();

      // 3 creatures: 1/1, 3/3, 5/5
      const c1 = CardEngine.prepareForBattlefield(
        TestHelper.makeCreature('Squirrel', 1, 1, { colors: ['G'] })
      );
      const c2 = CardEngine.prepareForBattlefield(
        TestHelper.makeCreature('Bear', 3, 3, { colors: ['G'] })
      );
      const c3 = CardEngine.prepareForBattlefield(
        TestHelper.makeCreature('Wurm', 5, 5, { colors: ['G'] })
      );
      c1._summoningSick = false;
      c2._summoningSick = false;
      c3._summoningSick = false;
      state.players[0].zones.battlefield.add(c1);
      state.players[0].zones.battlefield.add(c2);
      state.players[0].zones.battlefield.add(c3);

      // No lands, need to convoke 2 mana
      const tapped = ManaSystem.autoConvoke(state, 0, '{2}{G}{G}', 4);

      return {
        tapped,
        squirrelTapped: c1._tapped,
        bearTapped: c2._tapped,
        wurmTapped: c3._tapped
      };
    });
    // Should tap 3 creatures (all needed since no lands) but limited by spell cost
    // Actually deficit = 4 - 0 lands = 4, so needs 4 creatures but only 3
    expect(result.squirrelTapped).toBe(true); // weakest first
    expect(result.bearTapped).toBe(true); // next weakest
    expect(result.wurmTapped).toBe(true); // all needed
  });

  test('autoConvoke: not used when lands are sufficient', async () => {
    const result = await page.evaluate(() => {
      const state = TestHelper.createTestState();

      // 4 lands available
      for (let i = 0; i < 4; i++) {
        const l = CardEngine.prepareForBattlefield(TestHelper.makeLand('Forest', 'G'));
        l._summoningSick = false;
        state.players[0].zones.battlefield.add(l);
      }

      // 2 creatures
      const c1 = CardEngine.prepareForBattlefield(
        TestHelper.makeCreature('Elf', 1, 1, { colors: ['G'] })
      );
      c1._summoningSick = false;
      state.players[0].zones.battlefield.add(c1);

      const tapped = ManaSystem.autoConvoke(state, 0, '{3}{G}', 4);

      return {
        tapped,
        elfTapped: c1._tapped
      };
    });
    expect(result.tapped).toBe(0); // lands cover it
    expect(result.elfTapped).toBe(false);
  });

  // =================== Pool structure ===================

  test('createPool and emptyPool return correct structure', async () => {
    const result = await page.evaluate(() => {
      const pool = ManaSystem.createPool();
      const empty = ManaSystem.emptyPool();
      return { pool, empty };
    });

    const expected = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    expect(result.pool).toEqual(expected);
    expect(result.empty).toEqual(expected);
  });

  test('poolTotal sums all colors correctly', async () => {
    const result = await page.evaluate(() => {
      const pool = { W: 2, U: 1, B: 0, R: 3, G: 0, C: 1 };
      return ManaSystem.poolTotal(pool);
    });
    expect(result).toBe(7);
  });
});
