import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Watcher of the Wayside', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['watcher of the wayside']).toBeDefined();
  });

  it('gains 2 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 2 });
    expect(game.life(0)).toBe(22);
  });

  it('mill 2', () => {
    const game = new TestGame();
    for (let i = 0; i < 4; i++) game.addToLibraryTop(1, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(1).length;
    game.resolveEffect(0, { type: 'mill', amount: 2, target: 'opponent' });
    expect(game.library(1).length).toBe(libBefore - 2);
  });

});
