import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Elven Chorus — {3}{G}
 * Enchantment
 *
 * You may look at the top card of your library any time.
 * You may cast creature spells from the top of your library.
 * Creatures you control have "{T}: Add one mana of any color."
 *
 * IMPLEMENTED: creatures_tap_for_mana + cast_from_library_top (creature filter).
 */
describe('Elven Chorus', () => {
  const DB = CardEffectsDB['elven chorus'];
  const CARD_DEF = {
    name: 'Elven Chorus',
    type_line: 'Enchantment',
    mana_cost: '{3}{G}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Creatures you control have '{T}: Add one mana of any color'" ──
  it('has creatures_tap_for_mana static ability', () => {
    expect(DB.static).toBeDefined();
    const tapMana = DB.static.find((s: any) => s.type === 'creatures_tap_for_mana');
    expect(tapMana).toBeDefined();
  });

  // ── Oracle: "You may cast creature spells from the top of your library" ──
  it('has cast_from_library_top static with creature filter', () => {
    const castTop = DB.static.find((s: any) => s.type === 'cast_from_library_top');
    expect(castTop).toBeDefined();
    expect(castTop.filter).toBe('creature');
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
