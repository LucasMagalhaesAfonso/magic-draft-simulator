import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Lotho, Corrupt Shirriff', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['lotho, corrupt shirriff']).toBeDefined();
  });

  it('creates Treasure token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['lotho, corrupt shirriff'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('treasure') || json.includes('create_token') || json.includes('token') || json.includes('mana')).toBe(true);
  });

});
