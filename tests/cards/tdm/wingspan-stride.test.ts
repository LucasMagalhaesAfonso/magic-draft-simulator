import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Wingspan Stride', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['wingspan stride']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Enchant creature | Enchanted creature gets +1/+1 and has flying. | {2}{U}: Return this Aura to its owner's hand."

});
