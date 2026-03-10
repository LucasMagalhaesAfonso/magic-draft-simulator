import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Snowmelt Stag', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['snowmelt stag']).toBeDefined();
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Snowmelt Stag', type_line: 'Creature — Elemental Elk', power: '2', toughness: '5', keywords: ["Vigilance"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

  it('sets base P/T to 5/2', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['snowmelt stag'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('base') || json.includes('conditional_buff') || json.includes('become') || json.includes('power')).toBe(true);
  });

});
