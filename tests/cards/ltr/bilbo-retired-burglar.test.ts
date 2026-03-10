import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Bilbo, Retired Burglar — {1}{U}{R}
 * Legendary Creature — Halfling Rogue (1/3)
 *
 * When Bilbo enters or leaves the battlefield, the Ring tempts you.
 * Whenever Bilbo deals combat damage to a player, create a Treasure token.
 */
describe('Bilbo, Retired Burglar', () => {
  const DB = CardEffectsDB['bilbo, retired burglar'];
  const CARD_DEF = {
    name: 'Bilbo, Retired Burglar',
    type_line: 'Legendary Creature — Halfling Rogue',
    mana_cost: '{1}{U}{R}',
    power: '1',
    toughness: '3',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "When Bilbo enters ... the Ring tempts you" ──
  it('ETB triggers ring_tempts', () => {
    expect(DB.etb).toBeDefined();
    const ringEffect = DB.etb.find((e: any) => e.type === 'ring_tempts');
    expect(ringEffect).toBeDefined();
  });

  // ── Oracle: "or leaves the battlefield, the Ring tempts you" ──
  it('has leaves_battlefield trigger (self: true) with ring_tempts', () => {
    expect(DB.triggered).toBeDefined();
    const leavesTrigger = DB.triggered.find((t: any) => t.event === 'leaves_battlefield');
    expect(leavesTrigger).toBeDefined();
    expect(leavesTrigger.self).toBe(true);
    const ringEffect = leavesTrigger.effects.find((e: any) => e.type === 'ring_tempts');
    expect(ringEffect).toBeDefined();
  });

  // ── Oracle: "Whenever Bilbo deals combat damage to a player, create a Treasure token" ──
  it('has combat_damage_player trigger (self: true) creating Treasure', () => {
    const combatTrigger = DB.triggered.find((t: any) => t.event === 'combat_damage_player');
    expect(combatTrigger).toBeDefined();
    expect(combatTrigger.self).toBe(true);
    const tokenEffect = combatTrigger.effects.find((e: any) => e.type === 'create_token');
    expect(tokenEffect).toBeDefined();
    expect(tokenEffect.name).toBe('Treasure');
    // "a Treasure token" = singular
    expect(tokenEffect.count === undefined || tokenEffect.count === 1).toBe(true);
  });

  // ── Stats: 1/3 ──
  it('is 1/3', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(1);
    expect(CardUtils.getToughness(card)).toBe(3);
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

    it('combat_damage_player trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('combat_damage_player', { cardUid: card._uid, playerId: 0 });
      }).not.toThrow();
    });
  });
});
