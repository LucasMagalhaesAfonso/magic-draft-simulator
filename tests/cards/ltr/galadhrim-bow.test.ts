import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Galadhrim Bow', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['galadhrim bow']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Galadhrim Bow', type_line: 'Artifact — Equipment', keywords: ["Equip","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

  it('gives +1/+2 to equipped creature', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Galadhrim Bow', type_line: 'Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '2', toughness: '2' });
    game.setMana(0, { C: 10 });
    game.equip(equip._uid, creature._uid);
    expect(CardUtils.getPower(creature)).toBe(3);
    expect(CardUtils.getToughness(creature)).toBe(4);
  });

  it('equip cost is {2}', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Galadhrim Bow', type_line: 'Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    game.setMana(0, { C: 2 });
    const result = game.equip(equip._uid, creature._uid);
    expect(result).toBeTruthy();
  });

});
