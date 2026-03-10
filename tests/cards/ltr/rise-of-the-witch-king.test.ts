import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Rise of the Witch-king — {4}{B}{B}
 * Sorcery
 *
 * Each player sacrifices a creature of their choice. If you sacrificed a
 * creature this way, you may return another permanent card from your
 * graveyard to the battlefield.
 *
 * IMPLEMENTED: sacrifice each_player_creature + return_from_graveyard permanent (conditional).
 */
describe('Rise of the Witch-king', () => {
  const DB = CardEffectsDB['rise of the witch-king'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Each player sacrifices a creature" ──
  it('has sacrifice each_player_creature', () => {
    const sac = DB.cast.find((e: any) => e.type === 'sacrifice');
    expect(sac).toBeDefined();
    expect(sac.target).toBe('each_player_creature');
  });

  // ── Oracle: "return another permanent card from your graveyard" ──
  it('has return_from_graveyard permanent conditional on sacrifice', () => {
    const ret = DB.cast.find((e: any) => e.type === 'return_from_graveyard');
    expect(ret).toBeDefined();
    expect(ret.target).toBe('permanent');
    expect(ret.condition).toBe('you_sacrificed');
  });
});
