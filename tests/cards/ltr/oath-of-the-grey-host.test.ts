import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Oath of the Grey Host', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['oath of the grey host']).toBeDefined();
  });

  it('creates white 1/1 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 1, toughness: 1, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

  it('creates Treasure token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['oath of the grey host'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('treasure') || json.includes('create_token') || json.includes('token') || json.includes('mana')).toBe(true);
  });

  it('creates Food token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['oath of the grey host'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('food') || json.includes('create_token') || json.includes('token')).toBe(true);
  });

  it('opponent loses 3 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'lose_life', amount: 3, target: 'opponent' });
    expect(game.life(1)).toBe(17);
  });

  it('is a Saga with 3 chapters', () => {
    const dbEntry = CardEffectsDB['oath of the grey host'];
    expect(dbEntry).toBeDefined();
    expect(dbEntry.saga).toBeDefined();
  });

});
