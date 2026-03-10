import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Easterling Vanguard — {1}{B}
 * Creature — Human Warrior (2/1)
 *
 * When this creature dies, amass Orcs 1.
 */
describe('Easterling Vanguard', () => {
  const DB = CardEffectsDB['easterling vanguard'];
  const CARD_DEF = {
    name: 'Easterling Vanguard',
    type_line: 'Creature — Human Warrior',
    mana_cost: '{1}{B}',
    power: '2',
    toughness: '1',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "When this creature dies" ──
  it('has dies trigger (self)', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'dies');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(true);
  });

  // ── Oracle: "amass Orcs 1" ──
  it('dies trigger has amass 1 with subtype Orcs', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'dies');
    const amass = trigger.effects.find((e: any) => e.type === 'amass');
    expect(amass).toBeDefined();
    expect(amass.amount).toBe(1);
    expect(amass.subtype).toBe('Orcs');
  });

  // ── Stats: 2/1 ──
  it('is 2/1', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(2);
    expect(CardUtils.getToughness(card)).toBe(1);
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
