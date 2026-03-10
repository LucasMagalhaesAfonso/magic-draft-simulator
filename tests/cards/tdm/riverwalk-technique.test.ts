import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Riverwalk Technique', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['riverwalk technique']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Choose one — | • The owner of target nonland permanent puts it on their choice of the top or bottom of their library. | • Counter target noncreature spell."

});
