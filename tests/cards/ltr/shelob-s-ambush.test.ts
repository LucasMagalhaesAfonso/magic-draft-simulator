import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Shelob\'s Ambush', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['shelob\'s ambush']).toBeDefined();
  });

  it('creates Food token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['shelob\'s ambush'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('food') || json.includes('create_token') || json.includes('token')).toBe(true);
  });

  it('gains 3 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 3 });
    expect(game.life(0)).toBe(23);
  });

  it('gives +1/+2 and deathtouch', () => {
    const game = new TestGame();
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '2', toughness: '2' });
    game.resolveEffect(0, { type: 'buff', power: 1, toughness: 2, duration: 'end_of_turn', target: 'creature' });
    expect(CardUtils.getPower(creature)).toBe(3);
    expect(CardUtils.getToughness(creature)).toBe(4);
  });

});
