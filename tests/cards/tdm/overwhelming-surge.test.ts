import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Overwhelming Surge', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['overwhelming surge']).toBeDefined();
  });

  it('deals 3 damage', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '1', toughness: '4' });
    game.resolveEffect(0, { type: 'damage', amount: 3, target: 'creature' });
    expect(target._damage).toBe(3);
  });

});
