import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Press the Enemy — {3}{U}
 * Instant
 *
 * Return target spell or nonland permanent an opponent controls to its owner's hand.
 * You may cast an instant or sorcery spell with equal or lesser mana value from
 * your hand without paying its mana cost.
 *
 * IMPLEMENTED: bounce nonland_permanent + free_cast instant/sorcery from hand.
 */
describe('Press the Enemy', () => {
  const DB = CardEffectsDB['press the enemy'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Return nonland permanent to hand" ──
  it('has bounce nonland_permanent', () => {
    const bounce = DB.cast.find((e: any) => e.type === 'bounce');
    expect(bounce).toBeDefined();
    expect(bounce.target).toBe('nonland_permanent');
  });

  // ── Oracle: "cast instant or sorcery for free" ──
  it('has free_cast instant_or_sorcery_from_hand', () => {
    const freeCast = DB.cast.find((e: any) => e.type === 'free_cast');
    expect(freeCast).toBeDefined();
    expect(freeCast.target).toBe('instant_or_sorcery_from_hand');
  });
});
