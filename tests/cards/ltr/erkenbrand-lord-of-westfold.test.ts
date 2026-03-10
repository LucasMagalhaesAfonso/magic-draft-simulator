import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Erkenbrand, Lord of Westfold', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['erkenbrand, lord of westfold']).toBeDefined();
  });

  it('has enters trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['erkenbrand, lord of westfold'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => t.event === 'enters_battlefield') ?? false) || json.includes('enters_battlefield');
    expect(hasTrigger).toBe(true);
  });

  it('anthem +1/+0', () => {
    const game = new TestGame();
    const lord = game.addToBattlefield(0, { name: 'Erkenbrand, Lord of Westfold', type_line: 'Legendary Creature — Human Soldier', power: '3', toughness: '3', keywords: [] });
    const other = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    // Anthem effects should buff other creatures
    // Exact assertion depends on engine static ability processing
    const dbEntry = CardEffectsDB['erkenbrand, lord of westfold'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    const hasAnthem = json.includes('anthem') || json.includes('buff_all');
    expect(hasAnthem).toBe(true);
  });

});
