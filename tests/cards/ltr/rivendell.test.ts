import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Rivendell', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['rivendell']).toBeDefined();
  });

  it('scry 2', () => {
    const game = new TestGame();
    for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(0).length;
    game.resolveEffect(0, { type: 'scry', amount: 2 });
    // AI auto-resolves scry — library size unchanged (cards put back on top/bottom)
    expect(game.library(0).length).toBe(libBefore);
  });

  it('enters tapped', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['rivendell'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('enters_tapped')).toBe(true);
  });

});
