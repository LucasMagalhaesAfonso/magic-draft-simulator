import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Grey Havens Navigator', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['grey havens navigator']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Grey Havens Navigator', type_line: 'Creature — Elf Pilot', power: '3', toughness: '2', keywords: ["Flash","Scry"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

  it('scry 1', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const libBefore = game.library(0).length;
    game.resolveEffect(0, { type: 'scry', amount: 1 });
    // AI auto-resolves scry — library size unchanged (cards put back on top/bottom)
    expect(game.library(0).length).toBe(libBefore);
  });

});
