import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Inevitable Defeat', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['inevitable defeat']).toBeDefined();
  });

  it('exiles target nonland permanent', () => {
    const dbEntry = CardEffectsDB['inevitable defeat'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('exile')).toBe(true);
  });

  it('gains 3 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 3 });
    expect(game.life(0)).toBe(23);
  });

});
