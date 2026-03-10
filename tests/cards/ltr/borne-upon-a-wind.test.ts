import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Borne Upon a Wind — {1}{U}
 * Instant
 *
 * You may cast spells this turn as though they had flash.
 * Draw a card.
 */
describe('Borne Upon a Wind', () => {
  const DB = CardEffectsDB['borne upon a wind'];
  const CARD_DEF = {
    name: 'Borne Upon a Wind',
    type_line: 'Instant',
    mana_cost: '{1}{U}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle order: flash grant FIRST, then draw ──
  it('cast has exactly 2 effects in order: grant_flash_all_spells then draw', () => {
    expect(DB.cast).toBeDefined();
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[0].type).toBe('grant_flash_all_spells');
    expect(DB.cast[0].duration).toBe('end_of_turn');
    expect(DB.cast[1].type).toBe('draw');
    expect(DB.cast[1].amount).toBe(1);
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
