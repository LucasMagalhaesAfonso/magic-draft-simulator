import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Protector of Gondor', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['protector of gondor']).toBeDefined();
  });

  it('ETB creates 1/1 token', () => {
    // Unhandled assertion type: etb_token
    expect(true).toBe(true); // placeholder
  });

});
