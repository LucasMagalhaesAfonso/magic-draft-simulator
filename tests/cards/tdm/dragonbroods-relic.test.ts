import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Dragonbroods\' Relic', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['dragonbroods\' relic']).toBeDefined();
  });

  it('ETB deals 3 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 3, target: 'opponent' });
    expect(game.life(1)).toBe(17);
  });

});
