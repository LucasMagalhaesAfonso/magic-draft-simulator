import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Call of the Ring — {1}{B}
 * Enchantment
 *
 * At the beginning of your upkeep, the Ring tempts you.
 * Whenever you choose a creature as your Ring-bearer, you may pay 2 life.
 * If you do, draw a card.
 */
describe('Call of the Ring', () => {
  const DB = CardEffectsDB['call of the ring'];
  const CARD_DEF = {
    name: 'Call of the Ring',
    type_line: 'Enchantment',
    mana_cost: '{1}{B}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "At the beginning of your upkeep, the Ring tempts you" ──
  it('has upkeep trigger with ring_tempts', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'upkeep');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
    const ringEffect = trigger.effects.find((e: any) => e.type === 'ring_tempts');
    expect(ringEffect).toBeDefined();
  });

  // ── Oracle: "Whenever you choose a creature as your Ring-bearer" ──
  it('has ring_tempts trigger', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'ring_tempts');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  // ── Oracle: "you MAY pay 2 life" — must be optional ──
  it('ring_tempts trigger is optional (may pay life)', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'ring_tempts');
    expect(trigger.optional).toBe(true);
  });

  // ── Oracle: "pay 2 life. If you do, draw a card" ──
  it('ring_tempts effects: loseLife 2, draw 1', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'ring_tempts');
    const loseLife = trigger.effects.find((e: any) => e.type === 'loseLife');
    expect(loseLife).toBeDefined();
    expect(loseLife.amount).toBe(2);
    const draw = trigger.effects.find((e: any) => e.type === 'draw');
    expect(draw).toBeDefined();
    expect(draw.amount).toBe(1);
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

    it('upkeep trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('upkeep', { playerId: 0 });
      }).not.toThrow();
    });
  });
});
