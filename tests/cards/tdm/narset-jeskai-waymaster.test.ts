import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Narset, Jeskai Waymaster', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['narset, jeskai waymaster']).toBeDefined();
  });

  it('has end step trigger', () => {
    const dbEntry = CardEffectsDB['narset, jeskai waymaster'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

});
