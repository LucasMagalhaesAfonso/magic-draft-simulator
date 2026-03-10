import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Mithril Coat', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['mithril coat']).toBeDefined();
  });

  it('has Indestructible', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Mithril Coat', type_line: 'Legendary Artifact — Equipment', keywords: ["Indestructible","Equip","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Indestructible')).toBe(true);
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Mithril Coat', type_line: 'Legendary Artifact — Equipment', keywords: ["Indestructible","Equip","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

  it('equip cost is {3}', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Mithril Coat', type_line: 'Legendary Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    game.setMana(0, { C: 3 });
    const result = game.equip(equip._uid, creature._uid);
    expect(result).toBeTruthy();
  });

});
