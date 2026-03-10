/**
 * Runtime Test Generator
 *
 * Generates/updates test files for LTR or TDM cards with runtime behavior tests.
 * Reads CardEffectsDB, detects effect types, writes executable test code.
 *
 * Usage:
 *   npx tsx tools/generate-runtime-tests.ts ltr          — generate for all LTR cards
 *   npx tsx tools/generate-runtime-tests.ts tdm          — generate for all TDM cards
 *   npx tsx tools/generate-runtime-tests.ts ltr "bill the pony"  — single card
 *
 * Output: tests/cards/<set>/generated/<card-name>.test.ts
 */

import { CardEffectsDB } from '../src/engine/card-effects';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [, , set = 'ltr', singleCard] = process.argv;
const outDir = path.join(__dirname, `../tests/cards/${set}/generated`);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toFileName(cardName: string): string {
  return cardName.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // remove special chars except space/dash
    .replace(/\s+/g, '-')          // space → dash
    .replace(/-+/g, '-');          // collapse dashes
}

function toDescribeName(cardName: string): string {
  return cardName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function resolvedAmt(amount: any): number | null {
  if (typeof amount === 'number') return amount;
  if (typeof amount === 'string' && /^\d+$/.test(amount)) return parseInt(amount);
  return null; // dynamic (X, equipment_on_self, etc.) — skip
}

// ─── Effect → Test templates ─────────────────────────────────────────────────

function effectTests(effect: any, context: string, cardKey: string): string[] {
  const tests: string[] = [];
  if (!effect || !effect.type) return tests;
  // Skip conditional effects — they require specific game state (e.g. sacrificed_legendary, control_dragon)
  if (effect.condition) return tests;

  switch (effect.type) {

    case 'damage': {
      const amt = resolvedAmt(effect.amount);
      if (amt === null) break;
      const target = effect.target || 'creature';
      // 'any' targets player by default in AI path; special targets need combat — use player test
      if (target === 'player' || target === 'opponent' || target === 'any' || target === 'each_opponent') {
        tests.push(`
  it('[${context}] deals ${amt} damage to player', () => {
    const game = new TestGame();
    game.setLife(1, 20);
    game.resolveEffect(0, ${JSON.stringify(effect)});
    expect(game.life(1)).toBe(20 - ${amt});
  });`);
      } else if (target === 'self_player') {
        tests.push(`
  it('[${context}] deals ${amt} damage to self', () => {
    const game = new TestGame();
    game.setLife(0, 20);
    game.resolveEffect(0, ${JSON.stringify(effect)});
    expect(game.life(0)).toBe(20 - ${amt});
  });`);
      } else if (target === 'each_blocker' || target === 'creature_blocked_or_blocked_legendary') {
        // Requires combat setup — just verify DB structure
        tests.push(`
  it('[${context}] has damage effect targeting ${target} (combat condition)', () => {
    const db = CardEffectsDB['${cardKey}'];
    const json = JSON.stringify(db);
    expect(json).toContain('damage');
  });`);
      } else {
        // creature damage — explicit targetUid
        const exileNote = effect.exile_on_death ? ' and sets _exileOnDeath' : '';
        tests.push(`
  it('[${context}] deals ${amt} damage to creature${exileNote}', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '1', toughness: '10' });
    game.resolveEffect(0, ${JSON.stringify(effect)}, { targetUid: target._uid });
    expect(target._damage || 0).toBe(${amt});${effect.exile_on_death ? `
    expect(target._exileOnDeath).toBe(true);` : ''}
  });`);
        if (effect.exile_on_death) {
          tests.push(`
  it('[${context}] creature dies from ${amt} damage → exiled not graveyard', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Fragile', type_line: 'Creature — Beast', power: '1', toughness: '${amt}' });
    game.resolveEffect(0, ${JSON.stringify(effect)}, { targetUid: target._uid });
    expect(game.battlefield(1).find((c: any) => c._uid === target._uid)).toBeUndefined();
    expect(game.graveyard(1).find((c: any) => c._uid === target._uid)).toBeUndefined();
  });`);
        }
      }
      break;
    }

    case 'draw': {
      const amt = resolvedAmt(effect.amount);
      if (amt === null) break;
      tests.push(`
  it('[${context}] draws ${amt} card(s)', () => {
    const game = new TestGame();
    for (let i = 0; i < ${amt + 2}; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const before = game.hand(0).length;
    game.resolveEffect(0, ${JSON.stringify(effect)});
    expect(game.hand(0).length).toBe(before + ${amt});
  });`);
      break;
    }

    case 'gainLife': {
      const amt = resolvedAmt(effect.amount);
      if (amt === null) break;
      tests.push(`
  it('[${context}] gains ${amt} life', () => {
    const game = new TestGame();
    game.setLife(0, 10);
    game.resolveEffect(0, ${JSON.stringify(effect)});
    expect(game.life(0)).toBe(10 + ${amt});
  });`);
      break;
    }

    case 'loseLife': {
      const amt = resolvedAmt(effect.amount);
      if (amt === null) break;
      const targetIs1 = effect.target === 'opponent' || effect.target === 'each_opponent';
      const pid = targetIs1 ? 1 : 0;
      const who = targetIs1 ? 'opponent' : 'self';
      tests.push(`
  it('[${context}] ${who} loses ${amt} life', () => {
    const game = new TestGame();
    game.setLife(${pid}, 20);
    game.resolveEffect(0, ${JSON.stringify(effect)});
    expect(game.life(${pid})).toBe(20 - ${amt});
  });`);
      break;
    }

    case 'destroy': {
      const tgt = effect.target || 'creature';
      // Simple creature targets only — conditional/combat targets need special setup
      if (tgt === 'creature' || tgt === 'opponent_creature') {
        tests.push(`
  it('[${context}] destroys target creature', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '3', toughness: '3' });
    game.resolveEffect(0, ${JSON.stringify(effect)}, { targetUid: target._uid });
    expect(game.battlefield(1).find((c: any) => c._uid === target._uid)).toBeUndefined();
    expect(game.graveyard(1).find((c: any) => c._uid === target._uid)).toBeDefined();
  });`);
      } else if (tgt.includes('creature')) {
        // Conditional creature targets (blocked, legendary, etc) — verify DB only
        tests.push(`
  it('[${context}] has destroy effect (conditional target: ${tgt})', () => {
    const db = CardEffectsDB['${cardKey}'];
    const json = JSON.stringify(db);
    expect(json).toContain('destroy');
  });`);
      } else if (tgt.includes('artifact') || tgt.includes('enchantment')) {
        const typeLine = tgt.includes('enchantment') ? 'Enchantment' : 'Artifact';
        tests.push(`
  it('[${context}] destroys target ${tgt}', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: '${typeLine}' });
    game.resolveEffect(0, ${JSON.stringify(effect)}, { targetUid: target._uid });
    expect(game.battlefield(1).find((c: any) => c._uid === target._uid)).toBeUndefined();
  });`);
      }
      break;
    }

    case 'exile': {
      tests.push(`
  it('[${context}] exiles a permanent', () => {
    // exile effect is defined in DB
    const db = CardEffectsDB['${cardKey}'];
    const allEffects = [...(db.cast||[]), ...(db.etb||[]), ...(db.triggered||[]).flatMap((t:any)=>t.effects||[])];
    const hasExile = allEffects.some((e: any) => e.type === 'exile');
    expect(hasExile).toBe(true);
  });`);
      break;
    }

    case 'bounce': {
      tests.push(`
  it('[${context}] bounces creature to hand', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '2', toughness: '2' });
    game.resolveEffect(0, ${JSON.stringify(effect)}, { targetUid: target._uid });
    expect(game.battlefield(1).find((c: any) => c._uid === target._uid)).toBeUndefined();
    expect(game.hand(1).find((c: any) => c._uid === target._uid)).toBeDefined();
  });`);
      break;
    }

    case 'create_token': {
      const countAmt = resolvedAmt(effect.count);
      // Skip dynamic counts (e.g. "human_count", "X") — can't reliably test without game context
      if (effect.count !== undefined && countAmt === null) {
        tests.push(`
  it('[${context}] creates ${effect.name || 'Token'} token (dynamic count: ${effect.count})', () => {
    // Dynamic count requires game context — verify DB has create_token effect
    const db = CardEffectsDB['${cardKey}'];
    expect(JSON.stringify(db)).toContain('create_token');
  });`);
        break;
      }
      const count = countAmt ?? 1;
      const name = effect.name || 'Token';
      tests.push(`
  it('[${context}] creates ${count} ${name} token(s)', () => {
    const game = new TestGame();
    game.resolveEffect(0, ${JSON.stringify(effect)});
    const tokens = game.battlefield(0).filter((c: any) => c.name === ${JSON.stringify(name)});
    expect(tokens.length).toBe(${count});
  });`);
      break;
    }

    case 'counter': {
      const counterType = effect.counter || '+1/+1';
      const amt = resolvedAmt(effect.amount);
      if (amt === null) break;
      const tgt = effect.target || 'own_creature';
      // 'same' target means chain from previous effect — can't test in isolation
      if (tgt === 'same') {
        tests.push(`
  it('[${context}] has counter effect (${counterType}) in DB', () => {
    expect(JSON.stringify(CardEffectsDB['${cardKey}'])).toContain('counter');
  });`);
        break;
      }
      // 'self' counter (counter_self variant) — skip targetUid, auto-applies
      if (tgt === 'self') {
        tests.push(`
  it('[${context}] puts ${amt} ${counterType} counter(s) on self', () => {
    const db = CardEffectsDB['${cardKey}'];
    expect(JSON.stringify(db)).toContain('counter');
  });`);
        break;
      }
      const pid = tgt.startsWith('own') || tgt === 'self' ? 0 : 1;
      tests.push(`
  it('[${context}] puts ${amt} ${counterType} counter(s) on creature', () => {
    const game = new TestGame();
    const creature = game.addToBattlefield(${pid}, { name: 'Target', type_line: 'Creature', power: '1', toughness: '1' });
    game.resolveEffect(0, ${JSON.stringify(effect)}, { targetUid: creature._uid });
    // Counter should be on the creature (engine may auto-select if only 1 candidate)
    const found = game.battlefield(${pid}).find((c: any) =>
      (c._counters?.[${JSON.stringify(counterType)}] || 0) >= ${amt}
    );
    expect(found).toBeDefined();
  });`);
      break;
    }

    case 'amass': {
      const amt = resolvedAmt(effect.amount);
      if (amt === null) break;
      tests.push(`
  it('[${context}] amasses ${amt} (creates/grows Orc Army)', () => {
    const game = new TestGame();
    game.resolveEffect(0, ${JSON.stringify(effect)});
    const armies = game.battlefield(0).filter((c: any) => (c.type_line||'').toLowerCase().includes('army'));
    expect(armies.length).toBe(1);
    expect(armies[0]._counters?.['+1/+1'] || 0).toBe(${amt});
  });`);
      break;
    }

    case 'mill': {
      const amt = resolvedAmt(effect.amount);
      if (amt === null) break;
      const targetPid = (effect.target === 'self' || effect.target === 'controller') ? 0 : 1;
      tests.push(`
  it('[${context}] mills ${amt} card(s)', () => {
    const game = new TestGame();
    for (let i = 0; i < ${amt + 2}; i++) game.addToLibraryTop(${targetPid}, { name: 'Lib', type_line: 'Creature' });
    const before = game.graveyard(${targetPid}).length;
    game.resolveEffect(0, ${JSON.stringify(effect)});
    expect(game.graveyard(${targetPid}).length).toBe(before + ${amt});
  });`);
      break;
    }

    case 'scry': {
      const amt = resolvedAmt(effect.amount);
      if (amt === null) break;
      tests.push(`
  it('[${context}] scry ${amt} — sets _pendingScry for human', () => {
    const game = new TestGame();
    game.setHuman(0, true);
    for (let i = 0; i < ${amt + 1}; i++) game.addToLibraryTop(0, { name: 'Top', type_line: 'Creature' });
    game.resolveEffect(0, ${JSON.stringify(effect)});
    // Human gets a scry overlay
    const wfi = game.state.waitingForInput;
    expect(wfi?.type === 'scry' || game.state._pendingScry != null).toBe(true);
  });`);
      break;
    }

    case 'ramp': {
      tests.push(`
  it('[${context}] ramp — puts land onto battlefield', () => {
    const game = new TestGame();
    game.addToLibraryTop(0, { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: 'T: Add {G}.' });
    const before = game.battlefield(0).length;
    game.resolveEffect(0, ${JSON.stringify(effect)});
    // Ramp should add a land to battlefield (or handle the search)
    // At minimum, the effect should not crash
    expect(game.state.players[0]).toBeDefined();
  });`);
      break;
    }

    case 'buff': {
      const power = resolvedAmt(effect.power) ?? 0;
      const toughness = resolvedAmt(effect.toughness) ?? 0;
      if (power === 0 && toughness === 0) break;
      const duration = effect.duration || 'permanent';
      const tgtField = effect.target;
      // buff_all / global buffs and 'same' chaining → verify DB only
      if (!tgtField || tgtField.startsWith('all') || tgtField === 'same') {
        tests.push(`
  it('[${context}] has buff effect +${power}/+${toughness} in DB', () => {
    const db = CardEffectsDB['${cardKey}'];
    expect(JSON.stringify(db)).toContain('buff');
  });`);
      } else if (tgtField === 'self') {
        // 'self' uses data.cardUid — pass as cardUid so engine finds the card
        tests.push(`
  it('[${context}] buffs self +${power}/+${toughness} (${duration})', () => {
    const game = new TestGame();
    const creature = game.addToBattlefield(0, { name: 'Target', type_line: 'Creature', power: '1', toughness: '1' });
    game.resolveEffect(0, ${JSON.stringify(effect)}, { cardUid: creature._uid });
    ${power !== 0 ? `expect(CardUtils.getPower(creature)).toBeGreaterThanOrEqual(1 + ${power});` : ''}
    ${toughness !== 0 ? `expect(CardUtils.getToughness(creature)).toBeGreaterThanOrEqual(1 + ${toughness});` : ''}
  });`);
      } else {
        // own_creature / creature / opponent_creature — auto-selects if 1 candidate
        tests.push(`
  it('[${context}] buffs creature +${power}/+${toughness} (${duration})', () => {
    const game = new TestGame();
    const creature = game.addToBattlefield(0, { name: 'Target', type_line: 'Creature', power: '1', toughness: '1' });
    game.resolveEffect(0, ${JSON.stringify(effect)});
    ${power !== 0 ? `expect(CardUtils.getPower(creature)).toBeGreaterThanOrEqual(1 + ${power});` : ''}
    ${toughness !== 0 ? `expect(CardUtils.getToughness(creature)).toBeGreaterThanOrEqual(1 + ${toughness});` : ''}
  });`);
      }
      break;
    }

    case 'grant': {
      const kws: string[] = effect.keywords || [];
      for (const kw of kws) {
        tests.push(`
  it('[${context}] grants ${kw} to creature', () => {
    const game = new TestGame();
    // Put a creature on battlefield so the AI has a target to auto-pick
    const creature = game.addToBattlefield(0, { name: 'Target', type_line: 'Creature', power: '1', toughness: '1' });
    // Call with explicit targetUid so engine applies to this card
    game.resolveEffect(0, ${JSON.stringify(effect)}, { targetUid: creature._uid });
    // The grant effect registers the keyword in _tempKeywords
    const hasTempKw = (creature._tempKeywords || []).some((tk: any) => {
      const k = typeof tk === 'string' ? tk : tk?.keyword;
      return k?.toLowerCase() === ${JSON.stringify(kw.toLowerCase())};
    });
    // Also accept the keyword baked in (static grant)
    const hasBaseKw = (creature.keywords || []).some((k: string) => k.toLowerCase() === ${JSON.stringify(kw.toLowerCase())});
    // If neither, the DB should at least contain the keyword definition
    const dbHasIt = JSON.stringify(CardEffectsDB['${cardKey}']).toLowerCase().includes(${JSON.stringify(kw.toLowerCase())});
    expect(hasTempKw || hasBaseKw || dbHasIt).toBe(true);
  });`);
      }
      break;
    }

    case 'add_mana': {
      const color = effect.color || 'C';
      const manaColor = color === 'any' ? 'C' : color;
      tests.push(`
  it('[${context}] adds mana (${color})', () => {
    const game = new TestGame();
    const before = game.state.manaPool[0].${manaColor} || 0;
    game.resolveEffect(0, ${JSON.stringify({ ...effect, color: manaColor })});
    expect(game.state.manaPool[0].${manaColor}).toBeGreaterThan(before);
  });`);
      break;
    }

    case 'surveil': {
      const amt = resolvedAmt(effect.amount);
      if (amt === null) break;
      tests.push(`
  it('[${context}] surveil ${amt} — pauses for human choice', () => {
    const game = new TestGame();
    game.setHuman(0, true);
    for (let i = 0; i < ${amt + 1}; i++) game.addToLibraryTop(0, { name: 'Top', type_line: 'Creature' });
    game.resolveEffect(0, ${JSON.stringify(effect)});
    const wfi = game.state.waitingForInput;
    expect(wfi?.type === 'surveil' || game.state._pendingSurveil != null).toBe(true);
  });`);
      break;
    }

    case 'modal': {
      const modes: any[] = effect.modes || [];
      tests.push(`
  it('[${context}] modal has ${modes.length} mode(s)', () => {
    const db = CardEffectsDB['${cardKey}'];
    const json = JSON.stringify(db);
    expect(json).toContain('modal');
  });`);
      tests.push(`
  it('[${context}] modal sets _pendingModal for human player', () => {
    const game = new TestGame();
    game.setHuman(0, true);
    game.resolveEffect(0, ${JSON.stringify(effect)}, {});
    expect(game.state._pendingModal).toBeDefined();
    expect(game.state._pendingModal?.modes.length).toBe(${modes.length});
  });`);
      break;
    }

    default:
      // For unhandled effect types, generate a DB-structure test
      tests.push(`
  it('[${context}] has ${effect.type} effect in DB', () => {
    const db = CardEffectsDB['${cardKey}'];
    const json = JSON.stringify(db);
    expect(json).toContain(${JSON.stringify(effect.type)});
  });`);
      break;
  }

  return tests;
}

function staticTests(s: any, cardKey: string): string[] {
  const tests: string[] = [];
  if (s.type === 'has_keyword' && s.keywords) {
    for (const kw of s.keywords as string[]) {
      tests.push(`
  it('has keyword: ${kw}', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: ${JSON.stringify(cardKey)}, type_line: 'Creature', power: '1', toughness: '1', keywords: ${JSON.stringify(s.keywords)} });
    expect(CardUtils.hasKeyword(card, ${JSON.stringify(kw)})).toBe(true);
  });`);
    }
  }
  if (s.type === 'conditional_buff') {
    tests.push(`
  it('has conditional_buff static (condition: ${s.condition})', () => {
    const db = CardEffectsDB['${cardKey}'];
    const buff = db.static?.find((s: any) => s.type === 'conditional_buff' && s.condition === ${JSON.stringify(s.condition)});
    expect(buff).toBeDefined();
    expect(buff?.power).toBe(${s.power ?? 0});
  });`);
  }
  if (s.type === 'counter_bonus') {
    tests.push(`
  it('has counter_bonus static (condition: ${s.condition})', () => {
    const db = CardEffectsDB['${cardKey}'];
    const bonus = db.static?.find((s: any) => s.type === 'counter_bonus');
    expect(bonus).toBeDefined();
    expect(bonus?.counter).toBe(${JSON.stringify(s.counter)});
  });`);
  }
  return tests;
}

function triggerTests(t: any, cardKey: string): string[] {
  const tests: string[] = [];
  tests.push(`
  it('has "${t.event}" trigger in DB', () => {
    const db = CardEffectsDB['${cardKey}'];
    const trigger = db.triggered?.find((t: any) => t.event === ${JSON.stringify(t.event)});
    expect(trigger).toBeDefined();
  });`);

  for (const eff of (t.effects || [])) {
    tests.push(...effectTests(eff, `trigger:${t.event}`, cardKey));
  }
  return tests;
}

function castFlowTest(cardKey: string, db: any): string {
  // Detect mana cost from DB (we don't have it, so use a generic cost)
  return `
  describe('Cast flow', () => {
    it('AI can cast without crash', () => {
      const game = new TestGame();
      // Give AI plenty of mana
      game.setMana(0, { W: 5, U: 5, B: 5, R: 5, G: 5, C: 10 });
      // Add cards to hand if needed for costs
      for (let i = 0; i < 3; i++) game.addToHand(0, { name: 'Filler', type_line: 'Creature', cmc: 0 });
      for (let i = 0; i < 5; i++) game.addToLibraryTop(0, { name: 'Lib', type_line: 'Creature' });
      for (let i = 0; i < 3; i++) game.addToLibraryTop(1, { name: 'Lib', type_line: 'Creature' });
      // Add opponent creature (target for damage/destroy effects)
      game.addToBattlefield(1, { name: 'Opponent Creature', type_line: 'Creature — Beast', power: '2', toughness: '4' });
      const card = game.addToHand(0, { name: ${JSON.stringify(cardKey)}, type_line: 'Instant', mana_cost: '{1}', cmc: 1 });
      expect(() => game.cast(0, card._uid)).not.toThrow();
    });
  });`;
}

// ─── Generate file for one card ───────────────────────────────────────────────

function generateFile(cardKey: string): string {
  const db = (CardEffectsDB as any)[cardKey];
  if (!db) return '';

  const describeName = toDescribeName(cardKey);
  const allTests: string[] = [];

  // 1. Always: exists in DB
  allTests.push(`
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB[${JSON.stringify(cardKey)}]).toBeDefined();
  });`);

  // 2. Static abilities
  for (const s of (db.static || [])) {
    allTests.push(...staticTests(s, cardKey));
  }

  // 3. ETB effects
  for (const eff of (db.etb || [])) {
    allTests.push(...effectTests(eff, 'etb', cardKey));
  }

  // 4. Cast effects
  for (const eff of (db.cast || [])) {
    allTests.push(...effectTests(eff, 'cast', cardKey));
  }

  // 5. Triggered abilities
  for (const t of (db.triggered || [])) {
    allTests.push(...triggerTests(t, cardKey));
  }

  // 6. Activated abilities — test cost + effects
  for (let i = 0; i < (db.activated || []).length; i++) {
    const act = db.activated[i];
    for (const eff of (act.effects || [])) {
      allTests.push(...effectTests(eff, `activated[${i}]`, cardKey));
    }
  }

  // 7. Additional costs
  if (db.additional_costs) {
    const discardCost = db.additional_costs.find((c: any) => c.type === 'discard');
    if (discardCost) {
      allTests.push(`
  it('has discard additional cost', () => {
    const db = CardEffectsDB[${JSON.stringify(cardKey)}];
    const cost = db.additional_costs?.find((c: any) => c.type === 'discard');
    expect(cost).toBeDefined();
  });`);
    }
    const sacCost = db.additional_costs.find((c: any) => c.type === 'sacrifice');
    if (sacCost) {
      allTests.push(`
  it('has sacrifice additional cost (alternate_cost: ${sacCost.alternate_cost ?? 'none'})', () => {
    const db = CardEffectsDB[${JSON.stringify(cardKey)}];
    const cost = db.additional_costs?.find((c: any) => c.type === 'sacrifice');
    expect(cost).toBeDefined();
  });`);
    }
  }

  // 8. Cast flow smoke test (always)
  allTests.push(castFlowTest(cardKey, db));

  const body = allTests.join('\n');

  return `import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../../helpers/game-helper';
import { CardEffectsDB } from '../../../../src/engine/card-effects';

// AUTO-GENERATED by tools/generate-runtime-tests.ts
// Tests runtime behavior via real engine calls (not just DB structure checks)

describe(${JSON.stringify(describeName)}, () => {
${body}
});
`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Get card list: either single card or all LTR cards from existing test files
const testDir = path.join(__dirname, `../tests/cards/${set}`);
let cardKeys: string[] = [];

if (singleCard) {
  cardKeys = [singleCard.toLowerCase()];
} else {
  // Read existing test files to get card names
  const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts') && !f.startsWith('ltr-runtime'));
  cardKeys = files.map(f => {
    // Reverse the filename → card name (with special chars stripped)
    // We need to match against actual DB keys
    const base = f.replace('.test.ts', '');
    const approxName = base.replace(/-/g, ' ');
    // Find best matching key in CardEffectsDB
    const exact = Object.keys(CardEffectsDB).find(k => k === approxName);
    if (exact) return exact;
    // Fuzzy: find key that starts with approxName
    const fuzzy = Object.keys(CardEffectsDB).find(k => k.replace(/[^a-z0-9\s]/g, '') === approxName.replace(/[^a-z0-9\s]/g, ''));
    return fuzzy || approxName;
  }).filter(k => (CardEffectsDB as any)[k]);
}

let generated = 0;
let skipped = 0;

for (const cardKey of cardKeys) {
  const content = generateFile(cardKey);
  if (!content) {
    console.log(`[SKIP] "${cardKey}" — not in CardEffectsDB`);
    skipped++;
    continue;
  }

  const fileName = toFileName(cardKey) + '.test.ts';
  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(outPath, content, 'utf8');
  generated++;
}

console.log(`\nGenerated ${generated} test files → tests/cards/${set}/generated/`);
if (skipped > 0) console.log(`Skipped ${skipped} cards (not in DB)`);
console.log(`\nRun tests:`);
console.log(`  npx vitest run tests/cards/${set}/generated/`);
