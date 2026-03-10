import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Aragorn, the Uniter — {R}{G}{W}{U}
 * Legendary Creature — Human Noble (5/5)
 *
 * Whenever you cast a white spell, create a 1/1 white Human Soldier creature token.
 * Whenever you cast a blue spell, scry 2.
 * Whenever you cast a red spell, Aragorn deals 3 damage to target opponent.
 * Whenever you cast a green spell, target creature gets +4/+4 until end of turn.
 */
describe('Aragorn, the Uniter', () => {
  const DB = CardEffectsDB['aragorn, the uniter'];
  const CARD_DEF = {
    name: 'Aragorn, the Uniter',
    type_line: 'Legendary Creature — Human Noble',
    mana_cost: '{R}{G}{W}{U}',
    power: '5',
    toughness: '5',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  it('has exactly 4 cast_spell triggers', () => {
    expect(DB.triggered).toBeDefined();
    const castTriggers = DB.triggered.filter((t: any) => t.event === 'cast_spell');
    expect(castTriggers.length).toBe(4);
  });

  it('all triggers are self: false', () => {
    DB.triggered.forEach((t: any) => {
      expect(t.self).toBe(false);
    });
  });

  // ── Oracle: "Whenever you cast a white spell, create a 1/1 white Human Soldier creature token" ──
  it('white spell → create 1/1 white Human Soldier token', () => {
    const trigger = DB.triggered.find((t: any) => t.condition === 'cast_white_spell');
    expect(trigger).toBeDefined();
    const effect = trigger.effects.find((e: any) => e.type === 'create_token');
    expect(effect).toBeDefined();
    expect(effect.power).toBe(1);
    expect(effect.toughness).toBe(1);
    expect(effect.colors).toContain('W');
    expect(effect.name).toBe('Human Soldier');
    expect(effect.type_line).toBe('Creature — Human Soldier');
    // Oracle says "a" (singular) — count must be 1 or undefined (engine defaults to 1)
    expect(effect.count === undefined || effect.count === 1).toBe(true);
  });

  // ── Oracle: "Whenever you cast a blue spell, scry 2" ──
  it('blue spell → scry 2', () => {
    const trigger = DB.triggered.find((t: any) => t.condition === 'cast_blue_spell');
    expect(trigger).toBeDefined();
    const effect = trigger.effects.find((e: any) => e.type === 'scry');
    expect(effect).toBeDefined();
    expect(effect.amount).toBe(2);
  });

  // ── Oracle: "Whenever you cast a red spell, Aragorn deals 3 damage to target opponent" ──
  it('red spell → 3 damage to target opponent', () => {
    const trigger = DB.triggered.find((t: any) => t.condition === 'cast_red_spell');
    expect(trigger).toBeDefined();
    const effect = trigger.effects.find((e: any) => e.type === 'damage');
    expect(effect).toBeDefined();
    expect(effect.amount).toBe(3);
    expect(effect.target).toBe('opponent');
  });

  // ── Oracle: "Whenever you cast a green spell, target creature gets +4/+4 until end of turn" ──
  it('green spell → target creature gets +4/+4 until end of turn', () => {
    const trigger = DB.triggered.find((t: any) => t.condition === 'cast_green_spell');
    expect(trigger).toBeDefined();
    const effect = trigger.effects.find((e: any) => e.type === 'buff');
    expect(effect).toBeDefined();
    expect(effect.power).toBe(4);
    expect(effect.toughness).toBe(4);
    expect(effect.target).toBe('creature');
    expect(effect.duration).toBe('end_of_turn');
  });

  // ── Stats: 5/5 ──
  it('is 5/5', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(5);
    expect(CardUtils.getToughness(card)).toBe(5);
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

    it('red trigger resolves (damage) without crash', () => {
      const game = new TestGame();
      game.resolveEffect(0, { type: 'damage', amount: 3, target: 'opponent' });
      expect(game.life(1)).toBe(17);
    });
  });
});
