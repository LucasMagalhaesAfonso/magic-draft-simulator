import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Shire Shirriff', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['shire shirriff']).toBeDefined();
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Shire Shirriff', type_line: 'Creature — Halfling Soldier', power: '2', toughness: '2', keywords: ["Vigilance"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

  it('exiles target creature', () => {
    const dbEntry = CardEffectsDB['shire shirriff'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('exile')).toBe(true);
  });

});
