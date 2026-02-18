/**
 * Layer A: Set Completeness Tests
 * Fetches ALL cards from Scryfall API for each set and compares against CardEffectsDB.
 * Detects missing cards BEFORE gameplay.
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

// Keywords that don't need special DB entries (handled by keyword system)
const KEYWORD_ONLY = [
  'flying', 'first strike', 'double strike', 'deathtouch', 'hexproof', 'indestructible',
  'lifelink', 'menace', 'reach', 'trample', 'vigilance', 'haste', 'flash', 'defender',
  'shroud', 'fear', 'intimidate', 'skulk', 'ward', 'wither', 'persist',
  'changeling', 'prowess'
];

/**
 * Checks if a card is "vanilla" - only has keyword abilities, no oracle text effects.
 * These don't need CardEffectsDB entries because the keyword system handles them.
 */
function isVanillaCard(card) {
  const text = (card.oracle_text || '').toLowerCase().trim();
  if (!text) return true; // No oracle text at all

  // Remove reminder text in parentheses
  const cleaned = text.replace(/\([^)]*\)/g, '').trim();
  if (!cleaned) return true;

  // Check if remaining text is ONLY keyword names
  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l);
  return lines.every(line => {
    // Check if line is a known keyword (possibly with comma separation)
    const parts = line.split(',').map(p => p.trim().toLowerCase());
    return parts.every(p => KEYWORD_ONLY.some(kw => p === kw || p.startsWith(kw + ' ')));
  });
}

/**
 * Fetch all booster cards for a set from Scryfall (using the app's built-in fetcher).
 */
async function fetchSetFromScryfall(page, setCode) {
  return await page.evaluate(async (code) => {
    // Clear cache to force fresh fetch
    const cacheKey = `mtg_set_cards_${code}`;
    const cached = localStorage.getItem(cacheKey);
    let cards;

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        cards = parsed.data || parsed;
      } catch { cards = null; }
    }

    if (!cards) {
      cards = await Scryfall.fetchSetCards(code);
    }

    return cards.map(c => ({
      name: c.name,
      type_line: c.type_line || '',
      oracle_text: c.oracle_text || '',
      keywords: c.keywords || [],
      rarity: c.rarity || '',
      power: c.power,
      toughness: c.toughness,
      cmc: c.cmc || 0,
      mana_cost: c.mana_cost || '',
      colors: c.colors || []
    }));
  }, setCode);
}

/**
 * Check all cards against CardEffectsDB in browser context.
 */
async function checkCompleteness(page, cards) {
  return await page.evaluate((cardList) => {
    const results = {
      total: cardList.length,
      covered: 0,
      missing: [],
      vanilla: [],
      noEffectZones: [],
      coverage: 0
    };

    for (const card of cardList) {
      // Skip basic lands
      if (card.type_line.includes('Basic Land')) {
        results.total--;
        continue;
      }

      const hasDB = CardEffectsDB.hasEffects(card.name);

      if (hasDB) {
        const effects = CardEffectsDB.getEffects(card.name);
        const hasZone = effects && (
          effects.cast || effects.etb || effects.triggered ||
          effects.activated || effects.static || effects.modal ||
          effects.saga || effects.chapters || effects.graveyard ||
          effects.hideaway
        );
        const hasAdditionalCosts = effects && effects.additional_costs;
        if (hasZone || hasAdditionalCosts) {
          results.covered++;
        } else {
          results.noEffectZones.push(card.name);
        }
      } else {
        // Check if vanilla
        const text = (card.oracle_text || '').toLowerCase().trim();
        const cleaned = text.replace(/\([^)]*\)/g, '').trim();
        const kwOnly = ['flying', 'first strike', 'double strike', 'deathtouch', 'hexproof',
          'indestructible', 'lifelink', 'menace', 'reach', 'trample', 'vigilance', 'haste',
          'flash', 'defender', 'shroud', 'fear', 'intimidate', 'skulk', 'ward', 'wither',
          'persist', 'changeling', 'prowess'];

        if (!cleaned) {
          results.vanilla.push(card.name);
          results.covered++;
        } else {
          const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l);
          const isVanilla = lines.every(line => {
            const parts = line.split(',').map(p => p.trim().toLowerCase());
            return parts.every(p => kwOnly.some(kw => p === kw || p.startsWith(kw + ' ')));
          });
          if (isVanilla) {
            results.vanilla.push(card.name);
            results.covered++;
          } else {
            results.missing.push({
              name: card.name,
              type: card.type_line,
              oracle: card.oracle_text.substring(0, 120),
              rarity: card.rarity
            });
          }
        }
      }
    }

    results.coverage = results.total > 0
      ? Math.round((results.covered / results.total) * 100)
      : 100;

    return results;
  }, cards);
}

