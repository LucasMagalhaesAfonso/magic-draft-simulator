import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Gwaihir the Windlord — {3}{W}{U}
 * Legendary Creature — Bird Noble (4/4)
 *
 * This spell costs {2} less to cast as long as you've drawn two or more cards this turn.
 * Flying, vigilance
 * Other Birds you control have vigilance.
 *
 * IMPLEMENTED: self_cost_reduction drawn_two_cards + grant_all vigilance to birds.
 */
describe('Gwaihir the Windlord', () => {
  const DB = CardEffectsDB['gwaihir the windlord'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  it('has flying and vigilance', () => {
    const kw = DB.static.find((s: any) => s.type === 'has_keyword');
    expect(kw.keywords).toContain('flying');
    expect(kw.keywords).toContain('vigilance');
  });

  // ── Oracle: "Other Birds you control have vigilance" ──
  it('grants vigilance to Birds via grant_all', () => {
    const grantAll = DB.static.find((s: any) => s.type === 'grant_all' && s.target === 'birds');
    expect(grantAll).toBeDefined();
    expect(grantAll.keyword).toBe('Vigilance');
  });

  // ── Oracle: "costs {2} less if drawn 2+ cards" ──
  it('has self_cost_reduction for drawn_two_cards', () => {
    expect(DB.self_cost_reduction).toBeDefined();
    expect(DB.self_cost_reduction.condition).toBe('drawn_two_cards');
    expect(DB.self_cost_reduction.amount).toBe(2);
  });
});
