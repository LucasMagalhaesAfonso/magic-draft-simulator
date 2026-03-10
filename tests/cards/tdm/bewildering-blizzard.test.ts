import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Bewildering Blizzard', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['bewildering blizzard']).toBeDefined();
  });

  it('draws 3 cards', () => {
    const game = new TestGame();
    for (let i = 0; i < 5; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 3 });
    expect(game.hand(0).length).toBe(startHand + 3);
  });

});
