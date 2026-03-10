import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Glorfindel, Dauntless Rescuer — {2}{W}
 * Legendary Creature — Elf Noble (3/2)
 *
 * Whenever you scry, choose one and Glorfindel gets +1/+1 until end of turn.
 * - Glorfindel must be blocked this turn if able.
 * - Glorfindel can't be blocked by more than one creature each combat this turn.
 *
 * IMPLEMENTED: scry trigger with +1/+1 buff + modal choice (must_be_blocked or menace).
 */
describe('Glorfindel, Dauntless Rescuer', () => {
  const DB = CardEffectsDB['glorfindel, dauntless rescuer'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever you scry" ──
  it('triggers on scry', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(trigger).toBeDefined();
  });

  // ── Oracle: "Glorfindel gets +1/+1 until end of turn" ──
  it('scry trigger buffs self +1/+1', () => {
    const trigger = DB.triggered[0];
    const buff = trigger.effects.find((e: any) => e.type === 'buff');
    expect(buff).toBeDefined();
    expect(buff.power).toBe(1);
    expect(buff.toughness).toBe(1);
    expect(buff.target).toBe('self');
  });

  // ── Oracle: "choose one" modal with 2 modes ──
  it('has modal choice with 2 modes', () => {
    const trigger = DB.triggered[0];
    const modal = trigger.effects.find((e: any) => e.type === 'modal');
    expect(modal).toBeDefined();
    expect(modal.modes).toHaveLength(2);
  });
});
