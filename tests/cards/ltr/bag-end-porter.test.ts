import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Bag End Porter — {3}{G}
 * Creature — Dwarf (4/4)
 *
 * Whenever this creature attacks, it gets +X/+X until end of turn,
 * where X is the number of legendary creatures you control.
 */
describe('Bag End Porter', () => {
  const DB = CardEffectsDB['bag end porter'];
  const CARD_DEF = {
    name: 'Bag End Porter',
    type_line: 'Creature — Dwarf',
    mana_cost: '{3}{G}',
    power: '4',
    toughness: '4',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever this creature attacks" ──
  it('has attacks trigger with self: true', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(true);
  });

  // ── Oracle: "it gets +X/+X until end of turn, where X is the number of
  //    legendary creatures you control" ──
  it('attacks trigger buffs self with legendary_count for power and toughness', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    const effect = trigger.effects.find((e: any) => e.type === 'buff');
    expect(effect).toBeDefined();
    expect(effect.power).toBe('legendary_count');
    expect(effect.toughness).toBe('legendary_count');
    expect(effect.target).toBe('self');
    expect(effect.duration).toBe('end_of_turn');
  });

  // ── Stats: 4/4 ──
  it('is 4/4', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(4);
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

    it('attacks trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('attacks', { cardUid: card._uid, playerId: 0 });
      }).not.toThrow();
    });
  });
});
