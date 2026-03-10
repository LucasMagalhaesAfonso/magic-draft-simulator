import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Wail of War', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['wail of war']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Choose one — | • Creatures target opponent controls get -1/-1 until end of turn. | • Return up to two target creature cards from your graveyard to your hand."

});
