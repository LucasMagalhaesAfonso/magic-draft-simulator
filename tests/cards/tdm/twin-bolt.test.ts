import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Twin Bolt', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['twin bolt']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Twin Bolt deals 2 damage divided as you choose among one or two targets."

});
