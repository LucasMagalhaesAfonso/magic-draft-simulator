import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Auroral Procession', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['auroral procession']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Return target card from your graveyard to your hand."

});
