import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { _registerCardTriggers } from '../../../src/engine/game-state';

/**
 * Denethor, Ruling Steward — {1}{W}{B}
 * Legendary Creature — Human Noble (2/4)
 *
 * At the beginning of your end step, if a creature died under your control
 * this turn, create a 1/1 white Human Soldier creature token.
 * {2}, Sacrifice another creature: Each opponent loses 1 life and you gain 1 life.
 */
describe('Denethor, Ruling Steward', () => {
  const DB = CardEffectsDB['denethor, ruling steward'];
  const CARD_DEF = {
    name: 'Denethor, Ruling Steward',
    type_line: 'Legendary Creature — Human Noble',
    mana_cost: '{1}{W}{B}',
    power: '2',
    toughness: '4',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "At the beginning of your end step" ──
  it('has end_step trigger', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'end_step');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
  });

  // ── Oracle: "if a creature died under your control this turn" ──
  it('end_step trigger has creature_died_this_turn condition', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'end_step');
    expect(trigger.condition).toBe('creature_died_this_turn');
  });

  // ── Oracle: "create a 1/1 white Human Soldier creature token" ──
  it('end_step creates 1/1 Human Soldier token', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'end_step');
    const token = trigger.effects.find((e: any) => e.type === 'create_token');
    expect(token).toBeDefined();
    expect(token.power).toBe(1);
    expect(token.toughness).toBe(1);
    expect(token.name).toBe('Human Soldier');
    expect(token.colors).toContain('W');
  });

  // ── Oracle: "{2}, Sacrifice another creature: Each opponent loses 1 life and you gain 1 life" ──
  it('has activated ability with mana 2 + sacrifice creature cost', () => {
    expect(DB.activated).toBeDefined();
    const ability = DB.activated[0];
    expect(ability.cost.mana).toBe('2');
    expect(ability.cost.sacrifice).toBe('creature');
  });

  it('activated ability drains 1', () => {
    const ability = DB.activated[0];
    const drain = ability.effects.find((e: any) => e.type === 'drain');
    expect(drain).toBeDefined();
    expect(drain.amount).toBe(1);
  });

  // ── Stats: 2/4 ──
  it('is 2/4', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(2);
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

    it('end_step trigger fires without crash', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, CARD_DEF);
      _registerCardTriggers(game.state, card, 0);
      game.state._creatureDiedThisTurn = { 0: true };
      expect(() => {
        game.fireTrigger('end_step', { playerId: 0 });
      }).not.toThrow();
    });
  });
});
