import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Chance-Met Elves — {2}{G}
 * Creature — Elf Warrior (3/2)
 *
 * Whenever you scry, put a +1/+1 counter on this creature.
 * This ability triggers only once each turn.
 */
describe('Chance-Met Elves', () => {
  const DB = CardEffectsDB['chance-met elves'];
  const CARD_DEF = {
    name: 'Chance-Met Elves',
    type_line: 'Creature — Elf Warrior',
    mana_cost: '{2}{G}',
    power: '3',
    toughness: '2',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever you scry" ──
  it('has scry trigger (self: false)', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  // ── Oracle: "put a +1/+1 counter on this creature" ──
  it('scry trigger puts +1/+1 counter on self', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    const effect = trigger.effects.find((e: any) => e.type === 'counter_self');
    expect(effect).toBeDefined();
    expect(effect.counter).toBe('+1/+1');
    expect(effect.amount).toBe(1);
  });

  // ── Oracle: "This ability triggers only once each turn" ──
  it('scry trigger has once_per_turn: true', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(trigger.once_per_turn).toBe(true);
  });

  // ── Stats: 3/2 ──
  it('is 3/2', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(3);
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

    it('scry trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('scry', { playerId: 0, cardUid: card._uid });
      }).not.toThrow();
    });
  });
});
