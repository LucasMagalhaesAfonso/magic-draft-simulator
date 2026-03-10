import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Rainveil Rejuvenator', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['rainveil rejuvenator']).toBeDefined();
  });

  it('mill 3', () => {
    const game = new TestGame();
    for (let i = 0; i < 5; i++) game.addToLibraryTop(1, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(1).length;
    game.resolveEffect(0, { type: 'mill', amount: 3, target: 'opponent' });
    expect(game.library(1).length).toBe(libBefore - 3);
  });

});
