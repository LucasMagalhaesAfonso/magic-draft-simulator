import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Caustic Exhale', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['caustic exhale']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "As an additional cost to cast this spell, behold a Dragon or pay {1}. (To behold a Dragon, choose a Dragon you control or reveal a Dragon card from your hand.) | Target creature gets -3/-3 until end of turn."

});
