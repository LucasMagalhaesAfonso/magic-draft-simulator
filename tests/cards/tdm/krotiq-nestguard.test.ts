import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Krotiq Nestguard', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['krotiq nestguard']).toBeDefined();
  });

  it('has Defender', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Krotiq Nestguard', type_line: 'Creature — Insect', power: '4', toughness: '4', keywords: ["Defender"] });
    expect(CardUtils.hasKeyword(card, 'Defender')).toBe(true);
  });

});
