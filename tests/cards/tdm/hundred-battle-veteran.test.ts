import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Hundred-Battle Veteran', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['hundred-battle veteran']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "As long as there are three or more different kinds of counters among creatures you control, this creature gets +2/+4. | You may cast this card from your graveyard. If you do, it enters with a finality counter on it. (If a creature with a finality counter on it would die, exile it instead.)"

});
