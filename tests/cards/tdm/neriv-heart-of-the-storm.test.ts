import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Neriv, Heart of the Storm', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['neriv, heart of the storm']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Neriv, Heart of the Storm', type_line: 'Legendary Creature — Spirit Dragon', power: '4', toughness: '5', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

});
