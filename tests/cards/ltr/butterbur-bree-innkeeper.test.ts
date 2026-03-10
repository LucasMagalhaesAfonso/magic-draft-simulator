import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Butterbur, Bree Innkeeper — {2}{G}{W}
 * Legendary Creature — Human Peasant (3/3)
 *
 * At the beginning of your end step, if you don't control a Food,
 * create a Food token.
 */
describe('Butterbur, Bree Innkeeper', () => {
  const DB = CardEffectsDB['butterbur, bree innkeeper'];
  const CARD_DEF = {
    name: 'Butterbur, Bree Innkeeper',
    type_line: 'Legendary Creature — Human Peasant',
    mana_cost: '{2}{G}{W}',
    power: '3',
    toughness: '3',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "At the beginning of your end step" ──
  it('has end_step trigger (self: false — not per-creature)', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'end_step');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  // ── Oracle: "if you don't control a Food" ──
  it('end_step has condition no_food_controlled', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'end_step');
    expect(trigger.condition).toBe('no_food_controlled');
  });

  // ── Oracle: "create a Food token" ──
  it('end_step creates Food token', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'end_step');
    const foodEffect = trigger.effects.find((e: any) => e.type === 'create_token' && e.name === 'Food');
    expect(foodEffect).toBeDefined();
    expect(foodEffect.count === undefined || foodEffect.count === 1).toBe(true);
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

    it('end_step trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('end_step', { playerId: 0 });
      }).not.toThrow();
    });
  });
});
