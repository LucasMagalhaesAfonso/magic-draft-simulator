import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Dracogenesis', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['dracogenesis']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "You may cast Dragon spells without paying their mana costs."

});
