import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Forge Anew — {2}{W}
 * Enchantment
 *
 * When this enchantment enters, return target Equipment card from your graveyard to the battlefield.
 * During your turn, you may activate equip abilities any time you could cast an instant.
 * You may pay {0} rather than pay the equip cost of the first equip ability you activate during each of your turns.
 *
 * IMPLEMENTED: ETB return equipment from GY + equip_instant_speed + first_equip_free statics.
 */
describe('Forge Anew', () => {
  const DB = CardEffectsDB['forge anew'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "return target Equipment from graveyard to battlefield" ──
  it('has ETB return_from_graveyard for equipment', () => {
    const etb = DB.etb.find((e: any) => e.type === 'return_from_graveyard');
    expect(etb).toBeDefined();
    expect(etb.target).toBe('equipment');
    expect(etb.to_battlefield).toBe(true);
  });

  // ── Oracle: "equip at instant speed during your turn" ──
  it('has equip_instant_speed static', () => {
    const eis = DB.static.find((s: any) => s.type === 'equip_instant_speed');
    expect(eis).toBeDefined();
  });

  // ── Oracle: "first equip costs {0}" ──
  it('has first_equip_free static', () => {
    const fef = DB.static.find((s: any) => s.type === 'first_equip_free');
    expect(fef).toBeDefined();
  });
});
