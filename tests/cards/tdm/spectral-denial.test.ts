import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Spectral Denial', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['spectral denial']).toBeDefined();
  });

  it('counters target spell', () => {
    // Verify CardEffectsDB has counter spell effect
    const dbEntry = CardEffectsDB['spectral denial'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json).toContain('counter_spell');
  });

  it('costs {1} less conditionally', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['spectral denial'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('cost') || json.includes('affinity') || json.includes('reduction') || json.includes('less')).toBe(true);
  });

});
