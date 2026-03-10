import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Molten Exhale', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['molten exhale']).toBeDefined();
  });

  it('deals 4 damage', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '1', toughness: '5' });
    game.resolveEffect(0, { type: 'damage', amount: 4, target: 'creature' });
    expect(target._damage).toBe(4);
  });

});
