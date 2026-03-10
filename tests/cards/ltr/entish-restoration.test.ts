import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Entish Restoration — {2}{G}
 * Instant
 *
 * Sacrifice a land. Search your library for up to two basic land cards,
 * put them onto the battlefield tapped, then shuffle. If you control a
 * creature with power 4 or greater, instead search for up to three.
 *
 * IMPLEMENTED: sacrifice land cost + conditional 3rd land if power 4+ creature.
 */
describe('Entish Restoration', () => {
  const DB = CardEffectsDB['entish restoration'];
  const CARD_DEF = {
    name: 'Entish Restoration',
    type_line: 'Instant',
    mana_cost: '{2}{G}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle (simplified): "Search for up to two basic land cards, tapped" ──
  it('cast has ramp 2 tapped', () => {
    expect(DB.cast).toBeDefined();
    const ramp = DB.cast.find((e: any) => e.type === 'ramp');
    expect(ramp).toBeDefined();
    expect(ramp.amount).toBe(2);
    expect(ramp.tapped).toBe(true);
  });

  it('has additional_costs with sacrifice land', () => {
    expect(DB.additional_costs).toBeDefined();
    expect(DB.additional_costs[0].type).toBe('sacrifice');
    expect(DB.additional_costs[0].target).toBe('land');
  });

  it('cast has 2 effects: ramp 2 + conditional ramp 1', () => {
    expect(DB.cast.length).toBe(2);
    expect(DB.cast[1].type).toBe('ramp');
    expect(DB.cast[1].amount).toBe(1);
    expect(DB.cast[1].condition).toBe('control_power_4_creature');
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
