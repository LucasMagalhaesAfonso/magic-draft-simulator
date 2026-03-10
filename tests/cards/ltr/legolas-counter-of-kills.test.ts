import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Legolas, Counter of Kills — {2}{G}
 * Legendary Creature — Elf Archer (2/3)
 *
 * Reach
 * Whenever you scry, if Legolas is tapped, you may untap it. Do this only once each turn.
 * Whenever a creature an opponent controls dies, put a +1/+1 counter on Legolas.
 *
 * IMPLEMENTED: scry trigger with self_tapped condition + untap_self + once_per_turn,
 *              opponent_creature_dies trigger with +1/+1 counter.
 */
describe('Legolas, Counter of Kills', () => {
  const DB = CardEffectsDB['legolas, counter of kills'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  it('has Reach', () => {
    const kw = DB.static.find((s: any) => s.type === 'has_keyword');
    expect(kw.keywords).toContain('reach');
  });

  // ── Oracle: "Whenever you scry, if tapped, untap. Once per turn." ──
  it('has scry trigger with self_tapped condition and untap_self', () => {
    const scryTrigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(scryTrigger).toBeDefined();
    expect(scryTrigger.condition).toBe('self_tapped');
    expect(scryTrigger.once_per_turn).toBe(true);
    const untap = scryTrigger.effects.find((e: any) => e.type === 'untap_self');
    expect(untap).toBeDefined();
  });

  // ── Oracle: "Whenever opponent creature dies, +1/+1 counter" ──
  it('has opponent_creature_dies trigger with +1/+1 counter', () => {
    const diesTrigger = DB.triggered.find((t: any) => t.event === 'opponent_creature_dies');
    expect(diesTrigger).toBeDefined();
    const counter = diesTrigger.effects.find((e: any) => e.type === 'counter_self');
    expect(counter).toBeDefined();
    expect(counter.counter).toBe('+1/+1');
  });
});
