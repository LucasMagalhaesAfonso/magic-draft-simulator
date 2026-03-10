import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Fire-Rim Form', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['fire-rim form']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Fire-Rim Form', type_line: 'Enchantment — Aura', keywords: ["Enchant","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

});
