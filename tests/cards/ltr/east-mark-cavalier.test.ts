import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * East-Mark Cavalier — {1}{W}
 * Creature — Human Knight (2/2)
 *
 * Vigilance
 * Whenever this creature deals damage to a Goblin or Orc, destroy that creature.
 *
 * IMPLEMENTED: deals_damage_to_creature event fired in combat.ts + target_is_goblin_or_orc condition.
 */
describe('East-Mark Cavalier', () => {
  const DB = CardEffectsDB['east-mark cavalier'];
  const CARD_DEF = {
    name: 'East-Mark Cavalier',
    type_line: 'Creature — Human Knight',
    mana_cost: '{1}{W}',
    power: '2',
    toughness: '2',
    keywords: ['Vigilance'],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Vigilance" ──
  it('has vigilance in static keywords', () => {
    const kw = DB.static?.find((s: any) => s.type === 'has_keyword');
    expect(kw).toBeDefined();
    expect(kw.keywords).toContain('vigilance');
  });

  // ── Oracle: "Whenever this creature deals damage to a Goblin or Orc, destroy that creature" ──
  it('has deals_damage_to_creature trigger (self)', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'deals_damage_to_creature');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(true);
  });

  it('trigger has target_is_goblin_or_orc condition', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'deals_damage_to_creature');
    expect(trigger.condition).toBe('target_is_goblin_or_orc');
  });

  it('trigger destroys damaged_creature', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'deals_damage_to_creature');
    const destroy = trigger.effects.find((e: any) => e.type === 'destroy');
    expect(destroy).toBeDefined();
    expect(destroy.target).toBe('damaged_creature');
  });

  // ── Stats: 2/2 ──
  it('is 2/2', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(2);
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
