import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Mordor Trebuchet', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['mordor trebuchet']).toBeDefined();
  });

  it('has Defender', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Mordor Trebuchet', type_line: 'Artifact Creature — Wall', power: '1', toughness: '4', keywords: ["Defender"] });
    expect(CardUtils.hasKeyword(card, 'Defender')).toBe(true);
  });

});
