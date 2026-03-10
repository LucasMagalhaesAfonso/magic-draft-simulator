import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Elrond, Master of Healing — {2}{G}{U}
 * Legendary Creature — Elf Noble (4/4)
 *
 * Whenever you scry, put a +1/+1 counter on each of up to X target creatures,
 * where X is the number of cards looked at while scrying this way.
 * Whenever a creature you control with a +1/+1 counter on it becomes the target
 * of a spell or ability an opponent controls, you may draw a card.
 *
 * IMPLEMENTED: scry_amount dynamic — counter amount scales with scry size.
 */
describe('Elrond, Master of Healing', () => {
  const DB = CardEffectsDB['elrond, master of healing'];
  const CARD_DEF = {
    name: 'Elrond, Master of Healing',
    type_line: 'Legendary Creature — Elf Noble',
    mana_cost: '{2}{G}{U}',
    power: '4',
    toughness: '4',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever you scry" (trigger 1) ──
  it('has scry trigger', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  // ── Oracle: "put a +1/+1 counter on each of up to X target creatures" ──
  it('scry trigger puts scry_amount +1/+1 counters on own creature', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    const counter = trigger.effects.find((e: any) => e.type === 'counter');
    expect(counter).toBeDefined();
    expect(counter.counter).toBe('+1/+1');
    expect(counter.amount).toBe('scry_amount');
    expect(counter.target).toBe('own_creature');
  });

  // ── Oracle: "Whenever a creature you control with a +1/+1 counter ... targeted by opponent" (trigger 2) ──
  it('has own_creature_targeted_by_opponent trigger', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'own_creature_targeted_by_opponent');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  it('targeted trigger has has_counter condition', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'own_creature_targeted_by_opponent');
    expect(trigger.condition).toBe('has_counter');
  });

  // ── Oracle: "you may draw a card" ──
  it('targeted trigger draws 1 card (optional)', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'own_creature_targeted_by_opponent');
    const draw = trigger.effects.find((e: any) => e.type === 'draw');
    expect(draw).toBeDefined();
    expect(draw.amount).toBe(1);
    expect(draw.optional).toBe(true);
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
  });
});
