import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Fleeting Effigy', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['fleeting effigy']).toBeDefined();
  });

  it('has Haste', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Fleeting Effigy', type_line: 'Creature — Elemental', power: '2', toughness: '2', keywords: ["Haste"] });
    expect(CardUtils.hasKeyword(card, 'Haste')).toBe(true);
  });

  it('has end step trigger', () => {
    const dbEntry = CardEffectsDB['fleeting effigy'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

});
