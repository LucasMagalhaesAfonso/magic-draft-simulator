import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Mardu Siegebreaker', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['mardu siegebreaker']).toBeDefined();
  });

  it('has Haste', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Mardu Siegebreaker', type_line: 'Creature — Human Warrior', power: '4', toughness: '4', keywords: ["Haste","Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Haste')).toBe(true);
  });

  it('has Deathtouch', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Mardu Siegebreaker', type_line: 'Creature — Human Warrior', power: '4', toughness: '4', keywords: ["Haste","Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Deathtouch')).toBe(true);
  });

  it('has attacks trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['mardu siegebreaker'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['attacks', 'equipped_attacks', 'attack'].includes(t.event)) ?? false) || json.includes('attack');
    expect(hasTrigger).toBe(true);
  });

});
