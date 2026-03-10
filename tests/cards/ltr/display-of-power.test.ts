import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Display of Power — {1}{R}{R}
 * Instant
 *
 * This spell can't be copied.
 * Copy any number of target instant and/or sorcery spells. You may choose
 * new targets for the copies.
 *
 * IMPLEMENTED: _cantBeCopied flag + multi:true on copy_spell.
 */
describe('Display of Power', () => {
  const DB = CardEffectsDB['display of power'];
  const CARD_DEF = {
    name: 'Display of Power',
    type_line: 'Instant',
    mana_cost: '{1}{R}{R}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Copy any number of target instant and/or sorcery spells" ──
  it('cast has copy_spell effect with multi flag', () => {
    expect(DB.cast).toBeDefined();
    const copy = DB.cast.find((e: any) => e.type === 'copy_spell');
    expect(copy).toBeDefined();
    expect(copy.multi).toBe(true);
  });

  // ── Oracle: "This spell can't be copied" ──
  it('has _cantBeCopied flag', () => {
    expect(DB._cantBeCopied).toBe(true);
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
