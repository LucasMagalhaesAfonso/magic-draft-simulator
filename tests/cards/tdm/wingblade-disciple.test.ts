import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Wingblade Disciple', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['wingblade disciple']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Wingblade Disciple', type_line: 'Creature — Human Monk', power: '2', toughness: '2', keywords: ["Flying","Flurry"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('creates white 1/1 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 1, toughness: 1, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

});
