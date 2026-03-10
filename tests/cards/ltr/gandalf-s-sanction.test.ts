import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Gandalf's Sanction — {X}{U}{R}
 * Sorcery
 *
 * Gandalf's Sanction deals X damage to target creature, where X is the number of
 * instant and sorcery cards in your graveyard. Excess damage is dealt to that
 * creature's controller instead.
 *
 * IMPLEMENTED: instants_sorceries_in_gy amount + excess_to_controller.
 */
describe("Gandalf's Sanction", () => {
  const DB = CardEffectsDB["gandalf's sanction"];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "deals X damage where X = instants+sorceries in GY" ──
  it('deals instants_sorceries_in_gy damage to creature', () => {
    const dmg = DB.cast.find((e: any) => e.type === 'damage');
    expect(dmg).toBeDefined();
    expect(dmg.amount).toBe('instants_sorceries_in_gy');
    expect(dmg.target).toBe('creature');
  });

  // ── Oracle: "Excess damage is dealt to that creature's controller" ──
  it('has excess_to_controller flag', () => {
    const dmg = DB.cast.find((e: any) => e.type === 'damage');
    expect(dmg.excess_to_controller).toBe(true);
  });
});
