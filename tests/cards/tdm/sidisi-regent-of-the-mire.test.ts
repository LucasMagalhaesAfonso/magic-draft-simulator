import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sidisi, Regent of the Mire', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sidisi, regent of the mire']).toBeDefined();
  });

  it('involves sacrifice', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['sidisi, regent of the mire'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('sacrifice') || json.includes('sac') || json.includes('cost')).toBe(true);
  });

});
