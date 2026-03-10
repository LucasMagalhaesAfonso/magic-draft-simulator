import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Isolation at Orthanc — {3}{U}
 * Instant
 *
 * Put target creature into its owner's library second from the top.
 *
 * IMPLEMENTED: bounce_to_library_top with position: 2.
 */
describe('Isolation at Orthanc', () => {
  const DB = CardEffectsDB['isolation at orthanc'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Put creature into library second from the top" ──
  it('has bounce_to_library_top with position 2', () => {
    const bounce = DB.cast.find((e: any) => e.type === 'bounce_to_library_top');
    expect(bounce).toBeDefined();
    expect(bounce.target).toBe('creature');
    expect(bounce.position).toBe(2);
  });
});
