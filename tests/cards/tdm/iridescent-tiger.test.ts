import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Iridescent Tiger', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['iridescent tiger']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "When this creature enters, if you cast it, add {W}{U}{B}{R}{G}."

});
