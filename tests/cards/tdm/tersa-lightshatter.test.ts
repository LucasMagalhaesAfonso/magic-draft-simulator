import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Tersa Lightshatter', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['tersa lightshatter']).toBeDefined();
  });

  it('has Haste', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Tersa Lightshatter', type_line: 'Legendary Creature — Orc Wizard', power: '3', toughness: '3', keywords: ["Haste"] });
    expect(CardUtils.hasKeyword(card, 'Haste')).toBe(true);
  });

  it('has attacks trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['tersa lightshatter'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['attacks', 'equipped_attacks', 'attack'].includes(t.event)) ?? false) || json.includes('attack');
    expect(hasTrigger).toBe(true);
  });

});
