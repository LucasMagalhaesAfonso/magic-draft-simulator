import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Captain of Umbar — {2}{U}
 * Creature — Human Pirate (2/3)
 *
 * {1}, {T}: Draw a card, then discard a card.
 */
describe('Captain of Umbar', () => {
  const DB = CardEffectsDB['captain of umbar'];
  const CARD_DEF = {
    name: 'Captain of Umbar',
    type_line: 'Creature — Human Pirate',
    mana_cost: '{2}{U}',
    power: '2',
    toughness: '3',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "{1}, {T}:" (cost) ──
  it('activated ability costs {1} + tap', () => {
    expect(DB.activated).toBeDefined();
    expect(DB.activated.length).toBeGreaterThanOrEqual(1);
    const ability = DB.activated[0];
    expect(ability.cost.mana).toBe(1);
    expect(ability.cost.tap).toBe(true);
  });

  // ── Oracle: "Draw a card, then discard a card" = loot ──
  it('activated effect is loot (draw 1, discard 1)', () => {
    const ability = DB.activated[0];
    const lootEffect = ability.effects.find((e: any) => e.type === 'loot');
    expect(lootEffect).toBeDefined();
    expect(lootEffect.draw).toBe(1);
    expect(lootEffect.discard).toBe(1);
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
