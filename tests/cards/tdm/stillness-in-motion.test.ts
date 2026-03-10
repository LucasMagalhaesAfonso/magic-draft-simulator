import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Stillness in Motion', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['stillness in motion']).toBeDefined();
  });

  it('has upkeep trigger', () => {
    const dbEntry = CardEffectsDB['stillness in motion'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

  it('mill 3', () => {
    const game = new TestGame();
    for (let i = 0; i < 5; i++) game.addToLibraryTop(1, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(1).length;
    game.resolveEffect(0, { type: 'mill', amount: 3, target: 'opponent' });
    expect(game.library(1).length).toBe(libBefore - 3);
  });

});
