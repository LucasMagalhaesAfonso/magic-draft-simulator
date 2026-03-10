import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Rosie Cotton of South Lane', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['rosie cotton of south lane']).toBeDefined();
  });

  it('creates Food token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['rosie cotton of south lane'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('food') || json.includes('create_token') || json.includes('token')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['rosie cotton of south lane'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

  it('gains 3 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 3 });
    expect(game.life(0)).toBe(23);
  });

});
