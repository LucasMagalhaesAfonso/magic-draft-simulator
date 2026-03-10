import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Book of Mazarbul — {2}{R}
 * Enchantment — Saga
 *
 * (As this Saga enters and after your draw step, add a lore counter.)
 * I — Amass Orcs 1.
 * II — Amass Orcs 2.
 * III — Creatures you control get +1/+0 and gain menace until end of turn.
 */
describe('Book of Mazarbul', () => {
  const DB = CardEffectsDB['book of mazarbul'];
  const CARD_DEF = {
    name: 'Book of Mazarbul',
    type_line: 'Enchantment — Saga',
    mana_cost: '{2}{R}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  it('is a saga', () => {
    expect(DB.saga).toBe(true);
  });

  it('has 3 chapters', () => {
    expect(DB.chapters).toBeDefined();
    expect(DB.chapters[1]).toBeDefined();
    expect(DB.chapters[2]).toBeDefined();
    expect(DB.chapters[3]).toBeDefined();
  });

  // ── Oracle: "I — Amass Orcs 1" ──
  it('chapter 1: amass 1 with subtype Orcs', () => {
    const ch1 = DB.chapters[1];
    const amass = ch1.find((e: any) => e.type === 'amass');
    expect(amass).toBeDefined();
    expect(amass.amount).toBe(1);
    expect(amass.subtype).toBe('Orcs');
  });

  // ── Oracle: "II — Amass Orcs 2" ──
  it('chapter 2: amass 2 with subtype Orcs', () => {
    const ch2 = DB.chapters[2];
    const amass = ch2.find((e: any) => e.type === 'amass');
    expect(amass).toBeDefined();
    expect(amass.amount).toBe(2);
    expect(amass.subtype).toBe('Orcs');
  });

  // ── Oracle: "III — Creatures you control get +1/+0 and gain menace until end of turn" ──
  it('chapter 3: buff_all own_creatures +1/+0 with menace eot', () => {
    const ch3 = DB.chapters[3];
    const buff = ch3.find((e: any) => e.type === 'buff_all');
    expect(buff).toBeDefined();
    expect(buff.power).toBe(1);
    expect(buff.toughness).toBe(0);
    expect(buff.target).toBe('own_creatures');
    expect(buff.duration).toBe('end_of_turn');
    expect(buff.keywords).toContain('menace');
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
