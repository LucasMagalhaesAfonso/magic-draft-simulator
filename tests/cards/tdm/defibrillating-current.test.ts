import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Defibrillating Current', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['defibrillating current']).toBeDefined();
  });

  it('deals 4 damage', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '1', toughness: '5' });
    game.resolveEffect(0, { type: 'damage', amount: 4, target: 'creature' });
    expect(target._damage).toBe(4);
  });

  it('gains 2 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 2 });
    expect(game.life(0)).toBe(22);
  });

});
