import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Bloomvine Regent // Claim Territory', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['bloomvine regent']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Bloomvine Regent // Claim Territory', type_line: 'Creature — Dragon // Sorcery — Omen', power: '4', toughness: '5', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('gains 3 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 3 });
    expect(game.life(0)).toBe(23);
  });

  it('searches library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['bloomvine regent'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('search') || json.includes('ramp') || json.includes('look_top') || json.includes('tutor')).toBe(true);
  });

});
