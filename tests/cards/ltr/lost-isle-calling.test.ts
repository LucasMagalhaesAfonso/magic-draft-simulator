import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Lost Isle Calling — {1}{U}
 * Enchantment
 *
 * Whenever you scry, put a verse counter on this enchantment.
 * {4}{U}{U}, Exile this enchantment: Draw a card for each verse counter on this enchantment.
 * If it had seven or more verse counters on it, take an extra turn after this one.
 * Activate only as a sorcery.
 *
 * IMPLEMENTED: scry trigger → verse counter + activated exile draw verse_counters.
 */
describe('Lost Isle Calling', () => {
  const DB = CardEffectsDB['lost isle calling'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever you scry, put a verse counter" ──
  it('has scry trigger adding verse counter', () => {
    const scryTrigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(scryTrigger).toBeDefined();
    const counter = scryTrigger.effects.find((e: any) => e.type === 'counter_self' && e.counter === 'verse');
    expect(counter).toBeDefined();
  });

  // ── Oracle: "{4}{U}{U}, Exile: Draw per verse counter" ──
  it('has activated ability to draw verse_counters', () => {
    expect(DB.activated).toBeDefined();
    const ability = DB.activated[0];
    expect(ability.cost.exile).toBe(true);
    expect(ability.sorcerySpeed).toBe(true);
    const draw = ability.effects.find((e: any) => e.type === 'draw');
    expect(draw.amount).toBe('verse_counters');
  });
});
