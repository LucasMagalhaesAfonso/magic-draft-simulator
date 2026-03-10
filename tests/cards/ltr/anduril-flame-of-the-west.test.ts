import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Andúril, Flame of the West — {3}
 * Legendary Artifact — Equipment
 *
 * Equipped creature gets +3/+1.
 * Whenever equipped creature attacks, create two tapped 1/1 white Spirit
 * creature tokens with flying. If that creature is legendary, instead create
 * two of those tokens that are tapped and attacking.
 * Equip {2}
 */
describe('Andúril, Flame of the West', () => {
  const DB = CardEffectsDB['andúril, flame of the west'];
  const CARD_DEF = {
    name: 'Andúril, Flame of the West',
    type_line: 'Legendary Artifact — Equipment',
    mana_cost: '{3}',
    keywords: ['Equip'],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Equipped creature gets +3/+1" ──
  it('equip grants +3/+1', () => {
    expect(DB.equip).toBeDefined();
    expect(DB.equip.power).toBe(3);
    expect(DB.equip.toughness).toBe(1);
  });

  // ── Oracle: "Equip {2}" ──
  it('equip cost is {2}', () => {
    expect(DB.equip.cost).toBe(2);
  });

  // ── Oracle: "Whenever equipped creature attacks" ──
  it('has attacks trigger with condition equipped_creature, self: false', () => {
    expect(DB.triggered).toBeDefined();
    expect(DB.triggered.length).toBeGreaterThanOrEqual(1);
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    expect(trigger).toBeDefined();
    expect(trigger.condition).toBe('equipped_creature');
    expect(trigger.self).toBe(false);
  });

  // ── Oracle: "create two tapped 1/1 white Spirit creature tokens with flying" ──
  it('attack trigger creates 2 tapped 1/1 white Spirit tokens with flying', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    expect(trigger.effects).toBeDefined();
    expect(trigger.effects.length).toBeGreaterThanOrEqual(1);
    const tokenEffect = trigger.effects.find((e: any) => e.type === 'create_token');
    expect(tokenEffect).toBeDefined();
    expect(tokenEffect.count).toBe(2);
    expect(tokenEffect.power).toBe(1);
    expect(tokenEffect.toughness).toBe(1);
    expect(tokenEffect.name).toBe('Spirit');
    expect(tokenEffect.type_line).toBe('Creature — Spirit');
    expect(tokenEffect.colors).toContain('W');
    expect(tokenEffect.keywords).toContain('flying');
    expect(tokenEffect.tapped).toBe(true);
  });

  // ── Oracle: "If that creature is legendary, instead create two of those tokens
  //    that are tapped and attacking" ──
  it('tokens are attacking if equipped creature is legendary', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    const tokenEffect = trigger.effects.find((e: any) => e.type === 'create_token');
    expect(tokenEffect.attacking_if_legendary).toBe(true);
  });

  // ── Engine: equip actually modifies P/T ──
  it('equipping a creature grants +3/+1 in engine', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, CARD_DEF);
    const creature = game.addToBattlefield(0, {
      name: 'Soldier', type_line: 'Creature — Human', power: '2', toughness: '2',
    });
    game.setMana(0, { C: 5 });
    game.equip(equip._uid, creature._uid);
    expect(CardUtils.getPower(creature)).toBe(5);   // 2 + 3
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
      expect(CardUtils.getPower(creature)).toBe(4);  // 1 + 3
      expect(CardUtils.getToughness(creature)).toBe(2); // 1 + 1
    });
  });

  // ── AI interaction ──
  describe('AI player', () => {
    it('can cast from hand without crash', () => {
      const game = new TestGame();
      const { result } = game.castFromHand(0, CARD_DEF);
      expect(result).not.toBe(false);
    });

    it('can equip a creature without crash', () => {
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
