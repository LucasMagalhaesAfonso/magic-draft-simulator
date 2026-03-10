import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Friendly Rivalry — {1}{G}
 * Instant
 *
 * Target creature you control and up to one other target legendary creature you
 * control each deal damage equal to their power to target creature you don't control.
 *
 * IMPLEMENTED: dual bite — your creature bites opponent creature, optional legendary creature also bites.
 */
describe('Friendly Rivalry', () => {
  const DB = CardEffectsDB['friendly rivalry'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: creature deals damage to opponent creature (bite) ──
  it('has bite effect for own creature vs opponent', () => {
    const bite = DB.cast.find((e: any) => e.type === 'bite' && e.target === 'own_creature_vs_opponent');
    expect(bite).toBeDefined();
  });

  // ── Oracle: "up to one other legendary creature" also bites ──
  it('has optional legendary creature bite', () => {
    const bite2 = DB.cast.find((e: any) => e.type === 'bite' && e.target === 'legendary_creature_vs_same_opponent');
    expect(bite2).toBeDefined();
    expect(bite2.optional).toBe(true);
  });
});
