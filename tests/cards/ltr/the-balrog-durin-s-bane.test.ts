import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * The Balrog, Durin's Bane — {8}{B}{R}
 * Legendary Creature — Avatar Demon (7/5)
 *
 * This spell costs {1} less to cast for each permanent sacrificed this turn.
 * Haste
 * The Balrog can't be blocked except by legendary creatures.
 * When The Balrog dies, destroy target artifact or creature an opponent controls.
 *
 * IMPLEMENTED: cost reduction + haste + legendary_only evasion + dies destroy.
 */
describe('The Balrog, Durin\'s Bane', () => {
  const DB = CardEffectsDB['the balrog, durin\'s bane'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "costs {1} less for each permanent sacrificed this turn" ──
  it('has self_cost_reduction permanents_sacrificed_this_turn', () => {
    expect(DB.self_cost_reduction).toBe('permanents_sacrificed_this_turn');
  });

  // ── Oracle: "Haste" ──
  it('has haste', () => {
    const kw = DB.static.find((s: any) => s.type === 'has_keyword');
    expect(kw.keywords).toContain('haste');
  });

  // ── Oracle: "can't be blocked except by legendary creatures" ──
  it('has legendary_only evasion', () => {
    const evasion = DB.static.find((s: any) => s.type === 'evasion');
    expect(evasion).toBeDefined();
    expect(evasion.evasion).toBe('legendary_only');
  });

  // ── Oracle: "When The Balrog dies, destroy target artifact or creature" ──
  it('has dies trigger destroying opponent artifact or creature', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'dies');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(true);
    const destroy = trigger.effects.find((e: any) => e.type === 'destroy');
    expect(destroy.target).toBe('opponent_artifact_or_creature');
  });
});
