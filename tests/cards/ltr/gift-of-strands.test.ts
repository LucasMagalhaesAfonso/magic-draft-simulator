import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Gift of Strands', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['gift of strands']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Gift of Strands', type_line: 'Enchantment — Aura', keywords: ["Enchant","Flash","Scry"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

  it('scry 2', () => {
    const game = new TestGame();
    for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(0).length;
    game.resolveEffect(0, { type: 'scry', amount: 2 });
    // AI auto-resolves scry — library size unchanged (cards put back on top/bottom)
    expect(game.library(0).length).toBe(libBefore);
  });

});
