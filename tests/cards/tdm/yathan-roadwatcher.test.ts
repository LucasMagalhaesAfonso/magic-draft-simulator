import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Yathan Roadwatcher', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['yathan roadwatcher']).toBeDefined();
  });

  it('mill 4', () => {
    const game = new TestGame();
    for (let i = 0; i < 6; i++) game.addToLibraryTop(1, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(1).length;
    game.resolveEffect(0, { type: 'mill', amount: 4, target: 'opponent' });
    expect(game.library(1).length).toBe(libBefore - 4);
  });

});
