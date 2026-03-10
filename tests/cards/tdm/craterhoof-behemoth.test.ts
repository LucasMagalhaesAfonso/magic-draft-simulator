import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Craterhoof Behemoth', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['craterhoof behemoth']).toBeDefined();
  });

  it('has Haste', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Craterhoof Behemoth', type_line: 'Creature — Beast', power: '5', toughness: '5', keywords: ["Haste"] });
    expect(CardUtils.hasKeyword(card, 'Haste')).toBe(true);
  });

});