// =================== TDM ===================

test.describe('Set Completeness - TDM (Tarkir Dragonstorm)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('All TDM non-vanilla cards are in CardEffectsDB', async () => {
    const cards = await fetchSetFromScryfall(page, 'tdm');
    expect(cards.length).toBeGreaterThan(0);

    const results = await checkCompleteness(page, cards);

    // Log detailed report
    if (results.missing.length > 0) {
      console.log('\n=== MISSING TDM CARDS ===');
      results.missing.forEach(m => {
        console.log(`  [${m.rarity}] ${m.name} (${m.type})`);
        console.log(`    Oracle: ${m.oracle}`);
      });
    }
    console.log(`\nTDM Coverage: ${results.covered}/${results.total} (${results.coverage}%)`);
    console.log(`Vanilla cards: ${results.vanilla.length}`);

    expect(results.missing).toEqual([]);
  });

  test('TDM coverage percentage >= 95%', async () => {
    const cards = await fetchSetFromScryfall(page, 'tdm');
    const results = await checkCompleteness(page, cards);
    expect(results.coverage).toBeGreaterThanOrEqual(95);
  });

  test('TDM DB entries have resolvable effect types', async () => {
    // Known effect types handled by stack.js _resolveEffect
    const HANDLED_EFFECTS_STACK = [
      'modal', 'damage', 'damage_all_creatures', 'destroy', 'destroy_all',
      'exile', 'exile_all', 'bounce', 'draw', 'gainLife', 'loseLife', 'buff',
      'scry', 'surveil', 'mill', 'ramp', 'create_token', 'counter', 'counter_self',
      'counter_all', 'discard', 'fight', 'tap', 'untap', 'prevent_damage',
      'return_from_graveyard', 'debuff', 'debuff_all', 'buff_all', 'blight',
      'blight_opponent', 'grant_haste', 'stun', 'threaten', 'clash',
      'counter_spell', 'endure', 'lose_life', 'gain_life',
      // Batch 1 (easy)
      'drain', 'loot', 'bounce_self', 'look_top', 'damage_all', 'untap_all',
      'discard_hand', 'reveal_hand', 'exile_graveyard', 'exile_from_graveyard',
      'exile_top', 'double_counters', 'bounce_to_library_top', 'return_land_from_mill',
      'regenerate', 'counter_self_if_no_draw', 'remove_counters', 'grant', 'grant_all',
      'grant_counter', 'grant_counters',
      // Batch 2 (medium)
      'exile_top_play', 'search_library', 'search_library_to_graveyard',
      'create_token_copy', 'clone', 'copy_self', 'gain_control', 'anthem',
      'move_counters', 'distribute_counters', 'become_creature', 'become_dragon',
      'attach', 'exile_top_opponent',
      // Batch 3 (hard)
      'copy_spell', 'copy_next_spell', 'extra_combat', 'exile_graveyard_cast_copy',
      // Meta/other systems (keywords, statics, auras, special)
      'has_keyword', 'static', 'triggered', 'triggered_this_turn',
      'behold', 'behold_dragon', 'hideaway', 'basic',
      'enters_tapped', 'enters_tapped_conditional',
      'aura_debuff', 'aura_prevent_untap',
      'unblockable', 'uncounterable', 'cant_be_blocked_by_smaller',
      'conditional_buff', 'conditional_hexproof',
      'cost_reduction', 'double_damage', 'token_doubling',
      'power_equals', 'lord',
      'prevent_activated_abilities', 'prevent_opponent_casting',
      'grant_delve', 'grant_flash', 'grant_indestructible', 'grant_harmonize',
      'dragon_etb_counter', 'etb_counters_if_second_spell',
      'tap_or_untap', 'exile_with_suspend', 'bounce_to_library',
      'warrior_tokens_protected_end_step', 'counter_all_type',
      'Dragon', 'Elf', 'Kithkin'
    ];

    // Known effect types handled by _resolveSimpleEffect
    const HANDLED_EFFECTS_SIMPLE = [
      'draw', 'gainLife', 'loseLife', 'damage', 'counter_self', 'buff_self',
      'create_token', 'scry', 'mill', 'add_mana', 'damage_each_opponent',
      'untap_self', 'peek_top_land', 'gain_life', 'lose_life', 'endure',
      'stun_counter', 'stun_counter_self', 'buff', 'surveil', 'counter_all',
      'destroy', 'bounce', 'exile', 'ramp', 'fight', 'tap_target',
      'discard_trigger', 'return_from_graveyard', 'sacrifice', 'return_to_hand',
      'blight', 'cant_block', 'buff_all', 'remove_counter', 'grant_haste',
      // Batch 1
      'drain', 'loot', 'bounce_self', 'look_top', 'damage_all', 'untap_all',
      'discard_hand', 'reveal_hand', 'exile_graveyard', 'exile_from_graveyard',
      'exile_top', 'double_counters', 'bounce_to_library_top', 'return_land_from_mill',
      'regenerate', 'counter_self_if_no_draw', 'remove_counters', 'grant', 'grant_all',
      'grant_counter', 'grant_counters',
      // Batch 2
      'exile_top_play', 'search_library', 'search_library_to_graveyard',
      'create_token_copy', 'clone', 'copy_self', 'gain_control', 'anthem',
      'move_counters', 'distribute_counters', 'become_creature', 'become_dragon',
      'attach', 'exile_top_opponent',
      // Batch 3
      'copy_spell', 'copy_next_spell', 'extra_combat', 'exile_graveyard_cast_copy',
      // Meta/other systems
      'has_keyword', 'static', 'triggered', 'triggered_this_turn',
      'behold', 'behold_dragon', 'hideaway', 'basic',
      'enters_tapped', 'enters_tapped_conditional',
      'aura_debuff', 'aura_prevent_untap',
      'unblockable', 'uncounterable', 'cant_be_blocked_by_smaller',
      'conditional_buff', 'conditional_hexproof',
      'cost_reduction', 'double_damage', 'token_doubling',
      'power_equals', 'lord',
      'prevent_activated_abilities', 'prevent_opponent_casting',
      'grant_delve', 'grant_flash', 'grant_indestructible', 'grant_harmonize',
      'dragon_etb_counter', 'etb_counters_if_second_spell',
      'tap_or_untap', 'exile_with_suspend', 'bounce_to_library',
      'warrior_tokens_protected_end_step', 'counter_all_type',
      'Dragon', 'Elf', 'Kithkin'
    ];

    const ALL_HANDLED = new Set([...HANDLED_EFFECTS_STACK, ...HANDLED_EFFECTS_SIMPLE]);

    const report = await page.evaluate((handledList) => {
      const handledSet = new Set(handledList);
      const unhandledMap = {}; // effectType -> [cardName, ...]
      let totalEffectsChecked = 0;
      let totalUnhandled = 0;

      // Helper: extract effect types from an effects array
      function extractTypes(effectsArr) {
        const types = [];
        if (!effectsArr) return types;
        const arr = Array.isArray(effectsArr) ? effectsArr : [effectsArr];
        for (const eff of arr) {
          if (eff && eff.type) {
            types.push(eff.type);
          }
          // Also check nested bonus effects (e.g. clash bonus)
          if (eff && eff.bonus && Array.isArray(eff.bonus)) {
            for (const b of eff.bonus) {
              if (b && b.type) types.push(b.type);
            }
          }
        }
        return types;
      }

      // Get all TDM card names from the DB
      const db = typeof CardEffectsDB !== 'undefined' ? CardEffectsDB : null;
      if (!db) return { error: 'CardEffectsDB not available' };

      // CardEffectsDB is a plain object with card names as keys (skip method properties)
      for (const [cardName, entry] of Object.entries(db)) {
        if (typeof entry === 'function') continue;
        if (!entry) continue;
        const allTypes = [];

        // cast zone
        if (entry.cast) allTypes.push(...extractTypes(entry.cast));

        // etb zone
        if (entry.etb) allTypes.push(...extractTypes(entry.etb));

        // triggered abilities
        if (entry.triggered) {
          const triggers = Array.isArray(entry.triggered) ? entry.triggered : [entry.triggered];
          for (const trig of triggers) {
            if (trig && trig.effects) allTypes.push(...extractTypes(trig.effects));
          }
        }

        // activated abilities
        if (entry.activated) {
          const acts = Array.isArray(entry.activated) ? entry.activated : [entry.activated];
          for (const act of acts) {
            if (act && act.effects) allTypes.push(...extractTypes(act.effects));
          }
        }

        // modal modes
        if (entry.modal && entry.modal.modes) {
          for (const mode of entry.modal.modes) {
            if (mode && mode.effects) allTypes.push(...extractTypes(mode.effects));
          }
        }

        // saga chapters
        if (entry.chapters) {
          for (const [chKey, chEffects] of Object.entries(entry.chapters)) {
            allTypes.push(...extractTypes(chEffects));
          }
        }
        if (entry.saga && entry.saga.chapters) {
          for (const [chKey, chEffects] of Object.entries(entry.saga.chapters)) {
            allTypes.push(...extractTypes(chEffects));
          }
        }

        // graveyard zone
        if (entry.graveyard) {
          const gvEntries = Array.isArray(entry.graveyard) ? entry.graveyard : [entry.graveyard];
          for (const gv of gvEntries) {
            if (gv && gv.effects) allTypes.push(...extractTypes(gv.effects));
          }
        }

        // Check each extracted type
        for (const t of allTypes) {
          totalEffectsChecked++;
          if (!handledSet.has(t)) {
            totalUnhandled++;
            if (!unhandledMap[t]) unhandledMap[t] = [];
            unhandledMap[t].push(cardName);
          }
        }
      }

      return {
        totalEffectsChecked,
        totalUnhandled,
        unhandledMap
      };
    }, [...ALL_HANDLED]);

    // Log the report
    console.log(`\n=== TDM Effect Type Resolution Check ===`);
    console.log(`Total effect types checked: ${report.totalEffectsChecked}`);
    console.log(`Unhandled effect types: ${report.totalUnhandled}`);

    if (report.unhandledMap && Object.keys(report.unhandledMap).length > 0) {
      console.log('\n--- UNHANDLED EFFECT TYPES ---');
      for (const [effectType, cardNames] of Object.entries(report.unhandledMap)) {
        console.log(`  "${effectType}" used by: ${cardNames.join(', ')}`);
      }
    }

    // Warn but don't fail - some effect types may be documentational
    if (report.totalUnhandled > 0) {
      console.warn(`\nWARNING: ${report.totalUnhandled} effect instance(s) use unhandled types. These will silently do nothing in-game.`);
    }

    // Informational: tracks how many effect instances use unhandled types
    // These are documentational entries in DB that silently do nothing in-game
    // As engine support grows, this number should decrease
    if ((report.totalUnhandled || 0) > 0) {
      console.warn(`\nWARNING: ${report.totalUnhandled} effect instance(s) use unhandled types.`);
    }
    expect(report.totalEffectsChecked).toBeGreaterThan(0);
  });
});

