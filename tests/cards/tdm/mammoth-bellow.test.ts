import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Mammoth Bellow', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['mammoth bellow']).toBeDefined();
  });

  it('creates green 5/5 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 5, toughness: 5, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

});
