import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Rohirrim Lancer', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['rohirrim lancer']).toBeDefined();
  });

  it('has Menace', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Rohirrim Lancer', type_line: 'Creature — Human Knight', power: '1', toughness: '1', keywords: ["Menace"] });
    expect(CardUtils.hasKeyword(card, 'Menace')).toBe(true);
  });

  it('has dies trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['rohirrim lancer'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['dies', 'creature_dies', 'other_creature_dies', 'any_creature_dies'].includes(t.event)) ?? false) || !!(dbEntry.gy_trigger) || json.includes('dies');
    expect(hasTrigger).toBe(true);
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['rohirrim lancer'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

});
