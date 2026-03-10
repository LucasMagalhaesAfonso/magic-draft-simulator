import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('New Way Forward', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['new way forward']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "The next time a source of your choice would deal damage to you this turn, prevent that damage. When damage is prevented this way, New Way Forward deals that much damage to that source's controller and you draw that many cards."

});
