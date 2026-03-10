import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Celeborn the Wise — {3}{G}
 * Legendary Creature — Elf Noble (3/3)
 *
 * Whenever you attack with one or more Elves, scry 1.
 * Whenever you scry, Celeborn gets +1/+1 until end of turn for each card
 * looked at while scrying this way.
 */
describe('Celeborn the Wise', () => {
  const DB = CardEffectsDB['celeborn the wise'];
  const CARD_DEF = {
    name: 'Celeborn the Wise',
    type_line: 'Legendary Creature — Elf Noble',
    mana_cost: '{3}{G}',
    power: '3',
    toughness: '3',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever you attack with one or more Elves, scry 1" ──
  it('has attacks trigger with condition elf_attacks', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks' && t.condition === 'elf_attacks');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  it('elf attacks trigger scries 1', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks' && t.condition === 'elf_attacks');
    const scryEffect = trigger.effects.find((e: any) => e.type === 'scry');
    expect(scryEffect).toBeDefined();
    expect(scryEffect.amount).toBe(1);
  });

  // ── Oracle: "Whenever you scry, Celeborn gets +1/+1 until end of turn
  //    for each card looked at while scrying this way" ──
  it('has scry trigger that buffs self', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  // Oracle: "for each card looked at" — buff scales with scry_amount
  it('scry trigger buffs self by scry_amount eot', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    const buff = trigger.effects.find((e: any) => e.type === 'buff');
    expect(buff).toBeDefined();
    expect(buff.power).toBe('scry_amount');
    expect(buff.toughness).toBe('scry_amount');
    expect(buff.target).toBe('self');
    expect(buff.duration).toBe('end_of_turn');
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

    it('scry trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('scry', { playerId: 0 });
      }).not.toThrow();
    });
  });
});
