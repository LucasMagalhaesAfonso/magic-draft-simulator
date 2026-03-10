import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Hithlain Knots — {1}{U}
 * Instant
 *
 * Tap target creature. Scry 1.
 * Draw a card.
 *
 * IMPLEMENTED: tap + scry + draw in cast effects.
 */
describe('Hithlain Knots', () => {
  const DB = CardEffectsDB['hithlain knots'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Tap target creature" ──
  it('has tap effect', () => {
    const tap = DB.cast.find((e: any) => e.type === 'tap');
    expect(tap).toBeDefined();
    expect(tap.target).toBe('creature');
  });

  // ── Oracle: "Scry 1" ──
  it('has scry 1', () => {
    const scry = DB.cast.find((e: any) => e.type === 'scry');
    expect(scry).toBeDefined();
    expect(scry.amount).toBe(1);
  });

  // ── Oracle: "Draw a card" ──
  it('has draw 1', () => {
    const draw = DB.cast.find((e: any) => e.type === 'draw');
    expect(draw).toBeDefined();
    expect(draw.amount).toBe(1);
  });
});
