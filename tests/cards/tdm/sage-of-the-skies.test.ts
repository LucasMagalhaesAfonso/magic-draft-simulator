import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sage of the Skies', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sage of the skies']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Sage of the Skies', type_line: 'Creature — Human Monk', power: '2', toughness: '3', keywords: ["Flying","Lifelink"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Lifelink', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Sage of the Skies', type_line: 'Creature — Human Monk', power: '2', toughness: '3', keywords: ["Flying","Lifelink"] });
    expect(CardUtils.hasKeyword(card, 'Lifelink')).toBe(true);
  });

});
