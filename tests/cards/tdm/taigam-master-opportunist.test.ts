import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Taigam, Master Opportunist', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['taigam, master opportunist']).toBeDefined();
  });

  // TODO: TODO: needs manual test — "Flurry — Whenever you cast your second spell each turn, copy it, then exile the spell you cast with four time counters on it. If it doesn't have suspend, it gains suspend. (At the beginning of its owner's upkeep, they remove a time counter. When the last is removed, they may play it without paying its mana cost. If it's a creature, it has haste.)"

});
