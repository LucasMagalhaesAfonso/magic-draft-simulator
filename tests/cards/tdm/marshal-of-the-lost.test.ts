import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Marshal of the Lost', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['marshal of the lost']).toBeDefined();
  });

  it('has Deathtouch', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Marshal of the Lost', type_line: 'Creature — Orc Warrior', power: '3', toughness: '3', keywords: ["Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Deathtouch')).toBe(true);
  });

});
