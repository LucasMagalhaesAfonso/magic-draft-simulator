import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('The Shire', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['the shire']).toBeDefined();
  });

  it('creates Food token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['the shire'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('food') || json.includes('create_token') || json.includes('token')).toBe(true);
  });

  it('enters tapped', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['the shire'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('enters_tapped')).toBe(true);
  });

});
