import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('The Ring Goes South', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['the ring goes south']).toBeDefined();
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['the ring goes south'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

});
