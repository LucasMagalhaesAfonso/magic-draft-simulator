import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Arwen Undómiel — {G}{U}
 * Legendary Creature — Elf Noble (2/2)
 *
 * Whenever you scry, put a +1/+1 counter on target creature.
 * {4}{G}{U}: Scry 2.
 */
describe('Arwen Undómiel', () => {
  const DB = CardEffectsDB['arwen undómiel'];
  const CARD_DEF = {
    name: 'Arwen Undómiel',
    type_line: 'Legendary Creature — Elf Noble',
    mana_cost: '{G}{U}',
    power: '2',
    toughness: '2',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever you scry, put a +1/+1 counter on target creature" ──
  it('has scry trigger (self: false)', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  it('scry trigger puts +1/+1 counter on target creature', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    const effect = trigger.effects.find((e: any) => e.type === 'counter');
    expect(effect).toBeDefined();
    expect(effect.counter).toBe('+1/+1');
    expect(effect.amount).toBe(1);
    expect(effect.target).toBe('creature');
  });

  // ── Oracle: "{4}{G}{U}: Scry 2" ──
  it('has activated ability costing {4}{G}{U} for scry 2', () => {
    expect(DB.activated).toBeDefined();
    expect(DB.activated.length).toBeGreaterThanOrEqual(1);
    const ability = DB.activated[0];
    expect(ability.cost.mana).toBe('4GU');
    const scryEffect = ability.effects.find((e: any) => e.type === 'scry');
    expect(scryEffect).toBeDefined();
    expect(scryEffect.amount).toBe(2);
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
