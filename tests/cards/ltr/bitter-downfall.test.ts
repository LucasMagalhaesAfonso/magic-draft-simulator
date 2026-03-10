import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Bitter Downfall — {3}{B}
 * Instant
 *
 * This spell costs {3} less to cast if it targets a creature that was dealt
 * damage this turn.
 * Destroy target creature. Its controller loses 2 life.
 */
describe('Bitter Downfall', () => {
  const DB = CardEffectsDB['bitter downfall'];
  const CARD_DEF = {
    name: 'Bitter Downfall',
    type_line: 'Instant',
    mana_cost: '{3}{B}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "costs {3} less if it targets a creature that was dealt damage this turn" ──
  it('has self_cost_reduction: target_damaged, amount 3', () => {
    expect(DB.self_cost_reduction).toBeDefined();
    expect(DB.self_cost_reduction.condition).toBe('target_damaged');
    expect(DB.self_cost_reduction.amount).toBe(3);
  });

  // ── Oracle: "Destroy target creature" ──
  it('cast destroys target creature', () => {
    expect(DB.cast).toBeDefined();
    const destroyEffect = DB.cast.find((e: any) => e.type === 'destroy');
    expect(destroyEffect).toBeDefined();
    expect(destroyEffect.target).toBe('creature');
  });

  // ── Oracle: "Its controller loses 2 life" ──
  it('cast makes target controller lose 2 life', () => {
    const lifeEffect = DB.cast.find((e: any) => e.type === 'loseLife');
    expect(lifeEffect).toBeDefined();
    expect(lifeEffect.amount).toBe(2);
    expect(lifeEffect.target).toBe('target_controller');
  });

  // ── Cast effects in correct order: destroy, then loseLife ──
  it('effects are in order: destroy then loseLife', () => {
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[0].type).toBe('destroy');
    expect(DB.cast[1].type).toBe('loseLife');
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
