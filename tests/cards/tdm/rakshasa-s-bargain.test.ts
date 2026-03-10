import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Rakshasa\'s Bargain', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['rakshasa\'s bargain']).toBeDefined();
  });

  it('looks at top of library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['rakshasa\'s bargain'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('look') || json.includes('surveil') || json.includes('scry') || json.includes('exile_top') || json.includes('reveal')).toBe(true);
  });

});
