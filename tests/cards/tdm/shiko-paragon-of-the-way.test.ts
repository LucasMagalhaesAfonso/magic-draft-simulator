import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Shiko, Paragon of the Way', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['shiko, paragon of the way']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Shiko, Paragon of the Way', type_line: 'Legendary Creature — Spirit Dragon', power: '4', toughness: '5', keywords: ["Flying","Vigilance"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Shiko, Paragon of the Way', type_line: 'Legendary Creature — Spirit Dragon', power: '4', toughness: '5', keywords: ["Flying","Vigilance"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

});
