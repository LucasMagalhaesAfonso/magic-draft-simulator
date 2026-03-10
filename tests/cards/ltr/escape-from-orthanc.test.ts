import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Escape from Orthanc — {1}{U}
 * Instant
 *
 * Target creature gets +1/+3 and gains flying until end of turn. Untap it.
 *
 * IMPLEMENTED: buff + untap in cast effects.
 */
describe('Escape from Orthanc', () => {
  const DB = CardEffectsDB['escape from orthanc'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  it('has buff effect with +1/+3 and flying', () => {
    const buff = DB.cast.find((e: any) => e.type === 'buff');
    expect(buff).toBeDefined();
    expect(buff.power).toBe(1);
    expect(buff.toughness).toBe(3);
    expect(buff.keywords).toContain('flying');
    expect(buff.duration).toBe('end_of_turn');
  });

  // ── Oracle: "Untap it" ──
  it('has untap effect', () => {
    const untap = DB.cast.find((e: any) => e.type === 'untap');
    expect(untap).toBeDefined();
  });
});
