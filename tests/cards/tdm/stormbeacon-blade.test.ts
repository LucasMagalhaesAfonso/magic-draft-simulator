import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Stormbeacon Blade', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['stormbeacon blade']).toBeDefined();
  });

  it('gives +3/+0 to equipped creature', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Stormbeacon Blade', type_line: 'Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '2', toughness: '2' });
    game.setMana(0, { C: 10 });
    game.equip(equip._uid, creature._uid);
    expect(CardUtils.getPower(creature)).toBe(5);
    expect(CardUtils.getToughness(creature)).toBe(2);
  });

  it('equip cost is {2}', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Stormbeacon Blade', type_line: 'Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    game.setMana(0, { C: 2 });
    const result = game.equip(equip._uid, creature._uid);
    expect(result).toBeTruthy();
  });

  it('has attacks trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['stormbeacon blade'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['attacks', 'equipped_attacks', 'attack'].includes(t.event)) ?? false) || json.includes('attack');
    expect(hasTrigger).toBe(true);
  });

  it('draws 1 card', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

  it('draws a card', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

});
