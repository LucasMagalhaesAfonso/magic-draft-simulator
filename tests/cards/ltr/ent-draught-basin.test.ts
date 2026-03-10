import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Ent-Draught Basin — {2}
 * Artifact
 *
 * {X}, {T}: Put a +1/+1 counter on target creature with power X.
 * Activate only as a sorcery.
 *
 * IMPLEMENTED: target_condition power_equals_x restricts targeting to creatures with power = X paid.
 */
describe('Ent-Draught Basin', () => {
  const DB = CardEffectsDB['ent-draught basin'];
  const CARD_DEF = {
    name: 'Ent-Draught Basin',
    type_line: 'Artifact',
    mana_cost: '{2}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "{X}, {T}: Put a +1/+1 counter..." ──
  it('has activated ability with mana X + tap cost', () => {
    expect(DB.activated).toBeDefined();
    const ability = DB.activated[0];
    expect(ability.cost.mana).toBe('X');
    expect(ability.cost.tap).toBe(true);
  });

  // ── Oracle: "Activate only as a sorcery" ──
  it('activated ability is sorcery speed', () => {
    expect(DB.activated[0].sorcerySpeed).toBe(true);
  });

  // ── Oracle: "Put a +1/+1 counter on target creature with power X" ──
  it('effect puts +1/+1 counter on own creature with power_equals_x condition', () => {
    const effect = DB.activated[0].effects.find((e: any) => e.type === 'counter');
    expect(effect).toBeDefined();
    expect(effect.counter).toBe('+1/+1');
    expect(effect.amount).toBe(1);
    expect(effect.target).toBe('own_creature');
    expect(effect.target_condition).toBe('power_equals_x');
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
