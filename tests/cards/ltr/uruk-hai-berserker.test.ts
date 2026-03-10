import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Uruk-hai Berserker', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['uruk-hai berserker']).toBeDefined();
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['uruk-hai berserker'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

});
