import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sultai Devotee', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sultai devotee']).toBeDefined();
  });

  it('has Deathtouch', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Sultai Devotee', type_line: 'Creature — Zombie Snake Druid', power: '2', toughness: '1', keywords: ["Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Deathtouch')).toBe(true);
  });

});
