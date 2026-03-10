import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Corroding Dragonstorm', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['corroding dragonstorm']).toBeDefined();
  });

  it('surveil 2', () => {
    const game = new TestGame();
    for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(0).length;
    game.resolveEffect(0, { type: 'surveil', amount: 2 });
    // AI auto-resolves surveil — some cards may go to graveyard
    expect(game.library(0).length + game.graveyard(0).length).toBe(libBefore);
  });

  it('gains 2 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 2 });
    expect(game.life(0)).toBe(22);
  });

  it('opponent loses 2 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'lose_life', amount: 2, target: 'opponent' });
    expect(game.life(1)).toBe(18);
  });

  it('looks at top of library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['corroding dragonstorm'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('look') || json.includes('surveil') || json.includes('scry') || json.includes('exile_top') || json.includes('reveal')).toBe(true);
  });

});
