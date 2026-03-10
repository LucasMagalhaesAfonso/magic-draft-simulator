import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Mox Jasper', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['mox jasper']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "{T}: Add one mana of any color. Activate only if you control a Dragon."

});
