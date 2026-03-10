import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Éomer, Marshal of Rohan — {2}{R}{R}
 * Legendary Creature — Human Knight (4/4)
 *
 * Haste
 * Whenever one or more other attacking legendary creatures you control die,
 * untap all creatures you control. After this phase, there is an additional
 * combat phase. This ability triggers only once each turn.
 *
 * IMPLEMENTED: attacking_legendary compound condition checks both legendary AND attacking.
 */
describe('Éomer, Marshal of Rohan', () => {
  const DB = CardEffectsDB['éomer, marshal of rohan'];
  const CARD_DEF = {
    name: 'Éomer, Marshal of Rohan',
    type_line: 'Legendary Creature — Human Knight',
    mana_cost: '{2}{R}{R}',
    power: '4',
    toughness: '4',
    keywords: ['Haste'],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Haste" ──
  it('has haste in static keywords', () => {
    const kw = DB.static?.find((s: any) => s.type === 'has_keyword');
    expect(kw).toBeDefined();
    expect(kw.keywords).toContain('haste');
  });

  // ── Oracle: "Whenever one or more other ... creatures you control die" ──
  it('has other_creature_dies trigger', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'other_creature_dies');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  // ── Oracle: "attacking legendary creatures" ──
  it('trigger has attacking_legendary condition', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'other_creature_dies');
    expect(trigger.condition).toBe('attacking_legendary');
  });

  // ── Oracle: "This ability triggers only once each turn" ──
  it('trigger is once_per_turn', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'other_creature_dies');
    expect(trigger.once_per_turn).toBe(true);
  });

  // ── Oracle: "untap all creatures you control" ──
  it('trigger has untap_all own_creatures effect', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'other_creature_dies');
    const untap = trigger.effects.find((e: any) => e.type === 'untap_all');
    expect(untap).toBeDefined();
    expect(untap.target).toBe('own_creatures');
  });

  // ── Oracle: "there is an additional combat phase" ──
  it('trigger has extra_combat effect', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'other_creature_dies');
    const extra = trigger.effects.find((e: any) => e.type === 'extra_combat');
    expect(extra).toBeDefined();
  });

  it('effects in order: untap_all then extra_combat', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'other_creature_dies');
    expect(trigger.effects.length).toBe(2);
    expect(trigger.effects[0].type).toBe('untap_all');
    expect(trigger.effects[1].type).toBe('extra_combat');
  });

  // ── Stats: 4/4 ──
  it('is 4/4', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(4);
    expect(CardUtils.getToughness(card)).toBe(4);
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
