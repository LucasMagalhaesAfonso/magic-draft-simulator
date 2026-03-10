import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Abzan Devotee', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['abzan devotee']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "{1}: Add {W}, {B}, or {G}. Activate only once each turn. | {2}{B}: Return this card from your graveyard to your hand."

});
