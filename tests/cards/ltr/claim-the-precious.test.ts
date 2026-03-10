import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Claim the Precious — {1}{B}{B}
 * Sorcery
 *
 * Destroy target creature. The Ring tempts you.
 */
describe('Claim the Precious', () => {
  const DB = CardEffectsDB['claim the precious'];
  const CARD_DEF = {
    name: 'Claim the Precious',
    type_line: 'Sorcery',
    mana_cost: '{1}{B}{B}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Destroy target creature" ──
  it('cast destroys target creature', () => {
    expect(DB.cast).toBeDefined();
    const destroy = DB.cast.find((e: any) => e.type === 'destroy');
    expect(destroy).toBeDefined();
    expect(destroy.target).toBe('creature');
  });

  // ── Oracle: "The Ring tempts you" ──
  it('cast includes ring_tempts', () => {
    const ring = DB.cast.find((e: any) => e.type === 'ring_tempts');
    expect(ring).toBeDefined();
  });

  it('effects in order: destroy then ring_tempts', () => {
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[0].type).toBe('destroy');
    expect(DB.cast[1].type).toBe('ring_tempts');
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
