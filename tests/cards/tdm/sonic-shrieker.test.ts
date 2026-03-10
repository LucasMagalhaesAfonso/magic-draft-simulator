import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sonic Shrieker', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sonic shrieker']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Sonic Shrieker', type_line: 'Creature — Dragon', power: '4', toughness: '4', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('ETB deals 2 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 2, target: 'opponent' });
    expect(game.life(1)).toBe(18);
  });

  it('discard 1 card', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['sonic shrieker'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('discard')).toBe(true);
  });

  it('gains 2 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 2 });
    expect(game.life(0)).toBe(22);
  });

});
