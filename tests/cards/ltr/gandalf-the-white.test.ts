import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Gandalf the White', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['gandalf the white']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Gandalf the White', type_line: 'Legendary Creature — Avatar Wizard', power: '4', toughness: '5', keywords: ["Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

});
