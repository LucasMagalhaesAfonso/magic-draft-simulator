import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Tale of Tinúviel', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['tale of tinúviel']).toBeDefined();
  });

  it('is a Saga with 3 chapters', () => {
    const dbEntry = CardEffectsDB['tale of tinúviel'];
    expect(dbEntry).toBeDefined();
    expect(dbEntry.saga).toBeDefined();
  });

});
