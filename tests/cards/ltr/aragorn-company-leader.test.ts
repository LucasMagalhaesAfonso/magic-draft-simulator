import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Aragorn, Company Leader — {1}{G}{W}
 * Legendary Creature — Human Ranger (3/3)
 *
 * Whenever the Ring tempts you, if you chose a creature other than Aragorn
 * as your Ring-bearer, put your choice of a counter from among first strike,
 * vigilance, deathtouch, and lifelink on Aragorn.
 * Whenever you put one or more counters on Aragorn, put one of each of those
 * kinds of counters on up to one other target creature.
 *
 * Scryfall keywords: Vigilance, Deathtouch (intrinsic from counters, stripped)
 */
describe('Aragorn, Company Leader', () => {
  const DB = CardEffectsDB['aragorn, company leader'];
  const CARD_DEF = {
    name: 'Aragorn, Company Leader',
    type_line: 'Legendary Creature — Human Ranger',
    mana_cost: '{1}{G}{W}',
    power: '3',
    toughness: '3',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Scryfall lists Vigilance/Deathtouch as keywords but card gets them via counters ──
  // DB should strip them so they aren't granted for free
  it('has remove_keywords for Vigilance and Deathtouch', () => {
    expect(DB.remove_keywords).toBeDefined();
    expect(DB.remove_keywords).toContain('Vigilance');
    expect(DB.remove_keywords).toContain('Deathtouch');
  });

  // ── Oracle: "Whenever the Ring tempts you" ──
  it('has ring_tempts trigger (not self-only)', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'ring_tempts');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false); // triggers on any ring tempt event
  });

  // ── Oracle: "if you chose a creature other than Aragorn as your Ring-bearer" ──
  it('ring_tempts has condition ring_bearer_not_self', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'ring_tempts');
    expect(trigger.condition).toBe('ring_bearer_not_self');
  });

  // ── Oracle: "put your choice of a counter from among first strike, vigilance,
  //    deathtouch, and lifelink on Aragorn" ──
  it('ring_tempts effect is modal_counter_self with exactly 4 counter options', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'ring_tempts');
    const effect = trigger.effects.find((e: any) => e.type === 'modal_counter_self');
    expect(effect).toBeDefined();
    expect(effect.counters).toEqual(expect.arrayContaining(['first strike', 'vigilance', 'deathtouch', 'lifelink']));
    expect(effect.counters.length).toBe(4);
  });

  // ── Oracle: "Whenever you put one or more counters on Aragorn" ──
  it('has counter_placed trigger (self: true)', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'counter_placed');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(true);
  });

  // ── Oracle: "put one of each of those kinds of counters on up to one other
  //    target creature" ──
  it('counter_placed copies counters to up to 1 other creature', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'counter_placed');
    const effect = trigger.effects.find((e: any) => e.type === 'copy_counters_to_target');
    expect(effect).toBeDefined();
    expect(effect.target).toBe('other_creature');
    expect(effect.up_to).toBe(1);
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

    it('ring_tempts trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('ring_tempts', { playerId: 0 });
      }).not.toThrow();
    });
  });
});
