import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Soldier of the Grey Host', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['soldier of the grey host']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Soldier of the Grey Host', type_line: 'Creature — Spirit Soldier', power: '2', toughness: '2', keywords: ["Flying","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Soldier of the Grey Host', type_line: 'Creature — Spirit Soldier', power: '2', toughness: '2', keywords: ["Flying","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

});
