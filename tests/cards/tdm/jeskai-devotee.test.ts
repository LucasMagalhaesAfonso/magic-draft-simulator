import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Jeskai Devotee', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['jeskai devotee']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Flurry — Whenever you cast your second spell each turn, this creature gets +1/+1 until end of turn. | {1}: Add {U}, {R}, or {W}. Activate only once each turn."

});
