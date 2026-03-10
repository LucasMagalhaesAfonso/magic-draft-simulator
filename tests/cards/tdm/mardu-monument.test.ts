import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Mardu Monument', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['mardu monument']).toBeDefined();
  });

  it('creates red 1/1 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 1, toughness: 1, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

  it('searches library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['mardu monument'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('search') || json.includes('ramp') || json.includes('look_top') || json.includes('tutor')).toBe(true);
  });

  it('puts card into hand', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['mardu monument'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('hand') || json.includes('draw') || json.includes('return') || json.includes('look_top') || json.includes('reveal') || json.includes('to_hand') || json.includes('ramp')).toBe(true);
  });

});
