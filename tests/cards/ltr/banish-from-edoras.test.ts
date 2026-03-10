import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Banish from Edoras — {4}{W}
 * Sorcery
 *
 * This spell costs {2} less to cast if it targets a tapped creature.
 * Exile target creature.
 */
describe('Banish from Edoras', () => {
  const DB = CardEffectsDB['banish from edoras'];
  const CARD_DEF = {
    name: 'Banish from Edoras',
    type_line: 'Sorcery',
    mana_cost: '{4}{W}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "This spell costs {2} less to cast if it targets a tapped creature" ──
  it('has self_cost_reduction for targeting tapped creature, amount 2', () => {
    expect(DB.self_cost_reduction).toBeDefined();
    expect(DB.self_cost_reduction.condition).toBe('target_tapped');
    expect(DB.self_cost_reduction.amount).toBe(2);
  });

  // ── Oracle: "Exile target creature" ──
  it('cast effect is exile targeting creature', () => {
    expect(DB.cast).toBeDefined();
    expect(DB.cast.length).toBeGreaterThanOrEqual(1);
    const exileEffect = DB.cast.find((e: any) => e.type === 'exile');
    expect(exileEffect).toBeDefined();
    expect(exileEffect.target).toBe('creature');
  });

  // ── Human interaction ──
  describe('Human player', () => {
    it('can cast from hand', () => {
      const game = new TestGame();
      game.setHuman(0, true);
      const { result } = game.castFromHand(0, CARD_DEF);
      expect(result).not.toBe(false);
    });
  });

  // ── AI interaction ──
  describe('AI player', () => {
    it('can cast from hand without crash', () => {
      const game = new TestGame();
      const { result } = game.castFromHand(0, CARD_DEF);
      expect(result).not.toBe(false);
    });
  });
});
