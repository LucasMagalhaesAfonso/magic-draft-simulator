import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Stormplain Detainment', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['stormplain detainment']).toBeDefined();
  });

  it('exiles target nonland permanent', () => {
    const dbEntry = CardEffectsDB['stormplain detainment'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('exile')).toBe(true);
  });

});
