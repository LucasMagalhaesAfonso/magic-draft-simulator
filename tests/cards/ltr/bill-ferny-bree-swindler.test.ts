import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Bill Ferny, Bree Swindler — {1}{U}
 * Legendary Creature — Human Rogue (2/1)
 *
 * Whenever Bill Ferny becomes blocked, choose one —
 * • Create a Treasure token.
 * • Target opponent gains control of target Horse you control. If they do,
 *   remove Bill Ferny from combat and create three Treasure tokens.
 */
describe('Bill Ferny, Bree Swindler', () => {
  const DB = CardEffectsDB['bill ferny, bree swindler'];
  const CARD_DEF = {
    name: 'Bill Ferny, Bree Swindler',
    type_line: 'Legendary Creature — Human Rogue',
    mana_cost: '{1}{U}',
    power: '2',
    toughness: '1',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever Bill Ferny becomes blocked" ──
  it('has becomes_blocked trigger with self: true', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'becomes_blocked');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(true);
  });

  // ── Oracle: "choose one" → modal with exactly 2 modes ──
  it('becomes_blocked trigger is modal with 2 modes', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'becomes_blocked');
    const modalEffect = trigger.effects.find((e: any) => e.type === 'modal');
    expect(modalEffect).toBeDefined();
    expect(modalEffect.modes).toBeDefined();
    expect(modalEffect.modes.length).toBe(2);
  });

  // ── Oracle: Mode 1: "Create a Treasure token" ──
  it('mode 1: create 1 Treasure token', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'becomes_blocked');
    const modalEffect = trigger.effects.find((e: any) => e.type === 'modal');
    const mode1 = modalEffect.modes[0];
    const treasureEffect = mode1.find((e: any) => e.type === 'create_token' && e.name === 'Treasure');
    expect(treasureEffect).toBeDefined();
    // "a Treasure token" = 1, no count or count 1
    expect(treasureEffect.count === undefined || treasureEffect.count === 1).toBe(true);
  });

  // ── Oracle: Mode 2: "Target opponent gains control of target Horse you control" ──
  it('mode 2: gain_control of own_horse given to opponent', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'becomes_blocked');
    const modalEffect = trigger.effects.find((e: any) => e.type === 'modal');
    const mode2 = modalEffect.modes[1];
    const gainControl = mode2.find((e: any) => e.type === 'gain_control');
    expect(gainControl).toBeDefined();
    expect(gainControl.target).toBe('own_horse');
    expect(gainControl.give_to).toBe('opponent');
  });

  // ── Oracle: Mode 2: "remove Bill Ferny from combat" ──
  it('mode 2: remove_from_combat self', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'becomes_blocked');
    const modalEffect = trigger.effects.find((e: any) => e.type === 'modal');
    const mode2 = modalEffect.modes[1];
    const removeCombat = mode2.find((e: any) => e.type === 'remove_from_combat');
    expect(removeCombat).toBeDefined();
    expect(removeCombat.target).toBe('self');
  });

  // ── Oracle: Mode 2: "create three Treasure tokens" ──
  it('mode 2: create 3 Treasure tokens', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'becomes_blocked');
    const modalEffect = trigger.effects.find((e: any) => e.type === 'modal');
    const mode2 = modalEffect.modes[1];
    const treasureEffect = mode2.find((e: any) => e.type === 'create_token' && e.name === 'Treasure');
    expect(treasureEffect).toBeDefined();
    expect(treasureEffect.count).toBe(3);
  });

  // ── Stats: 2/1 ──
  it('is 2/1', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(2);
    expect(CardUtils.getToughness(card)).toBe(1);
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

    it('becomes_blocked trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      expect(() => {
        game.fireTrigger('becomes_blocked', { cardUid: card._uid, playerId: 0 });
      }).not.toThrow();
    });
  });
});
