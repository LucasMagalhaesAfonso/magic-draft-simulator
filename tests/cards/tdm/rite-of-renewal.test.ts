import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Rite of Renewal', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['rite of renewal']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Return up to two target permanent cards from your graveyard to your hand. Target player shuffles up to four target cards from their graveyard into their library. Exile Rite of Renewal."

});
