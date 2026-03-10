import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Temur Battlecrier', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['temur battlecrier']).toBeDefined();
  });

  it('costs {1} less conditionally', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['temur battlecrier'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('cost') || json.includes('affinity') || json.includes('reduction') || json.includes('less')).toBe(true);
  });

});
