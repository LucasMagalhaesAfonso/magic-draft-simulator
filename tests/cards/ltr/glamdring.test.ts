import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Glamdring', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['glamdring']).toBeDefined();
  });

  it('equip cost is {3}', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Glamdring', type_line: 'Legendary Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    game.setMana(0, { C: 3 });
    const result = game.equip(equip._uid, creature._uid);
    expect(result).toBeTruthy();
  });

  it('has combat damage trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['glamdring'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => t.event === 'combat_damage_player') ?? false) || json.includes('combat_damage_player');
    expect(hasTrigger).toBe(true);
  });

});
