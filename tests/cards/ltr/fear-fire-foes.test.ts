import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Fear, Fire, Foes! — {X}{R}
 * Sorcery
 *
 * Damage can't be prevented this turn. Fear, Fire, Foes! deals X damage to
 * target creature and 1 damage to each other creature with the same controller.
 *
 * IMPLEMENTED: cant_prevent_damage + damage X + damage_same_controller effects.
 */
describe('Fear, Fire, Foes!', () => {
  const DB = CardEffectsDB['fear, fire, foes!'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Damage can't be prevented this turn" ──
  it('has cant_prevent_damage effect', () => {
    const effect = DB.cast.find((e: any) => e.type === 'cant_prevent_damage');
    expect(effect).toBeDefined();
  });

  // ── Oracle: "deals X damage to target creature" ──
  it('deals X damage to target creature', () => {
    const dmg = DB.cast.find((e: any) => e.type === 'damage' && e.amount === 'X');
    expect(dmg).toBeDefined();
    expect(dmg.target).toBe('creature');
  });

  // ── Oracle: "1 damage to each other creature with the same controller" ──
  it('deals 1 damage to each other creature with same controller', () => {
    const splash = DB.cast.find((e: any) => e.type === 'damage_same_controller');
    expect(splash).toBeDefined();
    expect(splash.amount).toBe(1);
  });
});
