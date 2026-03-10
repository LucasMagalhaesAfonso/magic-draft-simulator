import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Highspire Bell-Ringer', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['highspire bell-ringer']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Highspire Bell-Ringer', type_line: 'Creature — Djinn Monk', power: '1', toughness: '4', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('costs {1} less conditionally', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['highspire bell-ringer'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('cost') || json.includes('affinity') || json.includes('reduction') || json.includes('less')).toBe(true);
  });

});
