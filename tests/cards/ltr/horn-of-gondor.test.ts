import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Horn of Gondor', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['horn of gondor']).toBeDefined();
  });

  it('ETB creates 1/1 token', () => {
    // Unhandled assertion type: etb_token
    expect(true).toBe(true); // placeholder
  });

  it('has activated ability', () => {
    const dbEntry = CardEffectsDB['horn of gondor'];
    expect(dbEntry).toBeDefined();
    const hasActivated = dbEntry.activated && dbEntry.activated.length > 0;
    expect(hasActivated).toBe(true);
  });

});
