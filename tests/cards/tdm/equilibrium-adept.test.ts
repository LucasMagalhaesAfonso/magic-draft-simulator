import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Equilibrium Adept', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['equilibrium adept']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card. | Flurry — Whenever you cast your second spell each turn, this creature gains double strike until end of turn."

});
