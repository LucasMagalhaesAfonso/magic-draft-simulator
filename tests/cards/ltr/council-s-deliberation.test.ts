import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Council's Deliberation — {1}{U}
 * Instant
 *
 * Draw a card.
 * Whenever you scry, if you control an Island, you may exile this card from
 * your graveyard. If you do, draw a card.
 *
 * IMPLEMENTED: in_graveyard_with_island condition, exile_self effect, optional flag.
 */
describe("Council's Deliberation", () => {
  const DB = CardEffectsDB["council's deliberation"];
  const CARD_DEF = {
    name: "Council's Deliberation",
    type_line: 'Instant',
    mana_cost: '{1}{U}',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Draw a card" ──
  it('cast draws 1 card', () => {
    expect(DB.cast).toBeDefined();
    const draw = DB.cast.find((e: any) => e.type === 'draw');
    expect(draw).toBeDefined();
    expect(draw.amount).toBe(1);
  });

  // ── Oracle: "Whenever you scry ... draw a card" (graveyard ability) ──
  it('has scry trigger with condition in_graveyard_with_island', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(trigger).toBeDefined();
    expect(trigger.condition).toBe('in_graveyard_with_island');
  });

  it('scry trigger is optional', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    expect(trigger.optional).toBe(true);
  });

  it('scry trigger exiles self then draws', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'scry');
    const exile = trigger.effects.find((e: any) => e.type === 'exile_self');
    expect(exile).toBeDefined();
    const draw = trigger.effects.find((e: any) => e.type === 'draw');
    expect(draw).toBeDefined();
    expect(draw.amount).toBe(1);
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
