import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Battle-Scarred Goblin — {1}{R}
 * Creature — Goblin Warrior (2/2)
 *
 * Whenever this creature becomes blocked, it deals 1 damage to each
 * creature blocking it.
 */
describe('Battle-Scarred Goblin', () => {
  const DB = CardEffectsDB['battle-scarred goblin'];
  const CARD_DEF = {
    name: 'Battle-Scarred Goblin',
    type_line: 'Creature — Goblin Warrior',
    mana_cost: '{1}{R}',
    power: '2',
    toughness: '2',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever this creature becomes blocked" ──
  it('has becomes_blocked trigger with self: true', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'becomes_blocked');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(true);
  });

  // ── Oracle: "it deals 1 damage to each creature blocking it" ──
  it('becomes_blocked deals 1 damage to each_blocker', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'becomes_blocked');
    const effect = trigger.effects.find((e: any) => e.type === 'damage');
    expect(effect).toBeDefined();
    expect(effect.amount).toBe(1);
    expect(effect.target).toBe('each_blocker');
  });

  // ── Stats: 2/2 ──
  it('is 2/2', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(2);
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

    it('becomes_blocked trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('becomes_blocked', { cardUid: card._uid, playerId: 0 });
      }).not.toThrow();
    });
  });
});
