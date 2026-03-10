import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Esquire of the King — {1}{W}
 * Creature — Human Soldier (1/1)
 *
 * {4}{W}, {T}: Creatures you control get +1/+1 until end of turn.
 * This ability costs {2} less to activate if you control a legendary creature.
 *
 * IMPLEMENTED: cost_reduction with control_legendary condition on activated ability.
 */
describe('Esquire of the King', () => {
  const DB = CardEffectsDB['esquire of the king'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  it('has activated ability', () => {
    expect(DB.activated).toBeDefined();
    expect(DB.activated.length).toBeGreaterThan(0);
  });

  it('activated ability buffs own creatures +1/+1', () => {
    const ability = DB.activated[0];
    const buff = ability.effects.find((e: any) => e.type === 'buff_all');
    expect(buff).toBeDefined();
    expect(buff.power).toBe(1);
    expect(buff.toughness).toBe(1);
    expect(buff.target).toBe('own_creatures');
    expect(buff.duration).toBe('end_of_turn');
  });

  // ── Oracle: "This ability costs {2} less to activate if you control a legendary creature" ──
  it('has cost_reduction with control_legendary condition', () => {
    const ability = DB.activated[0];
    expect(ability.cost_reduction).toBeDefined();
    expect(ability.cost_reduction.amount).toBe(2);
    expect(ability.cost_reduction.condition).toBe('control_legendary');
  });
});
