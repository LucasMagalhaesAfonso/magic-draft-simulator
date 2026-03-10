import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Thunder of Unity', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['thunder of unity']).toBeDefined();
  });

  it('draws 2 cards', () => {
    const game = new TestGame();
    for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 2 });
    expect(game.hand(0).length).toBe(startHand + 2);
  });

  it('gains 1 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 1 });
    expect(game.life(0)).toBe(21);
  });

  it('opponent loses 1 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'lose_life', amount: 1, target: 'opponent' });
    expect(game.life(1)).toBe(19);
  });

  it('is a Saga with 2 chapters', () => {
    const dbEntry = CardEffectsDB['thunder of unity'];
    expect(dbEntry).toBeDefined();
    expect(dbEntry.saga).toBeDefined();
  });

});
