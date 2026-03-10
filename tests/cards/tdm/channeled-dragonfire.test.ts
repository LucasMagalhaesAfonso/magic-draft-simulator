import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Channeled Dragonfire', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['channeled dragonfire']).toBeDefined();
  });

  it('deals 2 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 2, target: 'opponent' });
    expect(game.life(1)).toBe(18);
  });

});
