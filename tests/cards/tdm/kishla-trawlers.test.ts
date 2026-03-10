import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Kishla Trawlers', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['kishla trawlers']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "When this creature enters, you may exile a creature card from your graveyard. When you do, return target instant or sorcery card from your graveyard to your hand."

});
