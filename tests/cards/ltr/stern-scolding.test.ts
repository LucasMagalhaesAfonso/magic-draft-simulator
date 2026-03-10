import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Stern Scolding — {U}
 * Instant
 *
 * Counter target creature spell with power or toughness 2 or less.
 *
 * IMPLEMENTED: counter_spell targeting creature_spell with p/t restriction.
 */
describe('Stern Scolding', () => {
  const DB = CardEffectsDB['stern scolding'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Counter target creature spell" ──
  it('has counter_spell targeting creature_spell', () => {
    const counter = DB.cast.find((e: any) => e.type === 'counter_spell');
    expect(counter).toBeDefined();
    expect(counter.target).toBe('creature_spell');
  });

  // ── Oracle: "with power or toughness 2 or less" ──
  it('has power_or_toughness_2_or_less condition', () => {
    const counter = DB.cast.find((e: any) => e.type === 'counter_spell');
    expect(counter.condition).toBe('power_or_toughness_2_or_less');
  });
});
