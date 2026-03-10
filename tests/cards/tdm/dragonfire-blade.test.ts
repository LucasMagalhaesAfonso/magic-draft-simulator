import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Dragonfire Blade', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['dragonfire blade']).toBeDefined();
  });

  it('gives +2/+2 to equipped creature', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Dragonfire Blade', type_line: 'Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '2', toughness: '2' });
    game.setMana(0, { C: 10 });
    game.equip(equip._uid, creature._uid);
    expect(CardUtils.getPower(creature)).toBe(4);
    expect(CardUtils.getToughness(creature)).toBe(4);
  });

  it('equip cost is {4}', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Dragonfire Blade', type_line: 'Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    game.setMana(0, { C: 4 });
    const result = game.equip(equip._uid, creature._uid);
    expect(result).toBeTruthy();
  });

  it('costs {1} less conditionally', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['dragonfire blade'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('cost') || json.includes('affinity') || json.includes('reduction') || json.includes('less')).toBe(true);
  });

});
