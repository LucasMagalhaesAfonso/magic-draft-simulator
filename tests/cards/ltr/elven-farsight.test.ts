import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Elven Farsight — {G}
 * Sorcery
 *
 * Scry 3, then you may reveal the top card of your library.
 * If it's a creature card, draw a card.
 *
 * IMPLEMENTED: scry 3 + reveal top, if creature draw a card (creature_to_hand).
 */
describe('Elven Farsight', () => {
  const DB = CardEffectsDB['elven farsight'];
  const CARD_DEF = {
    name: 'Elven Farsight',
    type_line: 'Sorcery',
    mana_cost: '{G}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle (simplified): "Scry 3" ──
  it('cast has scry 3', () => {
    expect(DB.cast).toBeDefined();
    const scry = DB.cast.find((e: any) => e.type === 'scry');
    expect(scry).toBeDefined();
    expect(scry.amount).toBe(3);
  });

  it('cast has scry + look_top creature_to_hand (2 effects)', () => {
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[1].type).toBe('look_top');
    expect(DB.cast[1].condition).toBe('creature_to_hand');
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
