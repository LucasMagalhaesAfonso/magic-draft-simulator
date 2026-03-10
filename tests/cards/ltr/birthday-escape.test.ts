import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Birthday Escape — {U}
 * Sorcery
 *
 * Draw a card. The Ring tempts you.
 */
describe('Birthday Escape', () => {
  const DB = CardEffectsDB['birthday escape'];
  const CARD_DEF = {
    name: 'Birthday Escape',
    type_line: 'Sorcery',
    mana_cost: '{U}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Draw a card. The Ring tempts you." — exactly 2 effects in order ──
  it('cast has exactly 2 effects: draw then ring_tempts', () => {
    expect(DB.cast).toBeDefined();
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[0].type).toBe('draw');
    expect(DB.cast[0].amount).toBe(1);
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
