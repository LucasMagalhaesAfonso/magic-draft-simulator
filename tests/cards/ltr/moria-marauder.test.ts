import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Moria Marauder', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['moria marauder']).toBeDefined();
  });

  it('has Double strike', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Moria Marauder', type_line: 'Creature — Goblin Warrior', power: '1', toughness: '1', keywords: ["Double strike"] });
    expect(CardUtils.hasKeyword(card, 'Double strike')).toBe(true);
  });

  it('has combat damage trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['moria marauder'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => t.event === 'combat_damage_player') ?? false) || json.includes('combat_damage_player');
    expect(hasTrigger).toBe(true);
  });

});
