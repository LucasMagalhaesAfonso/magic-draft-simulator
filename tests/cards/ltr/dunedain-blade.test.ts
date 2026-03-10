import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Dúnedain Blade — {1}{W}
 * Artifact — Equipment
 *
 * Equipped creature gets +2/+1.
 * Equip Human {1}
 * Equip {3}
 */
describe('Dúnedain Blade', () => {
  const DB = CardEffectsDB['dúnedain blade'];
  const CARD_DEF = {
    name: 'Dúnedain Blade',
    type_line: 'Artifact — Equipment',
    mana_cost: '{1}{W}',
    keywords: ['Equip'],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Equipped creature gets +2/+1" ──
  it('equip grants +2/+1', () => {
    expect(DB.equip).toBeDefined();
    expect(DB.equip.power).toBe(2);
    expect(DB.equip.toughness).toBe(1);
  });

  // ── Oracle: "Equip {3}" ──
  it('equip cost is 3', () => {
    expect(DB.equip.cost).toBe(3);
  });

  // ── Oracle: "Equip Human {1}" ──
  it('equip Human cost is 1', () => {
    expect(DB.equip.equip_human).toBe(1);
  });

  // ── Equipment + creature interaction ──
  it('equipped creature gets +2/+1', () => {
    const game = new TestGame();
    const creature = game.addToBattlefield(0, {
      name: 'Test Creature',
      type_line: 'Creature — Human',
      power: '2',
      toughness: '2',
    });
    const equip = game.addToBattlefield(0, CARD_DEF);
    game.setMana(0, { C: 5 });
    game.equip(equip._uid, creature._uid);
    expect(CardUtils.getPower(creature)).toBe(4);
    expect(CardUtils.getToughness(creature)).toBe(3);
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
