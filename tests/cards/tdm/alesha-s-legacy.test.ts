import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Alesha\'s Legacy', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['alesha\'s legacy']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Target creature you control gains deathtouch and indestructible until end of turn. (Damage and effects that say \"destroy\" don't destroy it.)"

});
