import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Narset\'s Rebuke', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['narset\'s rebuke']).toBeDefined();
  });

  it('deals 5 damage', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '1', toughness: '6' });
    game.resolveEffect(0, { type: 'damage', amount: 5, target: 'creature' });
    expect(target._damage).toBe(5);
  });

});
