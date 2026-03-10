import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Severance Priest', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['severance priest']).toBeDefined();
  });

  it('has Deathtouch', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Severance Priest', type_line: 'Creature — Djinn Cleric', power: '3', toughness: '3', keywords: ["Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Deathtouch')).toBe(true);
  });

});
