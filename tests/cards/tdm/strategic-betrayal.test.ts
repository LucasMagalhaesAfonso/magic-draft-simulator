import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Strategic Betrayal', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['strategic betrayal']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Target opponent exiles a creature they control and their graveyard."

});
