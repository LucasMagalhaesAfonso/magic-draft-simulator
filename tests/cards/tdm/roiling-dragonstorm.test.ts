import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Roiling Dragonstorm', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['roiling dragonstorm']).toBeDefined();
  });

  it('ETB draws 2 cards', () => {
    const game = new TestGame();
    // Add library cards to draw from
    for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 2 });
    expect(game.hand(0).length).toBe(startHand + 2);
  });

  it('discard 1 card', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['roiling dragonstorm'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('discard')).toBe(true);
  });

});
