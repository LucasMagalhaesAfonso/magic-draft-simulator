import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Osseous Exhale', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['osseous exhale']).toBeDefined();
  });

  it('deals 5 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 5, target: 'opponent' });
    expect(game.life(1)).toBe(15);
  });

  it('gains 2 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 2 });
    expect(game.life(0)).toBe(22);
  });

});
