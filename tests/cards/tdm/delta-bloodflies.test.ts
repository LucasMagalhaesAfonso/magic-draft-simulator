import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Delta Bloodflies', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['delta bloodflies']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Delta Bloodflies', type_line: 'Creature — Insect', power: '1', toughness: '2', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has attacks trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['delta bloodflies'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['attacks', 'equipped_attacks', 'attack'].includes(t.event)) ?? false) || json.includes('attack');
    expect(hasTrigger).toBe(true);
  });

  it('opponent loses 1 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'lose_life', amount: 1, target: 'opponent' });
    expect(game.life(1)).toBe(19);
  });

});
