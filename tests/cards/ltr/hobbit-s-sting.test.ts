import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Hobbit's Sting — {2}{W}
 * Instant
 *
 * Hobbit's Sting deals X damage to target creature, where X is the number of
 * creatures you control plus the number of Foods you control.
 *
 * IMPLEMENTED: creatures_plus_foods dynamic amount.
 */
describe("Hobbit's Sting", () => {
  const DB = CardEffectsDB["hobbit's sting"];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "X = creatures + Foods you control" ──
  it('deals creatures_plus_foods damage to creature', () => {
    const dmg = DB.cast.find((e: any) => e.type === 'damage');
    expect(dmg).toBeDefined();
    expect(dmg.amount).toBe('creatures_plus_foods');
    expect(dmg.target).toBe('creature');
  });
});
