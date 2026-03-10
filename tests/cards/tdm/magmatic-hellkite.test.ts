import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Magmatic Hellkite', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['magmatic hellkite']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Magmatic Hellkite', type_line: 'Creature — Dragon', power: '4', toughness: '5', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

});
