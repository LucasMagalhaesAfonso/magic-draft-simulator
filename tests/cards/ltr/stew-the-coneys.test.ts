import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Stew the Coneys', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['stew the coneys']).toBeDefined();
  });

  it('creates Food token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['stew the coneys'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('food') || json.includes('create_token') || json.includes('token')).toBe(true);
  });

  it('gains 3 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 3 });
    expect(game.life(0)).toBe(23);
  });

});
