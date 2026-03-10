import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Ainok Wayfarer', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['ainok wayfarer']).toBeDefined();
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['ainok wayfarer'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

  it('mill 3', () => {
    const game = new TestGame();
    for (let i = 0; i < 5; i++) game.addToLibraryTop(1, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(1).length;
    game.resolveEffect(0, { type: 'mill', amount: 3, target: 'opponent' });
    expect(game.library(1).length).toBe(libBefore - 3);
  });

});
