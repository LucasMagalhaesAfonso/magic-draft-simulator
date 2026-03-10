import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Saruman of Many Colors', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['saruman of many colors']).toBeDefined();
  });

  it('has Ward', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Saruman of Many Colors', type_line: 'Legendary Creature — Avatar Wizard', power: '5', toughness: '4', keywords: ["Ward","Mill"] });
    expect(CardUtils.hasKeyword(card, 'Ward')).toBe(true);
  });

});
