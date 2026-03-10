import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Eagles of the North — {5}{W}
 * Creature — Bird Soldier (3/3)
 *
 * Flying
 * When this creature enters, creatures you control get +1/+0 and gain
 * first strike until end of turn.
 * Plainscycling {1}
 */
describe('Eagles of the North', () => {
  const DB = CardEffectsDB['eagles of the north'];
  const CARD_DEF = {
    name: 'Eagles of the North',
    type_line: 'Creature — Bird Soldier',
    mana_cost: '{5}{W}',
    power: '3',
    toughness: '3',
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

  // ── Oracle: "creatures you control get +1/+0 and gain first strike until end of turn" ──
  it('ETB has buff_all +1/+0 with first strike, own_creatures, end_of_turn', () => {
    expect(DB.etb).toBeDefined();
    const buff = DB.etb.find((e: any) => e.type === 'buff_all');
    expect(buff).toBeDefined();
    expect(buff.power).toBe(1);
    expect(buff.toughness).toBe(0);
    expect(buff.target).toBe('own_creatures');
    expect(buff.duration).toBe('end_of_turn');
    expect(buff.keywords).toContain('first strike');
  });

  // ── Oracle: "Plainscycling {1}" ──
  it('has Plainscycling with cost 1', () => {
    expect(DB.cycling).toBeDefined();
    expect(DB.cycling.cost).toBe('1');
    expect(DB.cycling.type).toBe('typecycling');
    expect(DB.cycling.searchType).toBe('Plains');
  });

  // ── Stats: 3/3 ──
  it('is 3/3', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(3);
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
