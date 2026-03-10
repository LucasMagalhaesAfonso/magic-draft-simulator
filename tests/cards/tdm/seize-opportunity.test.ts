import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Seize Opportunity', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['seize opportunity']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Choose one — | • Exile the top two cards of your library. Until the end of your next turn, you may play those cards. | • Up to two target creatures each get +2/+1 until end of turn."

});
