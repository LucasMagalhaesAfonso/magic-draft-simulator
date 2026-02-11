/**
 * Oracle Text Parser Tests
 *
 * Tests that parseSpellEffects, parseETBEffects, and parseTriggeredAbilities
 * correctly extract effects from real oracle text patterns.
 * This catches cards without CardEffectsDB entries that rely on oracle parsing.
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

test.describe('Oracle Text Parser', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  // =================== parseSpellEffects ===================

  test.describe('parseSpellEffects', () => {
    test('damage to creature', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Deal 3 damage to target creature.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'damage' && e.amount === 3)).toBe(true);
    });

    test('damage to any target', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Deals 4 damage to any target.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'damage' && e.amount === 4)).toBe(true);
    });

    test('destroy target creature', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Destroy target creature.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'destroy')).toBe(true);
    });

    test('destroy all creatures (board wipe)', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Destroy all creatures.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'destroy_all')).toBe(true);
    });

    test('draw cards with word number', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Draw three cards.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'draw' && e.amount === 3)).toBe(true);
    });

    test('draw a card', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Draw a card.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'draw' && e.amount === 1)).toBe(true);
    });

    test('gain life', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'You gain 5 life.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'gainLife' && e.amount === 5)).toBe(true);
    });

    test('opponent loses life', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Target opponent loses 3 life.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'loseLife' && e.amount === 3)).toBe(true);
    });

    test('buff target creature', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Target creature gets +3/+3 until end of turn.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'buff' && e.power === 3 && e.toughness === 3)).toBe(true);
    });

    test('+1/+1 counters', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Put two +1/+1 counters on target creature.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'counter' && e.amount === 2 && e.counter === '+1/+1')).toBe(true);
    });

    test('bounce (return to hand)', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: "Return target creature to its owner's hand." };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'bounce')).toBe(true);
    });

    test('scry', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Scry 2.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'scry' && e.amount === 2)).toBe(true);
    });

    test('mill', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Target player mills 4 cards.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'mill' && e.amount === 4)).toBe(true);
    });

    test('ramp (search for basic land)', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Search your library for a basic land card, put it onto the battlefield tapped.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'ramp')).toBe(true);
    });

    test('create token', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Create a 3/3 green Beast creature token.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'create_token' && e.power === 3 && e.toughness === 3)).toBe(true);
    });

    test('fight', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Target creature you control fights target creature you don\'t control.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'fight')).toBe(true);
    });

    test('exile target creature', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Exile target creature.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'exile')).toBe(true);
    });

    test('surveil', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Surveil 3, then draw a card.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'surveil' && e.amount === 3)).toBe(true);
      expect(result.some(e => e.type === 'draw')).toBe(true);
    });

    test('discard', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Target opponent discards two cards.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'discard' && e.target === 'opponent')).toBe(true);
    });

    test('prevent damage', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Prevent the next 3 damage that would be dealt to you.' };
        return CardEngine.parseSpellEffects(card);
      });
      expect(result.some(e => e.type === 'prevent_damage' && e.amount === 3)).toBe(true);
    });

    test('empty oracle text returns empty', async () => {
      const result = await page.evaluate(() => {
        return CardEngine.parseSpellEffects({ oracle_text: '' });
      });
      expect(result).toEqual([]);
    });
  });

  // =================== parseETBEffects ===================

  test.describe('parseETBEffects', () => {
    test('ETB damage', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Flame Imp', oracle_text: 'When Flame Imp enters the battlefield, it deals 2 damage to target creature.' };
        return CardEngine.parseETBEffects(card);
      });
      expect(result.some(e => e.type === 'damage' && e.amount === 2)).toBe(true);
    });

    test('ETB draw', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Sage', oracle_text: 'When Sage enters the battlefield, draw two cards.' };
        return CardEngine.parseETBEffects(card);
      });
      expect(result.some(e => e.type === 'draw' && e.amount === 2)).toBe(true);
    });

    test('ETB gain life', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Healer', oracle_text: 'When Healer enters the battlefield, you gain 3 life.' };
        return CardEngine.parseETBEffects(card);
      });
      expect(result.some(e => e.type === 'gainLife' && e.amount === 3)).toBe(true);
    });

    test('ETB scry', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Oracle', oracle_text: 'When Oracle enters the battlefield, scry 2.' };
        return CardEngine.parseETBEffects(card);
      });
      expect(result.some(e => e.type === 'scry' && e.amount === 2)).toBe(true);
    });

    test('ETB +1/+1 counter on self', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Hydra', oracle_text: 'Hydra enters the battlefield with three +1/+1 counters on it.' };
        return CardEngine.parseETBEffects(card);
      });
      expect(result.some(e => e.type === 'counter_self' && e.amount === 3)).toBe(true);
    });

    test('ETB create token', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Captain', oracle_text: 'When Captain enters the battlefield, create a 1/1 white Soldier creature token.' };
        return CardEngine.parseETBEffects(card);
      });
      expect(result.some(e => e.type === 'create_token' && e.power === 1)).toBe(true);
    });

    test('ETB destroy', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Reaper', oracle_text: 'When Reaper enters the battlefield, destroy target creature.' };
        return CardEngine.parseETBEffects(card);
      });
      expect(result.some(e => e.type === 'destroy')).toBe(true);
    });

    test('ETB bounce', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Djinn', oracle_text: "When Djinn enters the battlefield, return target creature to its owner's hand." };
        return CardEngine.parseETBEffects(card);
      });
      expect(result.some(e => e.type === 'bounce')).toBe(true);
    });

    test('EXCLUDES "whenever a creature enters" (not self ETB)', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Observer', oracle_text: 'Whenever a creature enters the battlefield under your control, draw a card.' };
        return CardEngine.parseETBEffects(card);
      });
      expect(result).toEqual([]);
    });

    test('EXCLUDES "whenever another creature enters"', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Watcher', oracle_text: 'Whenever another creature enters the battlefield, you gain 1 life.' };
        return CardEngine.parseETBEffects(card);
      });
      expect(result).toEqual([]);
    });

    test('Non-creature without ETB text returns empty', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Bear', oracle_text: 'Trample' };
        return CardEngine.parseETBEffects(card);
      });
      expect(result).toEqual([]);
    });
  });

  // =================== parseTriggeredAbilities ===================

  test.describe('parseTriggeredAbilities', () => {
    test('attacks trigger', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Warrior', oracle_text: 'Whenever Warrior attacks, draw a card.' };
        return CardEngine.parseTriggeredAbilities(card);
      });
      expect(result.some(t => t.event === 'attacks')).toBe(true);
    });

    test('combat damage to player trigger', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Rogue', oracle_text: 'Whenever Rogue deals combat damage to a player, draw a card.' };
        return CardEngine.parseTriggeredAbilities(card);
      });
      expect(result.some(t => t.event === 'combat_damage_player')).toBe(true);
    });

    test('dies trigger', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Phoenix', oracle_text: 'When Phoenix dies, deal 2 damage to each opponent.' };
        return CardEngine.parseTriggeredAbilities(card);
      });
      expect(result.some(t => t.event === 'dies')).toBe(true);
    });

    test('any creature dies trigger', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Vulture', oracle_text: 'Whenever a creature you control dies, you gain 1 life.' };
        return CardEngine.parseTriggeredAbilities(card);
      });
      expect(result.some(t => t.event === 'any_creature_dies')).toBe(true);
    });

    test('upkeep trigger', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Oracle', oracle_text: 'At the beginning of your upkeep, scry 1.' };
        return CardEngine.parseTriggeredAbilities(card);
      });
      expect(result.some(t => t.event === 'upkeep')).toBe(true);
    });

    test('gain life trigger', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Angel', oracle_text: 'Whenever you gain life, put a +1/+1 counter on Angel.' };
        return CardEngine.parseTriggeredAbilities(card);
      });
      expect(result.some(t => t.event === 'gain_life')).toBe(true);
    });

    test('becomes tapped trigger', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Spy', oracle_text: 'Whenever Spy becomes tapped, draw a card.' };
        return CardEngine.parseTriggeredAbilities(card);
      });
      expect(result.some(t => t.event === 'becomes_tapped')).toBe(true);
    });

    test('end step trigger', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Guard', oracle_text: 'At the beginning of your end step, you gain 1 life.' };
        return CardEngine.parseTriggeredAbilities(card);
      });
      expect(result.some(t => t.event === 'end_step')).toBe(true);
    });

    test('enters or attacks trigger', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Vanguard', oracle_text: 'Whenever Vanguard enters the battlefield or attacks, create a 1/1 white Soldier creature token.' };
        return CardEngine.parseTriggeredAbilities(card);
      });
      expect(result.some(t => t.event === 'enters_or_attacks')).toBe(true);
    });

    test('no triggers on vanilla creature', async () => {
      const result = await page.evaluate(() => {
        const card = { name: 'Bear', oracle_text: '' };
        return CardEngine.parseTriggeredAbilities(card);
      });
      expect(result).toEqual([]);
    });
  });

  // =================== parseEquipmentEffects ===================

  test.describe('parseEquipmentEffects', () => {
    test('buff parsing', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Equipped creature gets +2/+1. Equip {3}', type_line: 'Artifact — Equipment' };
        return CardEngine.parseEquipmentEffects(card);
      });
      expect(result.some(e => e.type === 'buff' && e.power === 2 && e.toughness === 1)).toBe(true);
    });

    test('keyword grant parsing', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Equipped creature has flying. Equip {2}', type_line: 'Artifact — Equipment' };
        return CardEngine.parseEquipmentEffects(card);
      });
      expect(result.some(e => e.type === 'grant_keyword' && e.keyword.toLowerCase().includes('flying'))).toBe(true);
    });
  });

  // =================== parseAuraEffects ===================

  test.describe('parseAuraEffects', () => {
    test('buff parsing', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Enchanted creature gets +1/+3.', type_line: 'Enchantment — Aura' };
        return CardEngine.parseAuraEffects(card);
      });
      expect(result.some(e => e.type === 'buff' && e.power === 1 && e.toughness === 3)).toBe(true);
    });

    test('keyword grant parsing', async () => {
      const result = await page.evaluate(() => {
        const card = { oracle_text: 'Enchanted creature has lifelink.', type_line: 'Enchantment — Aura' };
        return CardEngine.parseAuraEffects(card);
      });
      expect(result.some(e => e.type === 'grant_keyword' && e.keyword.toLowerCase().includes('lifelink'))).toBe(true);
    });
  });
});
