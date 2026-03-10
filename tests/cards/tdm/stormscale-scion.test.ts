import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Stormscale Scion', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['stormscale scion']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Stormscale Scion', type_line: 'Creature — Dragon', power: '4', toughness: '4', keywords: ["Flying","Storm"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

});
