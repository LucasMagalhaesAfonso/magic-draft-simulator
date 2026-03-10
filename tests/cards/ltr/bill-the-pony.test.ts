import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Bill the Pony — {3}{W}
 * Legendary Creature — Horse (1/4)
 *
 * When Bill the Pony enters, create two Food tokens.
 * Sacrifice a Food: Until end of turn, target creature you control assigns
 * combat damage equal to its toughness rather than its power.
 */
describe('Bill the Pony', () => {
  const DB = CardEffectsDB['bill the pony'];
  const CARD_DEF = {
    name: 'Bill the Pony',
    type_line: 'Legendary Creature — Horse',
    mana_cost: '{3}{W}',
    power: '1',
    toughness: '4',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "When Bill the Pony enters, create two Food tokens" ──
  it('ETB creates 2 Food tokens', () => {
    expect(DB.etb).toBeDefined();
    const foodEffect = DB.etb.find((e: any) => e.type === 'create_token' && e.name === 'Food');
    expect(foodEffect).toBeDefined();
    expect(foodEffect.count).toBe(2);
  });

  // ── Oracle: "Sacrifice a Food:" (activated ability cost) ──
  it('activated ability costs sacrifice Food', () => {
    expect(DB.activated).toBeDefined();
    expect(DB.activated.length).toBeGreaterThanOrEqual(1);
    const ability = DB.activated[0];
    expect(ability.cost).toBeDefined();
    expect(ability.cost.sacrifice).toBe('Food');
  });

  // ── Oracle: "target creature you control assigns combat damage equal to its
  //    toughness rather than its power" ──
  it('activated grants assign_damage_by_toughness to own_creature (including self)', () => {
    const ability = DB.activated[0];
    const grantEffect = ability.effects.find((e: any) => e.type === 'grant');
    expect(grantEffect).toBeDefined();
    expect(grantEffect.keywords).toContain('assign_damage_by_toughness');
    // Oracle says "target creature you control" — NOT "another target creature"
    // So it must be own_creature (can target self), NOT other_own_creature
    expect(grantEffect.target).toBe('own_creature');
    expect(grantEffect.duration).toBe('end_of_turn');
  });

  // ── Stats: 1/4 ──
  it('is 1/4', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(1);
    expect(CardUtils.getToughness(card)).toBe(4);
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
