import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('King of the Oathbreakers', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['king of the oathbreakers']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'King of the Oathbreakers', type_line: 'Legendary Creature — Spirit Noble', power: '3', toughness: '3', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('creates white 1/1 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 1, toughness: 1, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

});
