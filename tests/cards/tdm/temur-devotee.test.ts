import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Temur Devotee', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['temur devotee']).toBeDefined();
  });

  it('has Defender', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Temur Devotee', type_line: 'Creature — Human Druid', power: '3', toughness: '3', keywords: ["Defender"] });
    expect(CardUtils.hasKeyword(card, 'Defender')).toBe(true);
  });

});
