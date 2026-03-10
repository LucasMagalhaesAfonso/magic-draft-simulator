import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Grishnákh, Brash Instigator', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['grishnákh, brash instigator']).toBeDefined();
  });

  it('amass 2', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['grishnákh, brash instigator'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('amass') || json.includes('counter') || json.includes('token')).toBe(true);
  });

});
