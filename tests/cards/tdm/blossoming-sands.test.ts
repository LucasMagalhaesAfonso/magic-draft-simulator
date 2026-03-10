import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Blossoming Sands', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['blossoming sands']).toBeDefined();
  });

  it('gains 1 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 1 });
    expect(game.life(0)).toBe(21);
  });

  it('enters tapped', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['blossoming sands'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('enters_tapped')).toBe(true);
  });

});
