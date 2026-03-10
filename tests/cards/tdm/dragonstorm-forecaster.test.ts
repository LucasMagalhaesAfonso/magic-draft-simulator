import { describe, it, expect } from 'vitest';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Dragonstorm Forecaster', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['dragonstorm forecaster']).toBeDefined();
  });

  it('searches library', () => {
    const dbEntry = CardEffectsDB['dragonstorm forecaster'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('search_library')).toBe(true);
  });

  it('has activated ability', () => {
    const dbEntry = CardEffectsDB['dragonstorm forecaster'];
    expect(dbEntry.activated?.length).toBeGreaterThan(0);
  });
});
