import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Lost to Legend — {3}{W}
 * Instant
 *
 * Put target nonland historic permanent into its owner's library fourth from the top.
 * (Artifacts, legendaries, and Sagas are historic.)
 *
 * IMPLEMENTED: bounce_to_library_top with position: 4 targeting nonland_permanent.
 */
describe('Lost to Legend', () => {
  const DB = CardEffectsDB['lost to legend'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "into library fourth from the top" ──
  it('has bounce_to_library_top with position 4', () => {
    const bounce = DB.cast.find((e: any) => e.type === 'bounce_to_library_top');
    expect(bounce).toBeDefined();
    expect(bounce.target).toBe('nonland_permanent');
    expect(bounce.position).toBe(4);
  });
});
