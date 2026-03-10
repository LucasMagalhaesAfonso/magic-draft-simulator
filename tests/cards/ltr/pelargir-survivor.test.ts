import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Pelargir Survivor', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['pelargir survivor']).toBeDefined();
  });

  it('has activated ability', () => {
    const dbEntry = CardEffectsDB['pelargir survivor'];
    expect(dbEntry).toBeDefined();
    const hasActivated = dbEntry.activated && dbEntry.activated.length > 0;
    expect(hasActivated).toBe(true);
  });

});
