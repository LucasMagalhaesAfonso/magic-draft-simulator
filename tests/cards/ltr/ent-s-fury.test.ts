import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Ent's Fury — {1}{G}
 * Sorcery
 *
 * Put a +1/+1 counter on target creature you control if its power is 4 or
 * greater. Then that creature gets +1/+1 until end of turn and fights target
 * creature you don't control.
 *
 * IMPLEMENTED: counter has condition power_4_or_greater — only applied if creature power >= 4.
 */
describe("Ent's Fury", () => {
  const DB = CardEffectsDB["ent's fury"];
  const CARD_DEF = {
    name: "Ent's Fury",
    type_line: 'Sorcery',
    mana_cost: '{1}{G}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Put a +1/+1 counter if power 4+" ──
  it('cast has counter_self +1/+1 targeting own_creature with power_4_or_greater condition', () => {
    expect(DB.cast).toBeDefined();
    const counter = DB.cast.find((e: any) => e.type === 'counter_self');
    expect(counter).toBeDefined();
    expect(counter.counter).toBe('+1/+1');
    expect(counter.amount).toBe(1);
    expect(counter.target).toBe('own_creature');
    expect(counter.condition).toBe('power_4_or_greater');
  });

  // ── Oracle: "fights target creature you don't control" ──
  it('cast has fight targeting own_creature_vs_opponent', () => {
    const fight = DB.cast.find((e: any) => e.type === 'fight');
    expect(fight).toBeDefined();
    expect(fight.target).toBe('own_creature_vs_opponent');
  });

  it('effects in order: counter then fight', () => {
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[0].type).toBe('counter_self');
    expect(DB.cast[1].type).toBe('fight');
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
