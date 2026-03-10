import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Dunland Crebain — {2}{B}
 * Creature — Bird Horror (1/1)
 *
 * Flying
 * When this creature enters, amass Orcs 2.
 */
describe('Dunland Crebain', () => {
  const DB = CardEffectsDB['dunland crebain'];
  const CARD_DEF = {
    name: 'Dunland Crebain',
    type_line: 'Creature — Bird Horror',
    mana_cost: '{2}{B}',
    power: '1',
    toughness: '1',
    keywords: ['Flying'],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Flying" ──
  it('has flying in static keywords', () => {
    const kw = DB.static?.find((s: any) => s.type === 'has_keyword');
    expect(kw).toBeDefined();
    expect(kw.keywords).toContain('flying');
  });

  // ── Oracle: "When this creature enters, amass Orcs 2" ──
  it('ETB has amass 2', () => {
    expect(DB.etb).toBeDefined();
    const amass = DB.etb.find((e: any) => e.type === 'amass');
    expect(amass).toBeDefined();
    expect(amass.amount).toBe(2);
  });

  it('amass has subtype Orcs', () => {
    const amass = DB.etb.find((e: any) => e.type === 'amass');
    expect(amass.subtype).toBe('Orcs');
  });

  // ── Stats: 1/1 ──
  it('is 1/1', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(1);
    expect(CardUtils.getToughness(card)).toBe(1);
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
