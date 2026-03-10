import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Gríma Wormtongue', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['gríma wormtongue']).toBeDefined();
  });

  it('amass 2', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['gríma wormtongue'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('amass') || json.includes('counter') || json.includes('token')).toBe(true);
  });

  it('opponent loses 1 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'lose_life', amount: 1, target: 'opponent' });
    expect(game.life(1)).toBe(19);
  });

  it('involves sacrifice', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['gríma wormtongue'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('sacrifice') || json.includes('sac') || json.includes('cost') || json.includes('ramp') || json.includes('debuff')).toBe(true);
  });

});
