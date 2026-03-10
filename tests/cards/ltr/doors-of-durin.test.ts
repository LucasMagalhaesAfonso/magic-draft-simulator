import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Doors of Durin — {3}{R}{G}
 * Legendary Artifact
 *
 * Whenever you attack, scry 2, then you may reveal the top card of your library.
 * If it's a creature card, put it onto the battlefield tapped and attacking.
 * Until your next turn, it gains trample if you control a Dwarf and hexproof
 * if you control an Elf.
 *
 * IMPLEMENTED: look_top creature_to_battlefield_attacking with Dwarf→trample, Elf→hexproof.
 */
describe('Doors of Durin', () => {
  const DB = CardEffectsDB['doors of durin'];
  const CARD_DEF = {
    name: 'Doors of Durin',
    type_line: 'Legendary Artifact',
    mana_cost: '{3}{R}{G}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever you attack" ──
  it('has attacks trigger (not self)', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  // ── Oracle: "reveal the top card ... if creature, put onto BF tapped and attacking" ──
  it('attacks trigger has look_top creature_to_battlefield_attacking', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    const lookTop = trigger.effects.find((e: any) => e.type === 'look_top');
    expect(lookTop).toBeDefined();
    expect(lookTop.condition).toBe('creature_to_battlefield_attacking');
    expect(lookTop.amount).toBe(1);
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

    it('attacks trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
      expect(() => {
        game.fireTrigger('attacks', { cardUid: card._uid, playerId: 0 });
      }).not.toThrow();
    });
  });
});
