import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Rot-Curse Rakshasa', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['rot-curse rakshasa']).toBeDefined();
  });

  it('has Trample', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Rot-Curse Rakshasa', type_line: 'Creature — Demon', power: '5', toughness: '5', keywords: ["Renew","Trample","Decayed"] });
    expect(CardUtils.hasKeyword(card, 'Trample')).toBe(true);
  });

});
