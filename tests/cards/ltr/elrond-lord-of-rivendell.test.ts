import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Elrond, Lord of Rivendell — {2}{U}
 * Legendary Creature — Elf Noble (3/2)
 *
 * Whenever Elrond or another creature you control enters, scry 1.
 * If this is the second time this ability has resolved this turn,
 * the Ring tempts you.
 */
describe('Elrond, Lord of Rivendell', () => {
  const DB = CardEffectsDB['elrond, lord of rivendell'];
  const CARD_DEF = {
    name: 'Elrond, Lord of Rivendell',
    type_line: 'Legendary Creature — Elf Noble',
    mana_cost: '{2}{U}',
    power: '3',
    toughness: '2',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever Elrond or another creature you control enters" ──
  it('has enters_battlefield trigger (not self-only)', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'enters_battlefield');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  it('trigger has any_own_creature condition', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'enters_battlefield');
    expect(trigger.condition).toBe('any_own_creature');
  });

  // ── Oracle: "scry 1" ──
  it('trigger has scry 1 effect', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'enters_battlefield');
    const scry = trigger.effects.find((e: any) => e.type === 'scry');
    expect(scry).toBeDefined();
    expect(scry.amount).toBe(1);
  });

  // ── Oracle: "If this is the second time ... the Ring tempts you" ──
  it('trigger has ring_tempts with second_etb_this_turn condition', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'enters_battlefield');
    const ring = trigger.effects.find((e: any) => e.type === 'ring_tempts');
    expect(ring).toBeDefined();
    expect(ring.condition).toBe('second_etb_this_turn');
  });

  // ── Stats: 3/2 ──
  it('is 3/2', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(3);
    expect(CardUtils.getToughness(card)).toBe(2);
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
