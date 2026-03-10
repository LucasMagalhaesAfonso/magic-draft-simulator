import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Eastfarthing Farmer — {2}{W}
 * Creature — Halfling Peasant (2/3)
 *
 * When this creature enters, create a Food token. When you do, target creature
 * you control gets +1/+1 until end of turn for each Food you control.
 */
describe('Eastfarthing Farmer', () => {
  const DB = CardEffectsDB['eastfarthing farmer'];
  const CARD_DEF = {
    name: 'Eastfarthing Farmer',
    type_line: 'Creature — Halfling Peasant',
    mana_cost: '{2}{W}',
    power: '2',
    toughness: '3',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "create a Food token" ──
  it('ETB creates Food token', () => {
    expect(DB.etb).toBeDefined();
    const food = DB.etb.find((e: any) => e.type === 'create_token' && e.name === 'Food');
    expect(food).toBeDefined();
  });

  // ── Oracle: "target creature you control gets +1/+1 ... for each Food you control" ──
  it('ETB has buff with food_count power/toughness', () => {
    const buff = DB.etb.find((e: any) => e.type === 'buff');
    expect(buff).toBeDefined();
    expect(buff.power).toBe('food_count');
    expect(buff.toughness).toBe('food_count');
    expect(buff.target).toBe('own_creature');
    expect(buff.duration).toBe('end_of_turn');
  });

  it('effects in order: create Food then buff', () => {
    expect(DB.etb.length).toBe(2);
    expect(DB.etb[0].type).toBe('create_token');
    expect(DB.etb[1].type).toBe('buff');
  });

  // ── Stats: 2/3 ──
  it('is 2/3', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(2);
    expect(CardUtils.getToughness(card)).toBe(3);
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
