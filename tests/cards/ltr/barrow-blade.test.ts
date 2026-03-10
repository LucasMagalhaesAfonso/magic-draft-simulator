import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Barrow-Blade — {1}
 * Artifact — Equipment
 *
 * Equipped creature gets +1/+1.
 * Whenever equipped creature blocks or becomes blocked by a creature,
 * that creature loses all abilities until end of turn.
 * Equip {1}
 */
describe('Barrow-Blade', () => {
  const DB = CardEffectsDB['barrow-blade'];
  const CARD_DEF = {
    name: 'Barrow-Blade',
    type_line: 'Artifact — Equipment',
    mana_cost: '{1}',
    keywords: ['Equip'],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Equipped creature gets +1/+1" ──
  it('equip grants +1/+1', () => {
    expect(DB.equip).toBeDefined();
    expect(DB.equip.power).toBe(1);
    expect(DB.equip.toughness).toBe(1);
  });

  // ── Oracle: "Equip {1}" ──
  it('equip cost is 1', () => {
    expect(DB.equip.cost).toBe(1);
  });

  // ── Oracle: "Whenever equipped creature blocks ... a creature, that creature
  //    loses all abilities until end of turn" ──
  it('has equipped_blocks trigger that removes abilities from blocked creature', () => {
    expect(DB.triggered).toBeDefined();
    const blocksTrigger = DB.triggered.find((t: any) => t.event === 'equipped_blocks');
    expect(blocksTrigger).toBeDefined();
    expect(blocksTrigger.self).toBe(false);
    const effect = blocksTrigger.effects.find((e: any) => e.type === 'lose_all_abilities');
    expect(effect).toBeDefined();
    expect(effect.target).toBe('blocked_creature');
    expect(effect.duration).toBe('end_of_turn');
  });

  // ── Oracle: "or becomes blocked by a creature, that creature loses all abilities
  //    until end of turn" ──
  it('has equipped_blocked_by trigger that removes abilities from blocking creature', () => {
    const blockedByTrigger = DB.triggered.find((t: any) => t.event === 'equipped_blocked_by');
    expect(blockedByTrigger).toBeDefined();
    expect(blockedByTrigger.self).toBe(false);
    const effect = blockedByTrigger.effects.find((e: any) => e.type === 'lose_all_abilities');
    expect(effect).toBeDefined();
    expect(effect.target).toBe('blocking_creature');
    expect(effect.duration).toBe('end_of_turn');
  });

  // ── Engine: equip modifies P/T ──
  it('equipping a creature grants +1/+1 in engine', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, CARD_DEF);
    const creature = game.addToBattlefield(0, {
      name: 'Soldier', type_line: 'Creature — Human', power: '2', toughness: '2',
    });
    game.setMana(0, { C: 5 });
    game.equip(equip._uid, creature._uid);
    expect(CardUtils.getPower(creature)).toBe(3);   // 2 + 1
    expect(CardUtils.getToughness(creature)).toBe(3); // 2 + 1
  });

  // ── Human interaction ──
  describe('Human player', () => {
    it('can cast from hand', () => {
      const game = new TestGame();
      game.setHuman(0, true);
      const { result } = game.castFromHand(0, CARD_DEF);
      expect(result).not.toBe(false);
    });

    it('can equip a creature', () => {
      const game = new TestGame();
      game.setHuman(0, true);
      const equip = game.addToBattlefield(0, CARD_DEF);
      const creature = game.addToBattlefield(0, {
        name: 'Soldier', type_line: 'Creature — Human', power: '1', toughness: '1',
      });
      game.setMana(0, { C: 5 });
      const result = game.equip(equip._uid, creature._uid);
      expect(result).not.toBe(false);
      expect(CardUtils.getPower(creature)).toBe(2);
      expect(CardUtils.getToughness(creature)).toBe(2);
    });
  });

  // ── AI interaction ──
  describe('AI player', () => {
    it('can cast from hand without crash', () => {
      const game = new TestGame();
      const { result } = game.castFromHand(0, CARD_DEF);
      expect(result).not.toBe(false);
    });

    it('can equip without crash', () => {
      const game = new TestGame();
      const equip = game.addToBattlefield(0, CARD_DEF);
      const creature = game.addToBattlefield(0, {
        name: 'Soldier', type_line: 'Creature — Human', power: '1', toughness: '1',
      });
      game.setMana(0, { C: 5 });
      expect(() => game.equip(equip._uid, creature._uid)).not.toThrow();
    });
  });
});
