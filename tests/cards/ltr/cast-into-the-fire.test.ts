import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Cast into the Fire — {1}{R}
 * Instant
 *
 * Choose one —
 * • Cast into the Fire deals 1 damage to each of up to two target creatures.
 * • Exile target artifact.
 */
describe('Cast into the Fire', () => {
  const DB = CardEffectsDB['cast into the fire'];
  const CARD_DEF = {
    name: 'Cast into the Fire',
    type_line: 'Instant',
    mana_cost: '{1}{R}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Choose one" → modal ──
  it('cast is modal with 2 modes', () => {
    expect(DB.cast).toBeDefined();
    const modal = DB.cast.find((e: any) => e.type === 'modal');
    expect(modal).toBeDefined();
    expect(modal.modes).toBeDefined();
    expect(modal.modes.length).toBe(2);
  });

  // ── Oracle mode 1: "deals 1 damage to each of up to two target creatures" ──
  it('mode 1: 1 damage to creature, up to 2 targets', () => {
    const modal = DB.cast.find((e: any) => e.type === 'modal');
    const mode1 = modal.modes[0];
    const dmg = mode1.find((e: any) => e.type === 'damage');
    expect(dmg).toBeDefined();
    expect(dmg.amount).toBe(1);
    expect(dmg.target).toBe('creature');
    expect(dmg.up_to).toBe(2);
  });

  // ── Oracle mode 2: "Exile target artifact" ──
  it('mode 2: exile target artifact', () => {
    const modal = DB.cast.find((e: any) => e.type === 'modal');
    const mode2 = modal.modes[1];
    const exile = mode2.find((e: any) => e.type === 'exile');
    expect(exile).toBeDefined();
    expect(exile.target).toBe('artifact');
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
