import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Dreadful as the Storm — {2}{U}
 * Instant
 *
 * Target creature has base power and toughness 5/5 until end of turn.
 * The Ring tempts you.
 *
 * IMPLEMENTED: set_base_pt effect correctly sets base P/T to 5/5.
 */
describe('Dreadful as the Storm', () => {
  const DB = CardEffectsDB['dreadful as the storm'];
  const CARD_DEF = {
    name: 'Dreadful as the Storm',
    type_line: 'Instant',
    mana_cost: '{2}{U}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Target creature has base power and toughness 5/5 until end of turn" ──
  it('cast has set_base_pt 5/5 targeting creature, end_of_turn', () => {
    expect(DB.cast).toBeDefined();
    const effect = DB.cast.find((e: any) => e.type === 'set_base_pt');
    expect(effect).toBeDefined();
    expect(effect.power).toBe(5);
    expect(effect.toughness).toBe(5);
    expect(effect.target).toBe('creature');
    expect(effect.duration).toBe('end_of_turn');
  });

  // ── Oracle: "The Ring tempts you" ──
  it('cast includes ring_tempts', () => {
    const ring = DB.cast.find((e: any) => e.type === 'ring_tempts');
    expect(ring).toBeDefined();
  });

  it('effects in order: set_base_pt then ring_tempts', () => {
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[0].type).toBe('set_base_pt');
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
