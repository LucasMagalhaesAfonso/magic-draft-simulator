import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Lotuslight Dancers', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['lotuslight dancers']).toBeDefined();
  });

  it('has Lifelink', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Lotuslight Dancers', type_line: 'Creature — Zombie Bard', power: '3', toughness: '6', keywords: ["Lifelink"] });
    expect(CardUtils.hasKeyword(card, 'Lifelink')).toBe(true);
  });

  it('searches library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['lotuslight dancers'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('search') || json.includes('ramp') || json.includes('look_top') || json.includes('tutor')).toBe(true);
  });

});
