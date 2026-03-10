import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Fresh Start', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['fresh start']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Fresh Start', type_line: 'Enchantment — Aura', keywords: ["Enchant","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

});
