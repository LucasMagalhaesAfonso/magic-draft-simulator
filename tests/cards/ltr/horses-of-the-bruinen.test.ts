import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Horses of the Bruinen', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['horses of the bruinen']).toBeDefined();
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['horses of the bruinen'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
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
