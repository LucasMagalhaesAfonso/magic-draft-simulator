import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Enraged Huorn — {4}{G}
 * Creature — Treefolk (4/5)
 *
 * Trample
 * When this creature enters, the Ring tempts you.
 */
describe('Enraged Huorn', () => {
  const DB = CardEffectsDB['enraged huorn'];
  const CARD_DEF = {
    name: 'Enraged Huorn',
    type_line: 'Creature — Treefolk',
    mana_cost: '{4}{G}',
    power: '4',
    toughness: '5',
    keywords: ['Trample'],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Trample" ──
  it('has trample in static keywords', () => {
    const kw = DB.static?.find((s: any) => s.type === 'has_keyword');
    expect(kw).toBeDefined();
    expect(kw.keywords).toContain('trample');
  });

  // ── Oracle: "When this creature enters, the Ring tempts you" ──
  it('ETB has ring_tempts', () => {
    expect(DB.etb).toBeDefined();
    const ring = DB.etb.find((e: any) => e.type === 'ring_tempts');
    expect(ring).toBeDefined();
  });

  // ── Stats: 4/5 ──
  it('is 4/5', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(4);
    expect(CardUtils.getToughness(card)).toBe(5);
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
