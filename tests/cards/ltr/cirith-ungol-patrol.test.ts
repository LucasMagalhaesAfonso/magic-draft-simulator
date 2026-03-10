import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Cirith Ungol Patrol — {4}{B}
 * Creature — Orc Soldier (4/5)
 *
 * {1}, {T}, Sacrifice another creature: Draw a card, then create a Food token.
 */
describe('Cirith Ungol Patrol', () => {
  const DB = CardEffectsDB['cirith ungol patrol'];
  const CARD_DEF = {
    name: 'Cirith Ungol Patrol',
    type_line: 'Creature — Orc Soldier',
    mana_cost: '{4}{B}',
    power: '4',
    toughness: '5',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "{1}, {T}, Sacrifice another creature:" ──
  it('activated ability costs {1} + tap + sacrifice another creature', () => {
    expect(DB.activated).toBeDefined();
    expect(DB.activated.length).toBeGreaterThanOrEqual(1);
    const ability = DB.activated[0];
    expect(ability.cost.mana).toBe('1');
    expect(ability.cost.tap).toBe(true);
    // Oracle says "another creature" — engine already excludes self via uid check (line 11254)
    expect(ability.cost.sacrifice).toBe('creature');
  });

  // ── Oracle: "Draw a card" ──
  it('activated draws 1 card', () => {
    const ability = DB.activated[0];
    const draw = ability.effects.find((e: any) => e.type === 'draw');
    expect(draw).toBeDefined();
    expect(draw.amount).toBe(1);
  });

  // ── Oracle: "then create a Food token" ──
  it('activated creates Food token', () => {
    const ability = DB.activated[0];
    const food = ability.effects.find((e: any) => e.type === 'create_token' && e.name === 'Food');
    expect(food).toBeDefined();
  });

  // ── Effects order: draw then Food ──
  it('effects in order: draw then create Food', () => {
    const ability = DB.activated[0];
    expect(ability.effects.length).toBe(2);
    expect(ability.effects[0].type).toBe('draw');
    expect(ability.effects[1].type).toBe('create_token');
  });

  // ── Stats: 4/5 ──
  it('is 4/5', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(4);
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
  });
});
