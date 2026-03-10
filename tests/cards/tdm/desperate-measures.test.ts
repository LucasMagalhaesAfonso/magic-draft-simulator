import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Desperate Measures', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['desperate measures']).toBeDefined();
  });

  it('draws 2 cards', () => {
    const game = new TestGame();
    for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 2 });
    expect(game.hand(0).length).toBe(startHand + 2);
  });

});
