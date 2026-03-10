import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Landroval, Horizon Witness', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['landroval, horizon witness']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Landroval, Horizon Witness', type_line: 'Legendary Creature — Bird Noble', power: '3', toughness: '4', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has attacks trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['landroval, horizon witness'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['attacks', 'equipped_attacks', 'attack'].includes(t.event)) ?? false) || json.includes('attack');
    expect(hasTrigger).toBe(true);
  });

});
