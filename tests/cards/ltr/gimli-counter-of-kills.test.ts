import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Gimli, Counter of Kills', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['gimli, counter of kills']).toBeDefined();
  });

  it('has Trample', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Gimli, Counter of Kills', type_line: 'Legendary Creature — Dwarf Warrior', power: '4', toughness: '3', keywords: ["Trample"] });
    expect(CardUtils.hasKeyword(card, 'Trample')).toBe(true);
  });

});
