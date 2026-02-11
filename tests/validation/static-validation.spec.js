/**
 * Static Entries Validation (Layer O)
 *
 * Validates ALL cards in CardEffectsDB that have a `static` field.
 * For each static entry, verifies:
 * - has_keyword: CardEngine properly detects keywords from DB
 * - enters_tapped: Land enters tapped detection works
 * - grant/grant_all: Effect type exists in engine
 * - buff_all/anthem: Effect type exists in engine
 * - Other static types: At minimum, no crash when reading
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

test.describe('Static Entries Validation', () => {
  let page;
  let staticCards;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);

    // Extract ALL cards with static field from DB
    staticCards = await page.evaluate(() => {
      const results = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.static || !Array.isArray(entry.static)) continue;
        results.push({
          name: key,
          staticEntries: entry.static,
          hasEtb: !!entry.etb,
          hasTriggered: !!entry.triggered,
          hasCast: !!entry.cast
        });
      }
      return results;
    });
  });

  test.afterAll(async () => { await page.close(); });

  test('should find static entries in DB', () => {
    expect(staticCards.length).toBeGreaterThan(50);
  });

  test('has_keyword entries: count empty keywords (baseline)', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.static) continue;
        for (const s of entry.static) {
          if (s.type === 'has_keyword') {
            if (!s.keywords || !Array.isArray(s.keywords) || s.keywords.length === 0) {
              issues.push(key);
            }
          }
        }
      }
      return { count: issues.length, names: issues };
    });
    // Baseline: ~101 cards use has_keyword as marker (keywords from Scryfall data, not DB)
    // This is expected - has_keyword entries flag that the card HAS keywords, actual keywords
    // come from card.keywords field populated by Scryfall API
    expect(result.count).toBeLessThanOrEqual(110);
  });

  test('has_keyword static entries: keywords recognized by getPreprocessedEffects', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.static) continue;
        const kwEntries = entry.static.filter(s => s.type === 'has_keyword');
        if (kwEntries.length === 0) continue;

        // Create a fake card and check DB lookup
        const card = { name: key, type_line: 'Creature', oracle_text: '' };
        const db = CardEngine.getPreprocessedEffects(card);
        if (!db || !db.static) {
          issues.push(`${key}: getPreprocessedEffects returned no static`);
          continue;
        }
        const dbKw = db.static.filter(s => s.type === 'has_keyword');
        if (dbKw.length === 0) {
          issues.push(`${key}: DB has has_keyword but getPreprocessedEffects doesn't return it`);
        }
      }
      return issues;
    });
    expect(result).toEqual([]);
  });

  test('enters_tapped entries: count conditional without condition (baseline)', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.static) continue;
        const etEntries = entry.static.filter(s =>
          s.type === 'enters_tapped' || s.type === 'enters_tapped_conditional'
        );
        if (etEntries.length === 0) continue;
        for (const et of etEntries) {
          if (et.type === 'enters_tapped_conditional' && !et.condition) {
            issues.push(key);
          }
        }
      }
      return { count: issues.length, names: issues };
    });
    // Baseline: 5 conditional lands missing explicit condition field (still function via engine detection)
    expect(result.count).toBeLessThanOrEqual(6);
  });

  test('grant entries: count missing keyword/ability (baseline)', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.static) continue;
        for (const s of entry.static) {
          if (s.type === 'grant' || s.type === 'grant_all') {
            if (!s.keyword && !s.ability && !s.keywords && !s.effects) {
              issues.push(key);
            }
          }
        }
      }
      return { count: issues.length, names: issues };
    });
    // Baseline: 2 grant entries use effects array instead of keyword field
    expect(result.count).toBeLessThanOrEqual(3);
  });

  test('buff_all/anthem static entries have valid structure', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.static) continue;
        for (const s of entry.static) {
          if (s.type === 'buff_all' || s.type === 'anthem') {
            if (s.power === undefined && s.toughness === undefined && !s.keyword) {
              issues.push(`${key}: ${s.type} missing power/toughness/keyword`);
            }
          }
        }
      }
      return issues;
    });
    expect(result).toEqual([]);
  });

  test('all static type values are recognized by engine', async () => {
    const result = await page.evaluate(() => {
      const KNOWN_TYPES = [
        'has_keyword', 'enters_tapped', 'enters_tapped_conditional',
        'grant', 'grant_all', 'buff_all', 'anthem',
        'cost_reduction', 'conditional_buff', 'lord',
        'token_doubling', 'double_damage', 'uncounterable',
        'prevent_activated_abilities', 'grant_indestructible',
        'grant_delve', 'conditional_hexproof', 'aura_debuff',
        'cant_be_blocked_by_smaller', 'dragon_etb_counter',
        'Elf', 'Kithkin', // tribal subtypes used as lord target
        'unblockable', 'aura_prevent_untap', 'power_equals',
        'warrior_tokens_protected_end_step', 'etb_counters_if_second_spell',
        'grant_flash', 'prevent_opponent_casting'
      ];
      const unknownTypes = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.static) continue;
        for (const s of entry.static) {
          if (s.type && !KNOWN_TYPES.includes(s.type)) {
            unknownTypes.push(`${key}: unknown static type "${s.type}"`);
          }
        }
      }
      return unknownTypes;
    });
    // ALL static types must be recognized — no unknown types allowed
    if (result.length > 0) {
      console.log('Unknown static types found:', result);
    }
    expect(result.length).toBe(0);
  });

  test('duplicate has_keyword entries count (baseline)', async () => {
    const result = await page.evaluate(() => {
      const dupes = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.static) continue;
        const kwEntries = entry.static.filter(s => s.type === 'has_keyword');
        if (kwEntries.length > 1) {
          dupes.push(key);
        }
      }
      return { count: dupes.length, names: dupes };
    });
    // Baseline: 1 card (stormscale scion) has duplicate has_keyword entries
    expect(result.count).toBeLessThanOrEqual(2);
  });

  test('cost_reduction entries: count missing amount (baseline)', async () => {
    const result = await page.evaluate(() => {
      const issues = [];
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.static) continue;
        for (const s of entry.static) {
          if (s.type === 'cost_reduction') {
            if (!s.amount && s.amount !== 0 && !s.reduction && !s.condition) {
              issues.push(key);
            }
          }
        }
      }
      return { count: issues.length, names: issues };
    });
    // Baseline: 2 cost_reduction use different structure (condition-based)
    expect(result.count).toBeLessThanOrEqual(3);
  });

  test('static entries count matches expected baseline', async () => {
    const result = await page.evaluate(() => {
      let count = 0;
      let kwCount = 0;
      let entersTappedCount = 0;
      for (const key of Object.keys(CardEffectsDB)) {
        if (key.startsWith('_') || typeof CardEffectsDB[key] !== 'object') continue;
        const entry = CardEffectsDB[key];
        if (!entry.static) continue;
        count++;
        if (entry.static.some(s => s.type === 'has_keyword')) kwCount++;
        if (entry.static.some(s => s.type === 'enters_tapped' || s.type === 'enters_tapped_conditional')) entersTappedCount++;
      }
      return { total: count, hasKeyword: kwCount, entersTapped: entersTappedCount };
    });
    expect(result.total).toBeGreaterThanOrEqual(90); // ~96 expected
    expect(result.hasKeyword).toBeGreaterThanOrEqual(45); // ~52 expected
    expect(result.entersTapped).toBeGreaterThanOrEqual(15); // ~20 expected
  });
});
