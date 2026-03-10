import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Songcrafter Mage', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['songcrafter mage']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Songcrafter Mage', type_line: 'Creature — Human Bard', power: '3', toughness: '2', keywords: ["Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

});
