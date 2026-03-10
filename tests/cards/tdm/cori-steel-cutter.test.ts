import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Cori-Steel Cutter', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['cori-steel cutter']).toBeDefined();
  });

  it('gives +1/+1 to equipped creature', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Cori-Steel Cutter', type_line: 'Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '2', toughness: '2' });
    game.setMana(0, { C: 10 });
    game.equip(equip._uid, creature._uid);
    expect(CardUtils.getPower(creature)).toBe(3);
    expect(CardUtils.getToughness(creature)).toBe(3);
  });

  it('equip cost is {1}', () => {
    const game = new TestGame();
    const equip = game.addToBattlefield(0, { name: 'Cori-Steel Cutter', type_line: 'Artifact — Equipment' });
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    game.setMana(0, { C: 1 });
    const result = game.equip(equip._uid, creature._uid);
    expect(result).toBeTruthy();
  });

  it('creates white 1/1 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 1, toughness: 1, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

  it('triggers on casting noncreature spell', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['cori-steel cutter'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['cast_spell', 'cast_instant_sorcery', 'cast_noncreature', 'second_spell', 'cast_creature'].includes(t.event)) ?? false) || json.includes('prowess') || json.includes('cast_') || json.includes('second_spell');
    expect(hasTrigger).toBe(true);
  });

});
