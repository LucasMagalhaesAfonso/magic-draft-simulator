import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Bewitching Leechcraft — {1}{U}
 * Enchantment — Aura
 *
 * Enchant creature.
 * When this Aura enters, tap enchanted creature.
 * Enchanted creature has "If this creature would untap during your untap step,
 * remove a +1/+1 counter from it instead. If you do, untap it."
 */
describe('Bewitching Leechcraft', () => {
  const DB = CardEffectsDB['bewitching leechcraft'];
  const CARD_DEF = {
    name: 'Bewitching Leechcraft',
    type_line: 'Enchantment — Aura',
    mana_cost: '{1}{U}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: Aura — no P/T debuff (power:0, toughness:0 means no stat change) ──
  it('aura_debuff has 0/0 (no stat change)', () => {
    expect(DB.aura_debuff).toBeDefined();
    expect(DB.aura_debuff.power).toBe(0);
    expect(DB.aura_debuff.toughness).toBe(0);
  });

  // ── Oracle: "When this Aura enters, tap enchanted creature" ──
  it('ETB taps enchanted creature', () => {
    expect(DB.etb).toBeDefined();
    const tapEffect = DB.etb.find((e: any) => e.type === 'tap');
    expect(tapEffect).toBeDefined();
    expect(tapEffect.target).toBe('enchanted_creature');
  });

  // ── Oracle: "If this creature would untap during your untap step,
  //    remove a +1/+1 counter from it instead" ──
  it('has static aura_untap_remove_counter', () => {
    expect(DB.static).toBeDefined();
    const staticAbility = DB.static.find((s: any) => s.type === 'aura_untap_remove_counter');
    expect(staticAbility).toBeDefined();
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
