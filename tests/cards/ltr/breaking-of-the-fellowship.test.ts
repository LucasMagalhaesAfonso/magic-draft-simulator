import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Breaking of the Fellowship — {1}{R}
 * Sorcery
 *
 * Target creature an opponent controls deals damage equal to its power to
 * another target creature that player controls. The Ring tempts you.
 */
describe('Breaking of the Fellowship', () => {
  const DB = CardEffectsDB['breaking of the fellowship'];
  const CARD_DEF = {
    name: 'Breaking of the Fellowship',
    type_line: 'Sorcery',
    mana_cost: '{1}{R}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: one opponent creature deals damage to another (bite) ──
  it('cast has bite effect targeting opponent_creature_vs_opponent', () => {
    expect(DB.cast).toBeDefined();
    const biteEffect = DB.cast.find((e: any) => e.type === 'bite');
    expect(biteEffect).toBeDefined();
    expect(biteEffect.target).toBe('opponent_creature_vs_opponent');
  });

  // ── Oracle: "The Ring tempts you" ──
  it('cast includes ring_tempts', () => {
    const ringEffect = DB.cast.find((e: any) => e.type === 'ring_tempts');
    expect(ringEffect).toBeDefined();
  });

  // ── Effects order: bite then ring_tempts ──
  it('effects in order: bite then ring_tempts', () => {
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[0].type).toBe('bite');
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
