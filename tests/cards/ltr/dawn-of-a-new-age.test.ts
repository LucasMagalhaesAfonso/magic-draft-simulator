import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Dawn of a New Age — {1}{W}
 * Enchantment
 *
 * This enchantment enters with a hope counter on it for each creature you control.
 * At the beginning of your end step, remove a hope counter from this enchantment.
 * If you do, draw a card. Then if this enchantment has no hope counters on it,
 * sacrifice it and you gain 4 life.
 *
 * IMPLEMENTED: ETB hope counters (creature_count), remove_counter_draw on end_step,
 * sacrifice when 0 counters + gain 4 life.
 */
describe('Dawn of a New Age', () => {
  const DB = CardEffectsDB['dawn of a new age'];
  const CARD_DEF = {
    name: 'Dawn of a New Age',
    type_line: 'Enchantment',
    mana_cost: '{1}{W}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── ETB: hope counters ──
  it('has etb with hope counters based on creature_count', () => {
    expect(DB.etb).toBeDefined();
    const counter = DB.etb.find((e: any) => e.type === 'counter_self');
    expect(counter).toBeDefined();
    expect(counter.counter).toBe('hope');
    expect(counter.amount).toBe('creature_count');
  });

  // ── End step: remove counter + draw ──
  it('has end_step trigger', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'end_step');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  it('end_step has remove_counter_draw effect', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'end_step');
    const rcd = trigger.effects.find((e: any) => e.type === 'remove_counter_draw');
    expect(rcd).toBeDefined();
    expect(rcd.counter).toBe('hope');
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
