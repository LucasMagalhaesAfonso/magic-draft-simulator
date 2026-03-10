import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Grond, the Gatebreaker', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['grond, the gatebreaker']).toBeDefined();
  });

  it('has Trample', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Grond, the Gatebreaker', type_line: 'Legendary Artifact — Vehicle', keywords: ["Crew","Trample"] });
    expect(CardUtils.hasKeyword(card, 'Trample')).toBe(true);
  });

});
