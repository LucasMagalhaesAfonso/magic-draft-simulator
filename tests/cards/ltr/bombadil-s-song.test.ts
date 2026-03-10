import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Bombadil's Song — {1}{G}
 * Instant
 *
 * Target creature you control gets +1/+1 and gains hexproof until end of turn.
 * The Ring tempts you.
 */
describe("Bombadil's Song", () => {
  const DB = CardEffectsDB["bombadil's song"];
  const CARD_DEF = {
    name: "Bombadil's Song",
    type_line: 'Instant',
    mana_cost: '{1}{G}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Target creature you control gets +1/+1 and gains hexproof until end of turn" ──
  it('cast buffs own_creature +1/+1 with hexproof until end of turn', () => {
    expect(DB.cast).toBeDefined();
    const buffEffect = DB.cast.find((e: any) => e.type === 'buff');
    expect(buffEffect).toBeDefined();
    expect(buffEffect.power).toBe(1);
    expect(buffEffect.toughness).toBe(1);
    expect(buffEffect.target).toBe('own_creature');
    expect(buffEffect.duration).toBe('end_of_turn');
    expect(buffEffect.keywords).toContain('hexproof');
  });

  // ── Oracle: "The Ring tempts you" ──
  it('cast includes ring_tempts after buff', () => {
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[0].type).toBe('buff');
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
