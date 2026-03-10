import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Unsparing Boltcaster', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['unsparing boltcaster']).toBeDefined();
  });

  it('ETB deals 5 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 5, target: 'opponent' });
    expect(game.life(1)).toBe(15);
  });

});
