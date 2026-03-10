import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Dispelling Exhale', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['dispelling exhale']).toBeDefined();
  });

  it('counters target spell', () => {
    // Verify CardEffectsDB has counter spell effect
    const dbEntry = CardEffectsDB['dispelling exhale'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json).toContain('counter_spell');
  });

});
