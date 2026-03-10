import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Nimrodel Watcher — {1}{U}
 * Creature — Elf Scout (2/1)
 *
 * Whenever you scry, this creature gets +1/+0 until end of turn and can't be
 * blocked this turn. This ability triggers only once each turn.
 *
 * IMPLEMENTED: scry trigger with once_per_turn, buff +1/+0 and unblockable.
 */
describe('Nimrodel Watcher', () => {
  const DB = CardEffectsDB['nimrodel watcher'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever you scry" ──
  it('has scry trigger', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(trigger).toBeDefined();
  });

  // ── Oracle: "only once each turn" ──
  it('trigger is once_per_turn', () => {
    const trigger = DB.triggered[0];
    expect(trigger.once_per_turn).toBe(true);
  });

  // ── Oracle: "+1/+0 and can't be blocked" ──
  it('trigger buffs +1/+0 and grants unblockable', () => {
    const trigger = DB.triggered[0];
    const buff = trigger.effects.find((e: any) => e.type === 'buff');
    expect(buff).toBeDefined();
    expect(buff.power).toBe(1);
    expect(buff.toughness).toBe(0);
    const grant = trigger.effects.find((e: any) => e.type === 'grant');
    expect(grant).toBeDefined();
    expect(grant.keywords).toContain('unblockable');
  });
});
