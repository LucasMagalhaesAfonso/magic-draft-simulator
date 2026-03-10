import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Delighted Halfling — {G}
 * Creature — Halfling Citizen (1/2)
 *
 * {T}: Add {C}.
 * {T}: Add one mana of any color. Spend this mana only to cast a legendary
 * spell, and that spell can't be countered.
 *
 * IMPLEMENTED: uncounterable flag on legendary mana — legendary spells cast
 * with Delighted Halfling's mana can't be countered.
 */
describe('Delighted Halfling', () => {
  const DB = CardEffectsDB['delighted halfling'];
  const CARD_DEF = {
    name: 'Delighted Halfling',
    type_line: 'Creature — Halfling Citizen',
    mana_cost: '{G}',
    power: '1',
    toughness: '2',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "{T}: Add {C}" ──
  it('has activated ability 1: tap for colorless mana', () => {
    expect(DB.activated).toBeDefined();
    expect(DB.activated.length).toBe(2);
    const colorless = DB.activated[0];
    expect(colorless.cost.tap).toBe(true);
    const addMana = colorless.effects.find((e: any) => e.type === 'add_mana');
    expect(addMana).toBeDefined();
    expect(addMana.color).toBe('C');
  });

  // ── Oracle: "{T}: Add one mana of any color. Spend this mana only to cast a legendary spell" ──
  it('has activated ability 2: tap for any color, legendary restriction', () => {
    const legendary = DB.activated[1];
    expect(legendary.cost.tap).toBe(true);
    const addMana = legendary.effects.find((e: any) => e.type === 'add_mana');
    expect(addMana).toBeDefined();
    expect(addMana.color).toBe('any');
    expect(addMana.uncounterable).toBe(true);
    expect(legendary.restriction).toBe('legendary');
  });

  // ── Stats: 1/2 ──
  it('is 1/2', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(1);
    expect(CardUtils.getToughness(card)).toBe(2);
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
