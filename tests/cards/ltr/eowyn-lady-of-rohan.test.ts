import { describe, it, expect } from 'vitest';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Éowyn, Lady of Rohan', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['éowyn, lady of rohan']).toBeDefined();
  });

  it('has combat_begin trigger', () => {
    const dbEntry = CardEffectsDB['éowyn, lady of rohan'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json).toContain('combat_begin');
  });
});
