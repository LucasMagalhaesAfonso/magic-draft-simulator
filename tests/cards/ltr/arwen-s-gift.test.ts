import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Arwen's Gift — {3}{U}
 * Sorcery
 *
 * This spell costs {1} less to cast if you control two or more legendary creatures.
 * Scry 2, then draw two cards.
 */
describe("Arwen's Gift", () => {
  const DB = CardEffectsDB["arwen's gift"];
  const CARD_DEF = {
    name: "Arwen's Gift",
    type_line: 'Sorcery',
    mana_cost: '{3}{U}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "This spell costs {1} less to cast if you control two or more legendary creatures" ──
  it('has self_cost_reduction for controlling 2+ legendary creatures', () => {
    expect(DB.self_cost_reduction).toBeDefined();
    expect(DB.self_cost_reduction.condition).toBe('control_2_legendary');
    expect(DB.self_cost_reduction.amount).toBe(1);
  });

  // ── Oracle: "Scry 2, then draw two cards" ──
  it('cast effects are scry 2 then draw 2 (in order)', () => {
    expect(DB.cast).toBeDefined();
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[0].type).toBe('scry');
    expect(DB.cast[0].amount).toBe(2);
    expect(DB.cast[1].type).toBe('draw');
    expect(DB.cast[1].amount).toBe(2);
  });

  // ── Engine: draw resolves ──
  it('draw 2 resolves in engine', () => {
    const game = new TestGame();
    // Add cards to library so draw has something to pull
    for (let i = 0; i < 5; i++) {
      game.addToLibraryTop(0, { name: `Card ${i}`, type_line: 'Creature', power: '1', toughness: '1' });
    }
    const handBefore = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 2 });
    expect(game.hand(0).length).toBe(handBefore + 2);
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
