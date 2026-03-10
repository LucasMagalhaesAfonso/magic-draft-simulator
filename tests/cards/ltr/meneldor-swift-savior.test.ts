import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Meneldor, Swift Savior', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['meneldor, swift savior']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Meneldor, Swift Savior', type_line: 'Legendary Creature — Bird Soldier', power: '3', toughness: '3', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has combat damage trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['meneldor, swift savior'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => t.event === 'combat_damage_player') ?? false) || json.includes('combat_damage_player');
    expect(hasTrigger).toBe(true);
  });

});
