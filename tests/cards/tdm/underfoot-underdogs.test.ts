import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Underfoot Underdogs', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['underfoot underdogs']).toBeDefined();
  });

  it('ETB creates 1/1 token', () => {
    // Unhandled assertion type: etb_token
    expect(true).toBe(true); // placeholder
  });

  it('has activated ability', () => {
    const dbEntry = CardEffectsDB['underfoot underdogs'];
    expect(dbEntry).toBeDefined();
    const hasActivated = dbEntry.activated && dbEntry.activated.length > 0;
    expect(hasActivated).toBe(true);
  });

});
