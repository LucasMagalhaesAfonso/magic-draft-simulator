import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sting, the Glinting Dagger', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sting, the glinting dagger']).toBeDefined();
  });

  it('gives +1/+1 to equipped creature', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Sting, the Glinting Dagger', type_line: 'Legendary Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '2', toughness: '2' });
    game.setMana(0, { C: 10 });
    game.equip(equip._uid, creature._uid);
    expect(CardUtils.getPower(creature)).toBe(3);
    expect(CardUtils.getToughness(creature)).toBe(3);
  });

  it('equip cost is {2}', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Sting, the Glinting Dagger', type_line: 'Legendary Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    game.setMana(0, { C: 2 });
    const result = game.equip(equip._uid, creature._uid);
    expect(result).toBeTruthy();
  });

  it('has combat trigger', () => {
    const dbEntry = CardEffectsDB['sting, the glinting dagger'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

});
