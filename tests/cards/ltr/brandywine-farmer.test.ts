import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Brandywine Farmer — {2}{G}
 * Creature — Halfling Peasant (1/1)
 *
 * When this creature enters or leaves the battlefield, create a Food token.
 */
describe('Brandywine Farmer', () => {
  const DB = CardEffectsDB['brandywine farmer'];
  const CARD_DEF = {
    name: 'Brandywine Farmer',
    type_line: 'Creature — Halfling Peasant',
    mana_cost: '{2}{G}',
    power: '1',
    toughness: '1',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "When this creature enters ... create a Food token" ──
  it('ETB creates Food token', () => {
    expect(DB.etb).toBeDefined();
    const foodEffect = DB.etb.find((e: any) => e.type === 'create_token' && e.name === 'Food');
    expect(foodEffect).toBeDefined();
    expect(foodEffect.count === undefined || foodEffect.count === 1).toBe(true);
  });

  // ── Oracle: "or leaves the battlefield, create a Food token" ──
  it('has leaves_battlefield trigger (self: true) creating Food', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'leaves_battlefield');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(true);
    const foodEffect = trigger.effects.find((e: any) => e.type === 'create_token' && e.name === 'Food');
    expect(foodEffect).toBeDefined();
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

    it('leaves_battlefield trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('leaves_battlefield', { cardUid: card._uid, playerId: 0, card });
      }).not.toThrow();
    });
  });
});
