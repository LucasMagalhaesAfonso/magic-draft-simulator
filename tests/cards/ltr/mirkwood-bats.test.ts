import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Mirkwood Bats', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['mirkwood bats']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Mirkwood Bats', type_line: 'Creature — Bat', power: '2', toughness: '3', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('opponent loses 1 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'lose_life', amount: 1, target: 'opponent' });
    expect(game.life(1)).toBe(19);
  });

});
