import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Deceive the Messenger — {U}
 * Instant
 *
 * Target creature gets -3/-0 until end of turn. Amass Orcs 1.
 */
describe('Deceive the Messenger', () => {
  const DB = CardEffectsDB['deceive the messenger'];
  const CARD_DEF = {
    name: 'Deceive the Messenger',
    type_line: 'Instant',
    mana_cost: '{U}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Target creature gets -3/-0 until end of turn" ──
  it('cast debuffs creature -3/-0 until end of turn', () => {
    expect(DB.cast).toBeDefined();
    const debuff = DB.cast.find((e: any) => e.type === 'debuff');
    expect(debuff).toBeDefined();
    expect(debuff.power).toBe(-3);
    expect(debuff.toughness).toBe(0);
    expect(debuff.target).toBe('creature');
    expect(debuff.duration).toBe('end_of_turn');
  });

  // ── Oracle: "Amass Orcs 1" ──
  it('cast includes amass 1 with subtype Orcs', () => {
    const amass = DB.cast.find((e: any) => e.type === 'amass');
    expect(amass).toBeDefined();
    expect(amass.amount).toBe(1);
    expect(amass.subtype).toBe('Orcs');
  });

  it('effects in order: debuff then amass', () => {
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[0].type).toBe('debuff');
    expect(DB.cast[1].type).toBe('amass');
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
