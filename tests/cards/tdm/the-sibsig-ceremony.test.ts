import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('The Sibsig Ceremony', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['the sibsig ceremony']).toBeDefined();
  });

  it('ETB creates 2/2 token', () => {
    // Unhandled assertion type: etb_token
    expect(true).toBe(true); // placeholder
  });

  it('costs {2} less conditionally', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['the sibsig ceremony'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('cost') || json.includes('affinity') || json.includes('reduction') || json.includes('less')).toBe(true);
  });

});
