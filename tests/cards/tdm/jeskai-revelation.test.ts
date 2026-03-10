import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Jeskai Revelation', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['jeskai revelation']).toBeDefined();
  });

  it('deals 4 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 4, target: 'opponent' });
    expect(game.life(1)).toBe(16);
  });

  it('creates white 1/1 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 1, toughness: 1, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

  it('draws 2 cards', () => {
    const game = new TestGame();
    for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 2 });
    expect(game.hand(0).length).toBe(startHand + 2);
  });

  it('gains 4 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 4 });
    expect(game.life(0)).toBe(24);
  });

});
