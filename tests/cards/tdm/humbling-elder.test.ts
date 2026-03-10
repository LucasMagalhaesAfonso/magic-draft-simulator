import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Humbling Elder', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['humbling elder']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Humbling Elder', type_line: 'Creature — Human Monk', power: '1', toughness: '2', keywords: ["Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

});
