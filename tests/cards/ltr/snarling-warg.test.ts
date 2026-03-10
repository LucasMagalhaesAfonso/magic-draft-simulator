import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Snarling Warg', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['snarling warg']).toBeDefined();
  });

  it('has Menace', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Snarling Warg', type_line: 'Creature — Wolf', power: '3', toughness: '4', keywords: ["Menace"] });
    expect(CardUtils.hasKeyword(card, 'Menace')).toBe(true);
  });

});
