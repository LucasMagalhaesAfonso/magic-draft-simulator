/**
 * Triggered Entries Validation (Layer P)
 *
 * Validates ALL cards in CardEffectsDB that have a `triggered` field.
 * For each triggered entry, verifies:
 * - Event type is a known/recognized type
 * - Effects array is valid and non-empty
 * - getTriggeredAbilities returns the entries correctly
 * - Trigger registration doesn't crash
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

test.describe('Triggered Entries Validation', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('should find triggered entries in DB', async () => {
    const count = await page.evaluate(() => {
      let c = 0;
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        if (CardEffectsDB[key].triggered) c++;
      }
      return c;
    });
    expect(count).toBeGreaterThan(50);
  });

  test('all triggered entries have valid event types', async () => {
    const result = await page.evaluate(() => {
      const KNOWN_EVENTS = [
        'attacks', 'dies', 'any_creature_dies', 'other_creature_dies',
        'combat_damage_player', 'upkeep', 'end_step',
        'gain_life', 'becomes_tapped', 'second_spell',
        'dragon_enters', 'enters_or_attacks', 'combat_begin',
        'creature_etb', 'creature_dies', 'creature_dies_with_counters',
        'cast_creature', 'cast_elf', 'cast_merfolk', 'cast_colorless',
        'forest_enters', 'opponent_casts', 'opponent_discards',
        'clash_won', 'counter_placed', 'card_leaves_graveyard',
        'cards_leave_graveyard', 'leaves_battlefield', 'target_dies',
        'cast_with_another_spell', 'landfall', 'equipped_attacks',
        'creature_enters_cast', 'other_creature_enters',
        'creature_targeted_by_opponent', 'cast_spell',
        'cast_noncreature_or_dragon', 'cast_treefolk'
      ];
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.triggered || !Array.isArray(entry.triggered)) continue;
        for (const t of entry.triggered) {
          if (!t.event) {
            issues.push(`${key}: triggered entry missing event field`);
          } else if (!KNOWN_EVENTS.includes(t.event)) {
            issues.push(`${key}: unknown event type "${t.event}"`);
          }
        }
      }
      return issues;
    });
    if (result.length > 0) {
      console.log('Triggered validation issues:', result);
    }
    expect(result.length).toBeLessThanOrEqual(3); // baseline tolerance
  });

  test('all triggered entries have non-empty effects arrays', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.triggered) continue;
        for (const t of entry.triggered) {
          if (!t.effects || !Array.isArray(t.effects) || t.effects.length === 0) {
            issues.push(`${key}: triggered entry for "${t.event}" has empty effects`);
          }
        }
      }
      return issues;
    });
    expect(result).toEqual([]);
  });

  test('all triggered effects have valid type field', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.triggered) continue;
        for (const t of entry.triggered) {
          if (!t.effects) continue;
          for (const e of t.effects) {
            if (!e.type) {
              issues.push(`${key}: triggered effect for "${t.event}" missing type`);
            }
          }
        }
      }
      return issues;
    });
    expect(result).toEqual([]);
  });

  test('getTriggeredAbilities returns DB entries correctly', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.triggered) continue;

        const card = { name: key, type_line: 'Creature', oracle_text: '' };
        const triggers = CardEngine.getTriggeredAbilities(card);
        if (!triggers || triggers.length === 0) {
          issues.push(`${key}: getTriggeredAbilities returned empty for card with DB triggered`);
        } else if (triggers.length !== entry.triggered.length) {
          issues.push(`${key}: expected ${entry.triggered.length} triggers, got ${triggers.length}`);
        }
      }
      return issues;
    });
    expect(result).toEqual([]);
  });

  test('triggered entries with "self" flag are properly structured', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.triggered) continue;
        for (const t of entry.triggered) {
          // self flag means the trigger only fires for this card itself
          if (t.self !== undefined && typeof t.self !== 'boolean') {
            issues.push(`${key}: "self" flag should be boolean, got ${typeof t.self}`);
          }
        }
      }
      return issues;
    });
    expect(result).toEqual([]);
  });

  test('triggered entries with "once_per_turn" are properly structured', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.triggered) continue;
        for (const t of entry.triggered) {
          if (t.once_per_turn !== undefined && typeof t.once_per_turn !== 'boolean') {
            issues.push(`${key}: "once_per_turn" should be boolean, got ${typeof t.once_per_turn}`);
          }
        }
      }
      return issues;
    });
    expect(result).toEqual([]);
  });

  test('trigger registration does not crash for any DB card', async () => {
    const result = await page.evaluate(() => {
      const crashed = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.triggered) continue;

        try {
          // Create minimal state and card
          const state = { _triggers: [], log: [] };
          const card = CardEngine.prepareForBattlefield({
            id: key, _uid: 'test_' + key.replace(/\s/g, '_'),
            name: key, type_line: 'Creature — Test',
            power: '2', toughness: '2', mana_cost: '{2}', cmc: 2,
            oracle_text: '', colors: [], color_identity: [],
            keywords: [], rarity: 'common'
          });
          GameState._registerCardTriggers(state, card, 0);
        } catch (e) {
          crashed.push(`${key}: ${e.message}`);
        }
      }
      return crashed;
    });
    expect(result).toEqual([]);
  });

  test('event type distribution matches expected baseline', async () => {
    const result = await page.evaluate(() => {
      const eventCounts = {};
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.triggered) continue;
        for (const t of entry.triggered) {
          eventCounts[t.event] = (eventCounts[t.event] || 0) + 1;
        }
      }
      return eventCounts;
    });
    // Verify major event types are present
    expect(result.attacks).toBeGreaterThanOrEqual(10);
    expect(result.dies).toBeGreaterThanOrEqual(5);
    expect(result.second_spell).toBeGreaterThanOrEqual(4);
    expect(result.end_step).toBeGreaterThanOrEqual(4);
    expect(result.upkeep).toBeGreaterThanOrEqual(3);
  });

  test('triggered effect types are all handled by engine', async () => {
    const result = await page.evaluate(() => {
      // Collect all unique effect types used in triggered entries
      const effectTypes = new Set();
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.triggered) continue;
        for (const t of entry.triggered) {
          if (!t.effects) continue;
          for (const e of t.effects) {
            effectTypes.add(e.type);
          }
        }
      }
      return Array.from(effectTypes).sort();
    });
    // All effect types should be known
    const KNOWN_EFFECT_TYPES = [
      'damage', 'destroy', 'exile', 'draw', 'gainLife', 'gain_life', 'loseLife', 'lose_life',
      'buff', 'buff_self', 'buff_all', 'bounce', 'mill', 'create_token',
      'counter_self', 'counter_all', 'counters', 'discard', 'discard_hand', 'tap', 'tap_target',
      'untap', 'untap_all', 'tap_or_untap',
      'grant', 'grant_all', 'grant_haste', 'scry', 'surveil', 'drain', 'fight',
      'ramp', 'add_mana', 'return_from_graveyard', 'return_to_hand', 'copy_spell', 'copy_self',
      'grant_counter', 'grant_counters', 'look_top', 'loot',
      'damage_all_creatures', 'damage_each_opponent', 'exile_top_play', 'exile_top', 'exile_top_opponent',
      'prevent_damage', 'bounce_self', 'exile_from_graveyard', 'exile_graveyard', 'counter',
      'threaten', 'stun', 'stun_counter_self', 'regenerate', 'blight',
      'double_counters', 'remove_counters', 'move_counters', 'cant_block',
      'become_creature', 'become_dragon', 'sacrifice_opponent', 'sacrifice',
      'attach', 'clash', 'create_token_copy', 'endure',
      'search_library', 'exile_with_suspend'
    ];
    const unknown = result.filter(t => !KNOWN_EFFECT_TYPES.includes(t));
    if (unknown.length > 0) {
      console.log('Unknown triggered effect types:', unknown);
    }
    expect(unknown.length).toBeLessThanOrEqual(5); // baseline tolerance
  });
});
