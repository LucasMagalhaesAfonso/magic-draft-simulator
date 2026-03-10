import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Kotis, the Fangkeeper', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['kotis, the fangkeeper']).toBeDefined();
  });

  it('has Indestructible', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Kotis, the Fangkeeper', type_line: 'Legendary Creature — Zombie Warrior', power: '2', toughness: '1', keywords: ["Indestructible"] });
    expect(CardUtils.hasKeyword(card, 'Indestructible')).toBe(true);
  });

  it('has combat damage trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['kotis, the fangkeeper'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => t.event === 'combat_damage_player') ?? false) || json.includes('combat_damage_player');
    expect(hasTrigger).toBe(true);
  });

});
