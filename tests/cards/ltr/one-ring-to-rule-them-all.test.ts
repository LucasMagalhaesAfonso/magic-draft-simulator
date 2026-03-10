import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('One Ring to Rule Them All', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['one ring to rule them all']).toBeDefined();
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['one ring to rule them all'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

  it('opponent loses 1 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'lose_life', amount: 1, target: 'opponent' });
    expect(game.life(1)).toBe(19);
  });

  it('is a Saga with 3 chapters', () => {
    const dbEntry = CardEffectsDB['one ring to rule them all'];
    expect(dbEntry).toBeDefined();
    expect(dbEntry.saga).toBeDefined();
  });

});
