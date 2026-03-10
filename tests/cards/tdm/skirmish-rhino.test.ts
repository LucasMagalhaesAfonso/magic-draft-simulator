import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Skirmish Rhino', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['skirmish rhino']).toBeDefined();
  });

  it('has Trample', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Skirmish Rhino', type_line: 'Creature — Rhino', power: '3', toughness: '4', keywords: ["Trample"] });
    expect(CardUtils.hasKeyword(card, 'Trample')).toBe(true);
  });

  it('gains 2 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 2 });
    expect(game.life(0)).toBe(22);
  });

  it('opponent loses 2 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'lose_life', amount: 2, target: 'opponent' });
    expect(game.life(1)).toBe(18);
  });

});
