import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Flame of Anor', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['flame of anor']).toBeDefined();
  });

  it('destroys target artifact', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Artifact' });
    game.resolveEffect(0, { type: 'destroy', target: 'artifact' }, { targetUid: target._uid });
    expect(game.battlefield(1).find(c => c._uid === target._uid)).toBeUndefined();
  });

  it('deals 5 damage', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '1', toughness: '6' });
    game.resolveEffect(0, { type: 'damage', amount: 5, target: 'creature' });
    expect(target._damage).toBe(5);
  });

});
