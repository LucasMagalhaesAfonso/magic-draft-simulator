import { describe, it, expect } from 'vitest';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Éomer of the Riddermark', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['éomer of the riddermark']).toBeDefined();
  });

  it('has haste keyword', () => {
    const dbEntry = CardEffectsDB['éomer of the riddermark'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json).toContain('haste');
  });

  it('has attack trigger for Human Soldier token', () => {
    const dbEntry = CardEffectsDB['éomer of the riddermark'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('attacks') || json.includes('triggered')).toBe(true);
    expect(json.includes('token') || json.includes('human') || json.includes('soldier')).toBe(true);
  });
});
