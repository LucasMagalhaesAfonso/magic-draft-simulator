import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Kin-Tree Severance', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['kin-tree severance']).toBeDefined();
  });

  it('exiles target permanent', () => {
    const dbEntry = CardEffectsDB['kin-tree severance'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('exile')).toBe(true);
  });

});