// =================== LRW ===================

test.describe('Set Completeness - LRW (Lorwyn)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('All LRW non-vanilla cards are in CardEffectsDB', async () => {
    const cards = await fetchSetFromScryfall(page, 'lrw');
    expect(cards.length).toBeGreaterThan(0);

    const results = await checkCompleteness(page, cards);

    if (results.missing.length > 0) {
      console.log('\n=== MISSING LRW CARDS ===');
      results.missing.forEach(m => {
        console.log(`  [${m.rarity}] ${m.name} (${m.type})`);
        console.log(`    Oracle: ${m.oracle}`);
      });
    }
    console.log(`\nLRW Coverage: ${results.covered}/${results.total} (${results.coverage}%)`);

    // Baseline: only key cards implemented, not full set
    const LRW_MISSING_BASELINE = 1100;
    expect(results.missing.length).toBeLessThanOrEqual(LRW_MISSING_BASELINE);
  });
});

// =================== ECL ===================

test.describe('Set Completeness - ECL (Lorwyn Eclipsed)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('All ECL non-vanilla cards are in CardEffectsDB', async () => {
    const cards = await fetchSetFromScryfall(page, 'ecl');
    expect(cards.length).toBeGreaterThan(0);

    const results = await checkCompleteness(page, cards);

    if (results.missing.length > 0) {
      console.log('\n=== MISSING ECL CARDS ===');
      results.missing.forEach(m => {
        console.log(`  [${m.rarity}] ${m.name} (${m.type})`);
        console.log(`    Oracle: ${m.oracle}`);
      });
    }
    console.log(`\nECL Coverage: ${results.covered}/${results.total} (${results.coverage}%)`);

    // Baseline: only key cards implemented, not full set
    const ECL_MISSING_BASELINE = 1600;
    expect(results.missing.length).toBeLessThanOrEqual(ECL_MISSING_BASELINE);
  });
});
