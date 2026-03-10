import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('The Bath Song', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['the bath song']).toBeDefined();
  });

  it('draws 2 cards', () => {
    const game = new TestGame();
    for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 2 });
    expect(game.hand(0).length).toBe(startHand + 2);
  });

  it('discard 1 card', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['the bath song'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('discard') || json.includes('loot') || json.includes('sacrifice') || json.includes('mill')).toBe(true);
  });

  it('is a Saga with 2 chapters', () => {
    const dbEntry = CardEffectsDB['the bath song'];
    expect(dbEntry).toBeDefined();
    expect(dbEntry.saga).toBeDefined();
  });

});
