import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Gurmag Rakshasa', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['gurmag rakshasa']).toBeDefined();
  });

  it('has Menace', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Gurmag Rakshasa', type_line: 'Creature — Demon', power: '5', toughness: '5', keywords: ["Menace"] });
    expect(CardUtils.hasKeyword(card, 'Menace')).toBe(true);
  });

});
