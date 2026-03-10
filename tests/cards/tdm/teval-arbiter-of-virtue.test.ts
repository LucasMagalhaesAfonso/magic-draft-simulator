import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Teval, Arbiter of Virtue', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['teval, arbiter of virtue']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Teval, Arbiter of Virtue', type_line: 'Legendary Creature — Spirit Dragon', power: '6', toughness: '6', keywords: ["Flying","Lifelink"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Lifelink', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Teval, Arbiter of Virtue', type_line: 'Legendary Creature — Spirit Dragon', power: '6', toughness: '6', keywords: ["Flying","Lifelink"] });
    expect(CardUtils.hasKeyword(card, 'Lifelink')).toBe(true);
  });

});
