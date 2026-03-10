import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Summit Intimidator', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['summit intimidator']).toBeDefined();
  });

  it('has Reach', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Summit Intimidator', type_line: 'Creature — Yeti', power: '4', toughness: '3', keywords: ["Reach"] });
    expect(CardUtils.hasKeyword(card, 'Reach')).toBe(true);
  });

});
