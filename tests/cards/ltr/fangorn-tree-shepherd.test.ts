import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Fangorn, Tree Shepherd — {4}{G}{G}
 * Legendary Creature — Treefolk (6/6)
 *
 * Treefolk you control have vigilance.
 * Whenever one or more Treefolk you control attack, add twice that much {G}.
 * You don't lose unspent green mana as steps and phases end.
 *
 * IMPLEMENTED: grant_all vigilance to treefolk, double_attacking_treefolk mana, mana_pool_no_lose.
 */
describe('Fangorn, Tree Shepherd', () => {
  const DB = CardEffectsDB['fangorn, tree shepherd'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Treefolk you control have vigilance" ──
  it('grants vigilance to treefolk via grant_all', () => {
    const grantAll = DB.static.find((s: any) => s.type === 'grant_all' && s.target === 'treefolk');
    expect(grantAll).toBeDefined();
    expect(grantAll.keyword).toBe('Vigilance');
  });

  // ── Oracle: "Whenever one or more Treefolk you control attack, add twice that much {G}" ──
  it('has attacks trigger with treefolk_attacking condition', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    expect(trigger).toBeDefined();
    expect(trigger.condition).toBe('treefolk_attacking');
  });

  it('trigger adds double_attacking_treefolk green mana', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    const addMana = trigger.effects.find((e: any) => e.type === 'add_mana');
    expect(addMana).toBeDefined();
    expect(addMana.color).toBe('G');
    expect(addMana.amount).toBe('double_attacking_treefolk');
  });

  // ── Oracle: "You don't lose unspent green mana" ──
  it('has mana_pool_no_lose for green', () => {
    const noLose = DB.static.find((s: any) => s.type === 'mana_pool_no_lose');
    expect(noLose).toBeDefined();
    expect(noLose.color).toBe('G');
  });
});
