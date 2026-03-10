import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Rally at the Hornburg — {2}{R}{W}
 * Instant
 *
 * Create two 1/1 white Human Soldier creature tokens. Humans you control
 * gain haste until end of turn.
 *
 * IMPLEMENTED: create_token x2 + grant_all haste to humans until EOT.
 */
describe('Rally at the Hornburg', () => {
  const DB = CardEffectsDB['rally at the hornburg'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Create two 1/1 white Human Soldier creature tokens" ──
  it('creates 2 Human Soldier tokens', () => {
    const token = DB.cast.find((e: any) => e.type === 'create_token');
    expect(token).toBeDefined();
    expect(token.count).toBe(2);
    expect(token.power).toBe(1);
    expect(token.toughness).toBe(1);
    expect(token.name).toBe('Human Soldier');
  });

  // ── Oracle: "Humans you control gain haste until end of turn" ──
  it('grants haste to humans until end of turn', () => {
    const grant = DB.cast.find((e: any) => e.type === 'grant_all');
    expect(grant).toBeDefined();
    expect(grant.target).toBe('humans');
    expect(grant.keywords).toContain('haste');
    expect(grant.duration).toBe('end_of_turn');
  });
});
