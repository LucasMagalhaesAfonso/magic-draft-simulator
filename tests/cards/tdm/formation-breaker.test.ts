import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Formation Breaker', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['formation breaker']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Creatures with power less than this creature's power can't block it. | As long as you control a creature with a counter on it, this creature gets +1/+2."

});
