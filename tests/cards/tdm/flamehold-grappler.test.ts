import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Flamehold Grappler', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['flamehold grappler']).toBeDefined();
  });

  it('has First strike', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Flamehold Grappler', type_line: 'Creature — Human Monk', power: '3', toughness: '3', keywords: ["First strike"] });
    expect(CardUtils.hasKeyword(card, 'First strike')).toBe(true);
  });

});
