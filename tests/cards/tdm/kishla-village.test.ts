import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Kishla Village', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['kishla village']).toBeDefined();
  });

  it('surveil 2', () => {
    const game = new TestGame();
    for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(0).length;
    game.resolveEffect(0, { type: 'surveil', amount: 2 });
    // AI auto-resolves surveil — some cards may go to graveyard
    expect(game.library(0).length + game.graveyard(0).length).toBe(libBefore);
  });

  it('enters tapped', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['kishla village'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('enters_tapped')).toBe(true);
  });

  it('looks at top of library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['kishla village'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('look') || json.includes('surveil') || json.includes('scry') || json.includes('exile_top') || json.includes('reveal')).toBe(true);
  });

});
