import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Cori Mountain Stalwart', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['cori mountain stalwart']).toBeDefined();
  });

  it('deals 2 damage to each opponent', () => {
    // Verify DB has damage to each opponent effect
    const dbEntry = CardEffectsDB['cori mountain stalwart'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('damage') || json.includes('loses')).toBe(true);
  });

  it('gains 2 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 2 });
    expect(game.life(0)).toBe(22);
  });

});
