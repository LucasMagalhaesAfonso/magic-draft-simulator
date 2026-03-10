import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Iceridge Serpent', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['iceridge serpent']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "When this creature enters, return target creature an opponent controls to its owner's hand."

});
