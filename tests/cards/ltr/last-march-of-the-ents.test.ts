import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Last March of the Ents — {5}{G}{G}{G}
 * Sorcery
 *
 * This spell can't be countered.
 * Draw cards equal to the greatest toughness among creatures you control,
 * then put any number of creature cards from your hand onto the battlefield.
 *
 * IMPLEMENTED: uncounterable + draw greatest_toughness + put_creatures_from_hand.
 */
describe('Last March of the Ents', () => {
  const DB = CardEffectsDB['last march of the ents'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "can't be countered" ──
  it('is uncounterable', () => {
    expect(DB.uncounterable).toBe(true);
  });

  // ── Oracle: "Draw cards equal to greatest toughness" ──
  it('draws greatest_toughness cards', () => {
    const draw = DB.cast.find((e: any) => e.type === 'draw');
    expect(draw).toBeDefined();
    expect(draw.amount).toBe('greatest_toughness');
  });

  // ── Oracle: "put any number of creature cards from hand onto BF" ──
  it('has put_creatures_from_hand effect', () => {
    const put = DB.cast.find((e: any) => e.type === 'put_creatures_from_hand');
    expect(put).toBeDefined();
  });
});
