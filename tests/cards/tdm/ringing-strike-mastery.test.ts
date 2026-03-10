import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Ringing Strike Mastery', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['ringing strike mastery']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Enchant creature | When this Aura enters, tap enchanted creature. | Enchanted creature doesn't untap during its controller's untap step. | Enchanted creature has \"{5}: Untap this creature.\""

});
