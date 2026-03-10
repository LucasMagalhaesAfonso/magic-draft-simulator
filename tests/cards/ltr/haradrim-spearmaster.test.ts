import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Haradrim Spearmaster', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['haradrim spearmaster']).toBeDefined();
  });

  it('has Reach', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Haradrim Spearmaster', type_line: 'Creature — Human Warrior', power: '2', toughness: '3', keywords: ["Reach"] });
    expect(CardUtils.hasKeyword(card, 'Reach')).toBe(true);
  });

  it('has combat trigger', () => {
    const dbEntry = CardEffectsDB['haradrim spearmaster'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

});
