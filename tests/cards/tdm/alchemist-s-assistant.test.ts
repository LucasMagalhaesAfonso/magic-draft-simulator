import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Alchemist\'s Assistant', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['alchemist\'s assistant']).toBeDefined();
  });

  it('has Lifelink', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Alchemist\'s Assistant', type_line: 'Creature — Monkey', power: '2', toughness: '1', keywords: ["Lifelink","Renew"] });
    expect(CardUtils.hasKeyword(card, 'Lifelink')).toBe(true);
  });

});
