import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Nimble Hobbit — {1}{W}
 * Creature — Halfling Rogue (2/1)
 *
 * Whenever this creature attacks, you may sacrifice a Food or pay {2}{W}.
 * When you do, tap target creature an opponent controls.
 *
 * IMPLEMENTED: attacks trigger with optional trigger_cost (sacrifice Food or pay mana) + tap opponent creature.
 */
describe('Nimble Hobbit', () => {
  const DB = CardEffectsDB['nimble hobbit'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever this creature attacks" ──
  it('has attacks trigger (self)', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(true);
  });

  // ── Oracle: "you may sacrifice a Food or pay {2}{W}" ──
  it('trigger is optional with trigger_cost', () => {
    const trigger = DB.triggered[0];
    expect(trigger.optional).toBe(true);
    expect(trigger.trigger_cost).toBeDefined();
    expect(trigger.trigger_cost.sacrifice).toBe('Food');
    expect(trigger.trigger_cost.or_mana).toBe('{2}{W}');
  });

  // ── Oracle: "tap target creature an opponent controls" ──
  it('trigger taps opponent creature', () => {
    const trigger = DB.triggered[0];
    const tap = trigger.effects.find((e: any) => e.type === 'tap');
    expect(tap).toBeDefined();
    expect(tap.target).toBe('opponent_creature');
  });
});
