import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Rising of the Day — {1}{R}
 * Enchantment
 *
 * Creatures you control have haste.
 * Legendary creatures you control get +1/+0.
 *
 * IMPLEMENTED: anthem haste + anthem +1/+0 legendary + grant_all haste own_creatures.
 */
describe('Rising of the Day', () => {
  const DB = CardEffectsDB['rising of the day'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Creatures you control have haste" ──
  it('anthem grants haste keyword', () => {
    expect(DB.anthem).toBeDefined();
    expect(DB.anthem.keywords).toContain('haste');
  });

  // ── Oracle: "Legendary creatures you control get +1/+0" ──
  it('anthem +1/+0 for legendary creatures', () => {
    const legendaryAnthem = DB.static.find((s: any) => s.type === 'anthem' && s.condition === 'legendary');
    expect(legendaryAnthem).toBeDefined();
    expect(legendaryAnthem.power).toBe(1);
    expect(legendaryAnthem.toughness).toBe(0);
  });

  // ── Oracle: "Creatures you control have haste" (grant_all) ──
  it('has grant_all haste for own_creatures', () => {
    const grant = DB.static.find((s: any) => s.type === 'grant_all' && s.target === 'own_creatures');
    expect(grant).toBeDefined();
    expect(grant.keyword).toBe('haste');
  });
});
