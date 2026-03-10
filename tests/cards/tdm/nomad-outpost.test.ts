import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Nomad Outpost', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['nomad outpost']).toBeDefined();
  });

  it('enters tapped', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['nomad outpost'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('enters_tapped')).toBe(true);
  });

});
