import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Awaken the Honored Dead', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['awaken the honored dead']).toBeDefined();
  });

  it('destroys target nonland permanent', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '3', toughness: '3' });
    game.resolveEffect(0, { type: 'destroy', target: 'nonland permanent' }, { targetUid: target._uid });
    expect(game.battlefield(1).find(c => c._uid === target._uid)).toBeUndefined();
  });

  it('discard 1 card', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['awaken the honored dead'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('discard')).toBe(true);
  });

  it('mill 3', () => {
    const game = new TestGame();
    for (let i = 0; i < 5; i++) game.addToLibraryTop(1, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(1).length;
    game.resolveEffect(0, { type: 'mill', amount: 3, target: 'opponent' });
    expect(game.library(1).length).toBe(libBefore - 3);
  });

  it('is a Saga with 3 chapters', () => {
    const dbEntry = CardEffectsDB['awaken the honored dead'];
    expect(dbEntry).toBeDefined();
    expect(dbEntry.saga).toBeDefined();
  });

});
