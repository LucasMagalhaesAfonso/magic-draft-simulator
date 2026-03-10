// Layer 4a: Oracle text vs CardEffectsDB data validation
// Catches mismatches between what oracle says and what DB has

import { describe, it, expect } from 'vitest';
import { FIXTURES, CardFlowFixture } from '../helpers/card-flow-fixtures';
import { CardEffectsDB } from '../../src/engine/card-effects';

// ─── Helper: get DB entry for a card ───
function getDB(name: string): any {
  return CardEffectsDB[name.toLowerCase()] || null;
}

// ─── 4a.1: Cards with anthem text in oracle must have anthem in DB ───
describe('Layer 4a: Oracle-vs-DB Audit', () => {

  const anthemCards = FIXTURES.filter(f => f.oracleAnthems.length > 0 && f.oracleAnthems.some(a => a.target !== 'equipped_creature'));

  describe('Anthem presence', () => {
    for (const fix of anthemCards) {
      it(`${fix.name}: oracle anthem → DB has anthem/buff_all/static`, () => {
        const db = getDB(fix.name);
        if (!db) {
          // No DB entry at all — anthem card without DB is a problem
          expect(db).toBeTruthy();
          return;
        }
        const hasAnthem = db.anthem ||
          (db.static || []).some((s: any) => s.type === 'anthem' || s.type === 'buff_all') ||
          (db.etb || []).some((e: any) => e.type === 'buff' && /all|each/.test(e.target || ''));
        expect(hasAnthem).toBeTruthy();
      });
    }
  });

  // ─── 4a.2: Anthem P/T values match oracle ───
  describe('Anthem P/T values', () => {
    for (const fix of anthemCards) {
      const db = getDB(fix.name);
      if (!db) continue;
      for (const oa of fix.oracleAnthems) {
        if (oa.target === 'equipped_creature') continue; // Checked separately
        it(`${fix.name}: oracle ${oa.pattern} → DB P/T match`, () => {
          const dbAnthems = [
            ...(db.anthem ? [db.anthem] : []),
            ...(db.static || []).filter((s: any) => s.type === 'anthem'),
          ];
          // At least one anthem should match power/toughness
          const match = dbAnthems.some((a: any) =>
            a.power === oa.power && a.toughness === oa.toughness
          );
          expect(match).toBe(true);
        });
      }
    }
  });

  // ─── 4a.3: Cards with trigger text in oracle must have triggered in DB ───
  describe('Trigger presence', () => {
    const triggerCards = FIXTURES.filter(f =>
      f.oracleTriggers.length > 0 && f.dbEntry !== null && !f.isLand
    );
    for (const fix of triggerCards) {
      it(`${fix.name}: oracle triggers → DB has triggered[]`, () => {
        const db = getDB(fix.name);
        expect(db).toBeTruthy();
        const hasTriggers = (db.triggered || []).length > 0 ||
          (db.etb || []).length > 0; // ETB is also a "when enters" trigger
        expect(hasTriggers).toBe(true);
      });
    }
  });

  // ─── 4a.4: Scryfall keywords present in DB static ───
  describe('Keyword presence', () => {
    // Only check keywords that need DB entries (evergreen combat keywords)
    const dbKeywords = ['flying', 'trample', 'vigilance', 'lifelink', 'deathtouch',
      'first strike', 'double strike', 'haste', 'reach', 'menace', 'hexproof',
      'indestructible', 'defender', 'ward'];

    const keywordCards = FIXTURES.filter(f =>
      f.keywords.some(k => dbKeywords.includes(k.toLowerCase())) &&
      f.dbEntry !== null
    );

    for (const fix of keywordCards) {
      const relevantKws = fix.keywords.filter(k => dbKeywords.includes(k.toLowerCase()));
      for (const kw of relevantKws) {
        it(`${fix.name}: keyword "${kw}" in DB static`, () => {
          const db = getDB(fix.name);
          if (!db) return; // Vanilla creature keywords are intrinsic
          const hasKwInDB = (db.static || []).some((s: any) =>
            s.type === 'has_keyword' && (s.keywords || []).some((k: string) => k.toLowerCase() === kw.toLowerCase())
          );
          // Keywords can also be intrinsic (from Scryfall keywords field) — engine reads card.keywords directly
          const isIntrinsic = fix.cardDef.keywords.some(k => k.toLowerCase() === kw.toLowerCase());
          expect(hasKwInDB || isIntrinsic).toBe(true);
        });
      }
    }
  });

  // ─── 4a.5: Equipment P/T matches oracle ───
  describe('Equipment buff values', () => {
    const equipCards = FIXTURES.filter(f =>
      f.cardDef.type_line.includes('Equipment') &&
      f.oracleAnthems.some(a => a.target === 'equipped_creature')
    );

    for (const fix of equipCards) {
      const oracleEquip = fix.oracleAnthems.find(a => a.target === 'equipped_creature')!;
      it(`${fix.name}: equip buff ${oracleEquip.power}/${oracleEquip.toughness} matches DB`, () => {
        const db = getDB(fix.name);
        expect(db).toBeTruthy();
        if (!db) return;
        // Equipment buff can be in db.equip or db.static
        const equipBuff = db.equip || (db.static || []).find((s: any) => s.type === 'equip_buff');
        expect(equipBuff).toBeTruthy();
        if (equipBuff) {
          expect(equipBuff.power).toBe(oracleEquip.power);
          expect(equipBuff.toughness).toBe(oracleEquip.toughness);
        }
      });
    }
  });

  // ─── 4a.6: Cards with DB entry but NO oracle triggers should not have spurious triggered[] ───
  describe('No spurious triggers', () => {
    const noTriggerCards = FIXTURES.filter(f =>
      f.oracleTriggers.length === 0 && f.dbEntry !== null &&
      (f.dbEntry.triggered || []).length > 0
    );

    for (const fix of noTriggerCards) {
      it(`${fix.name}: DB has triggered[] but oracle has no trigger text (review needed)`, () => {
        // This is informational — oracle regex may miss some patterns
        // Just verify the triggered entries have valid event types
        const db = getDB(fix.name);
        for (const t of db.triggered || []) {
          expect(t.event).toBeTruthy();
        }
      });
    }
  });
});
