import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Perennation', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['perennation']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Return target permanent card from your graveyard to the battlefield with a hexproof counter and an indestructible counter on it."

});
