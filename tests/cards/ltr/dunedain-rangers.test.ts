import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Dúnedain Rangers — {3}{G}
 * Creature — Human Ranger (4/4)
 *
 * Landfall — Whenever a land you control enters, if you don't control a
 * Ring-bearer, the Ring tempts you.
 *
 * IMPLEMENTED: no_ring_bearer condition — trigger only fires when you don't control a Ring-bearer.
 */
describe('Dúnedain Rangers', () => {
  const DB = CardEffectsDB['dúnedain rangers'];
  const CARD_DEF = {
    name: 'Dúnedain Rangers',
    type_line: 'Creature — Human Ranger',
    mana_cost: '{3}{G}',
    power: '4',
    toughness: '4',
    keywords: ['Landfall'],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Landfall — Whenever a land you control enters" ──
  it('has landfall trigger', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'landfall');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  // ── Oracle: "if you don't control a Ring-bearer" ──
  it('landfall trigger has no_ring_bearer condition', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'landfall');
    expect(trigger.condition).toBe('no_ring_bearer');
  });

  // ── Oracle: "the Ring tempts you" ──
  it('landfall trigger has ring_tempts effect', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'landfall');
    const ring = trigger.effects.find((e: any) => e.type === 'ring_tempts');
    expect(ring).toBeDefined();
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

    it('landfall trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('landfall', { playerId: 0 });
      }).not.toThrow();
    });
  });
});
