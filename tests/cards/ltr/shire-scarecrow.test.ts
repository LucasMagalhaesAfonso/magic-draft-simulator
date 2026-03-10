import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Shire Scarecrow', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['shire scarecrow']).toBeDefined();
  });

  it('has Defender', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Shire Scarecrow', type_line: 'Artifact Creature — Scarecrow', power: '0', toughness: '3', keywords: ["Defender"] });
    expect(CardUtils.hasKeyword(card, 'Defender')).toBe(true);
  });

});
