import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Lie in Wait', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['lie in wait']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Return target creature card from your graveyard to your hand. Lie in Wait deals damage equal to that card's power to target creature."

});
