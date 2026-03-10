import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sauron, the Necromancer', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sauron, the necromancer']).toBeDefined();
  });

  it('has Menace', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Sauron, the Necromancer', type_line: 'Legendary Creature — Avatar Horror', power: '4', toughness: '4', keywords: ["Menace"] });
    expect(CardUtils.hasKeyword(card, 'Menace')).toBe(true);
  });

});
