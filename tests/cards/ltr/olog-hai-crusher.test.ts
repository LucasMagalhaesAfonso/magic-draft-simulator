import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Olog-hai Crusher', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['olog-hai crusher']).toBeDefined();
  });

  it('has Trample', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Olog-hai Crusher', type_line: 'Creature — Troll Soldier', power: '4', toughness: '4', keywords: ["Trample"] });
    expect(CardUtils.hasKeyword(card, 'Trample')).toBe(true);
  });

});
