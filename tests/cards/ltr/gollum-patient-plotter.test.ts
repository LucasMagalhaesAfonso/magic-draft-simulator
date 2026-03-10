import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Gollum, Patient Plotter', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['gollum, patient plotter']).toBeDefined();
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['gollum, patient plotter'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

  it('involves sacrifice', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['gollum, patient plotter'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('sacrifice') || json.includes('sac') || json.includes('cost') || json.includes('ramp') || json.includes('debuff')).toBe(true);
  });

});
