import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Stone of Erech', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['stone of erech']).toBeDefined();
  });

  it('draws 1 card', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

  it('draws a card', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

});
