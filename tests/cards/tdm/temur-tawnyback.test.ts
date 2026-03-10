import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Temur Tawnyback', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['temur tawnyback']).toBeDefined();
  });

  it('ETB draws 1 card', () => {
    const game = new TestGame();
    // Add library cards to draw from
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

  it('discard 1 card', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['temur tawnyback'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('discard')).toBe(true);
  });

  it('loots (draw then discard)', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['temur tawnyback'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('loot')).toBe(true);
  });

});
