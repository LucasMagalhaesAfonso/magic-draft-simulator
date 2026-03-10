import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Haunt of the Dead Marshes', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['haunt of the dead marshes']).toBeDefined();
  });

  it('scry 1', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(0).length;
    game.resolveEffect(0, { type: 'scry', amount: 1 });
    // AI auto-resolves scry — library size unchanged (cards put back on top/bottom)
    expect(game.library(0).length).toBe(libBefore);
  });

});
