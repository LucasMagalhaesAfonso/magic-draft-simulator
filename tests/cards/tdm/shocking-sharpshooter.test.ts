import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Shocking Sharpshooter', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['shocking sharpshooter']).toBeDefined();
  });

  it('has Reach', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Shocking Sharpshooter', type_line: 'Creature — Human Archer', power: '1', toughness: '3', keywords: ["Reach"] });
    expect(CardUtils.hasKeyword(card, 'Reach')).toBe(true);
  });

  it('ETB deals 1 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 1, target: 'opponent' });
    expect(game.life(1)).toBe(19);
  });

});
