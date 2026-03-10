import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Fog on the Barrow-Downs — {2}{W}
 * Enchantment — Aura
 *
 * Enchant creature
 * Enchanted creature is a Spirit and can't attack or block.
 * (It loses all other creature types.)
 *
 * IMPLEMENTED: aura_cant_attack_block + aura_set_creature_type Spirit.
 */
describe('Fog on the Barrow-Downs', () => {
  const DB = CardEffectsDB['fog on the barrow-downs'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "can't attack or block" ──
  it('has aura_cant_attack_block static', () => {
    const cantAB = DB.static.find((s: any) => s.type === 'aura_cant_attack_block');
    expect(cantAB).toBeDefined();
  });

  // ── Oracle: "Enchanted creature is a Spirit" ──
  it('has aura_set_creature_type Spirit', () => {
    const setType = DB.static.find((s: any) => s.type === 'aura_set_creature_type');
    expect(setType).toBeDefined();
    expect(setType.creature_type).toBe('Spirit');
  });
});
