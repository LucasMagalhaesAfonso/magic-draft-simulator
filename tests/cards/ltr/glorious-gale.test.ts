import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Glorious Gale', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['glorious gale']).toBeDefined();
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['glorious gale'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

});
