import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Lobelia Sackville-Baggins', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['lobelia sackville-baggins']).toBeDefined();
  });

  it('has Menace', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Lobelia Sackville-Baggins', type_line: 'Legendary Creature — Halfling Citizen', power: '2', toughness: '3', keywords: ["Treasure","Menace","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Menace')).toBe(true);
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Lobelia Sackville-Baggins', type_line: 'Legendary Creature — Halfling Citizen', power: '2', toughness: '3', keywords: ["Treasure","Menace","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

});
