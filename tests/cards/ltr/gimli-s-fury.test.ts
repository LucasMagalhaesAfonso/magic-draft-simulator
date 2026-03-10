import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Gimli's Fury — {1}{R}
 * Instant
 *
 * Target creature gets +3/+2 until end of turn. If it's legendary, it also
 * gains trample until end of turn.
 *
 * IMPLEMENTED: buff +3/+2 + conditional trample grant for legendary targets.
 */
describe("Gimli's Fury", () => {
  const DB = CardEffectsDB["gimli's fury"];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "+3/+2 until end of turn" ──
  it('has buff +3/+2', () => {
    const buff = DB.cast.find((e: any) => e.type === 'buff');
    expect(buff).toBeDefined();
    expect(buff.power).toBe(3);
    expect(buff.toughness).toBe(2);
    expect(buff.duration).toBe('end_of_turn');
  });

  // ── Oracle: "If it's legendary, it also gains trample" ──
  it('has conditional trample grant for legendary', () => {
    const grant = DB.cast.find((e: any) => e.type === 'grant');
    expect(grant).toBeDefined();
    expect(grant.keywords).toContain('trample');
    expect(grant.condition).toBe('target_legendary');
  });
});
