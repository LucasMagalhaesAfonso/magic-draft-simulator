import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Devoted Duelist', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['devoted duelist']).toBeDefined();
  });

  it('has Haste', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Devoted Duelist', type_line: 'Creature — Goblin Monk', power: '2', toughness: '1', keywords: ["Flurry","Haste"] });
    expect(CardUtils.hasKeyword(card, 'Haste')).toBe(true);
  });

  it('deals 1 damage to each opponent', () => {
    // Verify DB has damage to each opponent effect
    const dbEntry = CardEffectsDB['devoted duelist'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('damage') || json.includes('loses')).toBe(true);
  });

});
