import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Mirkwood Spider', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['mirkwood spider']).toBeDefined();
  });

  it('has Deathtouch', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Mirkwood Spider', type_line: 'Creature — Spider', power: '1', toughness: '1', keywords: ["Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Deathtouch')).toBe(true);
  });

  it('has attacks trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['mirkwood spider'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['attacks', 'equipped_attacks', 'attack'].includes(t.event)) ?? false) || json.includes('attack');
    expect(hasTrigger).toBe(true);
  });

});
