// @ts-nocheck
// taigam-master-opportunist.test.ts — BDD tests para Taigam, Master Opportunist (TDM)
// Oracle: "Flurry — Whenever you cast your second spell each turn, copy it, then exile the spell
//          you cast with four time counters on it. If it doesn't have suspend, it gains suspend."

import { describe, it, expect } from 'vitest';
import * as GameState from '../../../src/engine/game-state';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { TestGame, CardDef } from '../../helpers/game-helper';
import {
  runCardTest,
  findScryfallCard,
  assertNoCrash,
  assertGameFinished,
  assertCardOnBattlefield,
} from '../../gameplay/card-test-runner';

// ─── definições de carta ──────────────────────────────────────────────────

const TAIGAM: CardDef = {
  name: 'Taigam, Master Opportunist',
  type_line: 'Legendary Creature — Human Monk',
  mana_cost: '{1}{U}',
  oracle_text: "Flurry — Whenever you cast your second spell each turn, copy it, then exile the spell you cast with four time counters on it. If it doesn't have suspend, it gains suspend.",
  power: '2',
  toughness: '2',
  cmc: 2,
  colors: ['U'],
  color_identity: ['U'],
};

const SIMPLE_INSTANT: CardDef = {
  name: 'Test Instant',
  type_line: 'Instant',
  oracle_text: '',
  mana_cost: '{R}',
  cmc: 1,
  colors: ['R'],
};

const SIMPLE_CREATURE: CardDef = {
  name: 'Test Creature',
  type_line: 'Creature — Human',
  oracle_text: '',
  mana_cost: '{2}{G}',
  power: '2',
  toughness: '2',
  cmc: 3,
  colors: ['G'],
};

// ─── helper ───────────────────────────────────────────────────────────────

function gameWithTaigam() {
  const game = new TestGame({ realETBHooks: true });
  for (let i = 0; i < 10; i++) game.addToLibraryTop(0, SIMPLE_CREATURE);
  for (let i = 0; i < 10; i++) game.addToLibraryTop(1, SIMPLE_CREATURE);
  game.addToBattlefield(0, TAIGAM);
  return game;
}

// ─── testes ──────────────────────────────────────────────────────────────

describe('Taigam, Master Opportunist', () => {

  // ═══════════════════════════════════════════════════════════════════════
  // 1. REGISTRO
  // ═══════════════════════════════════════════════════════════════════════

  describe('registro', () => {
    it('está no CardEffectsDB', () => {
      expect(CardEffectsDB['taigam, master opportunist']).toBeDefined();
    });

    it('tem triggered com event second_spell (Flurry)', () => {
      const entry = CardEffectsDB['taigam, master opportunist'];
      const flurry = entry.triggered?.find((t: any) => t.event === 'second_spell');
      expect(flurry).toBeDefined();
      expect(flurry.mechanic).toBe('flurry');
    });

    it('Flurry tem efeitos copy_last_spell e exile_with_suspend', () => {
      const entry = CardEffectsDB['taigam, master opportunist'];
      const flurry = entry.triggered.find((t: any) => t.event === 'second_spell');
      const types = flurry.effects.map((e: any) => e.type);
      expect(types).toContain('copy_last_spell');
      expect(types).toContain('exile_with_suspend');
    });

    it('exile_with_suspend usa counters: 4 (oracle: "four time counters")', () => {
      const entry = CardEffectsDB['taigam, master opportunist'];
      const flurry = entry.triggered.find((t: any) => t.event === 'second_spell');
      const exileEffect = flurry.effects.find((e: any) => e.type === 'exile_with_suspend');
      expect(exileEffect.counters).toBe(4);
    });

    it('existe no scryfall-tdm.json', () => {
      const sc = findScryfallCard('Taigam, Master Opportunist', 'tdm');
      expect(sc).not.toBeNull();
    });

    it('mana cost é {1}{U}', () => {
      const sc = findScryfallCard('Taigam, Master Opportunist', 'tdm');
      expect(sc.mana_cost).toBe('{1}{U}');
    });

    it('CMC é 2', () => {
      const sc = findScryfallCard('Taigam, Master Opportunist', 'tdm');
      expect(sc.cmc ?? 2).toBe(2);
    });

    it('type_line é Legendary Creature — Human Monk', () => {
      const sc = findScryfallCard('Taigam, Master Opportunist', 'tdm');
      expect(sc.type_line).toContain('Legendary');
      expect(sc.type_line).toContain('Creature');
      expect(sc.type_line).toContain('Human');
      expect(sc.type_line).toContain('Monk');
    });

    it('é 2/2', () => {
      const sc = findScryfallCard('Taigam, Master Opportunist', 'tdm');
      expect(sc.power).toBe('2');
      expect(sc.toughness).toBe('2');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. FLURRY — CONDIÇÃO DE DISPARO
  // ═══════════════════════════════════════════════════════════════════════

  describe('flurry — condição de disparo', () => {
    it('NÃO dispara no 1º feitiço do turno', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 0;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      expect(game.state._spellsThisTurn[0]).toBe(1);
      const exiled = game.state.players[0].zones.exile.cards;
      expect(exiled.filter((c: any) => c._suspended).length).toBe(0);
    });

    it('DISPARA no 2º feitiço do turno', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      expect(game.state._spellsThisTurn[0]).toBe(2);
      const exiled = game.state.players[0].zones.exile.cards;
      expect(exiled.some((c: any) => c._suspended)).toBe(true);
    });

    it('NÃO dispara no 3º feitiço do turno (só "second spell")', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 2;
      game.state.players[0].zones.exile.cards = [];
      game.state._suspendedSpells = {};
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      expect(game.state._spellsThisTurn[0]).toBe(3);
      const exiled = game.state.players[0].zones.exile.cards;
      expect(exiled.filter((c: any) => c._suspended).length).toBe(0);
    });

    it('dispara novamente no 2º feitiço do turno seguinte', () => {
      const game = gameWithTaigam();
      // Turno 1
      game.state._spellsThisTurn[0] = 1;
      const i1 = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, i1._uid);
      const exileT1 = game.state.players[0].zones.exile.cards.filter((c: any) => c._suspended).length;
      expect(exileT1).toBeGreaterThanOrEqual(1);
      // Reset para turno 2
      game.state._spellsThisTurn[0] = 1;
      const i2 = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, i2._uid);
      const exileT2 = game.state.players[0].zones.exile.cards.filter((c: any) => c._suspended).length;
      expect(exileT2).toBeGreaterThan(exileT1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. EFEITO: CÓPIA DO FEITIÇO
  // ═══════════════════════════════════════════════════════════════════════

  describe('cópia do feitiço', () => {
    it('log menciona "Copy of" após Flurry disparar', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      expect(game.state.log.some(l => l.toLowerCase().includes('copy of'))).toBe(true);
    });

    it('cópia de criatura entra no battlefield como token (_isToken: true)', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const creature = game.addToHand(0, SIMPLE_CREATURE);
      game.setMana(0, { G: 1, C: 2 });
      game.cast(0, creature._uid);
      const bf = game.battlefield(0);
      const tokenCopy = bf.find((c: any) => c._isToken && c._isCopy);
      expect(tokenCopy).toBeDefined();
    });

    it('token cópia tem nome contendo "(Copy)"', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const creature = game.addToHand(0, SIMPLE_CREATURE);
      game.setMana(0, { G: 1, C: 2 });
      game.cast(0, creature._uid);
      const bf = game.battlefield(0);
      const tokenCopy = bf.find((c: any) => c._isCopy);
      expect(tokenCopy?.name).toContain('(Copy)');
    });

    it('token cópia tem mesma power/toughness do original', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const creature = game.addToHand(0, SIMPLE_CREATURE);
      game.setMana(0, { G: 1, C: 2 });
      game.cast(0, creature._uid);
      const bf = game.battlefield(0);
      const tokenCopy = bf.find((c: any) => c._isToken && c._isCopy);
      expect(tokenCopy?.power).toBe('2');
      expect(tokenCopy?.toughness).toBe('2');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. EFEITO: EXILE COM SUSPEND
  // ═══════════════════════════════════════════════════════════════════════

  describe('exile com suspend', () => {
    it('feitiço original vai para exile (não fica na GY)', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      const exiled = game.state.players[0].zones.exile.cards;
      expect(exiled.some((c: any) => c.name === 'Test Instant')).toBe(true);
      expect(game.graveyard(0).some((c: any) => c.name === 'Test Instant')).toBe(false);
    });

    it('carta exilada tem _timeCounters: 4 (oracle: "four time counters")', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      const suspended = game.state.players[0].zones.exile.cards.find((c: any) => c._suspended);
      expect(suspended).toBeDefined();
      expect(suspended._timeCounters).toBe(4);
    });

    it('carta exilada tem _suspended: true', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      const suspended = game.state.players[0].zones.exile.cards.find((c: any) => c.name === 'Test Instant');
      expect(suspended?._suspended).toBe(true);
    });

    it('carta exilada é rastreada em _suspendedSpells[0]', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      expect(game.state._suspendedSpells?.[0]?.length).toBeGreaterThanOrEqual(1);
    });

    it('log menciona suspend com 4 contadores', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      const hasLog = game.state.log.some(l => l.toLowerCase().includes('suspend') && l.includes('4'));
      expect(hasLog).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. SUSPEND — CONTAGEM REGRESSIVA NO UPKEEP
  // ═══════════════════════════════════════════════════════════════════════

  describe('suspend — contagem regressiva', () => {
    it('remove 1 time counter por _processSuspendedSpells', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      const suspended = game.state.players[0].zones.exile.cards.find((c: any) => c._suspended);
      expect(suspended._timeCounters).toBe(4);
      GameState._processSuspendedSpells(game.state, 0);
      expect(suspended._timeCounters).toBe(3);
    });

    it('após 3 upkeeps tem 1 counter restante', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      for (let i = 0; i < 3; i++) GameState._processSuspendedSpells(game.state, 0);
      const suspended = game.state.players[0].zones.exile.cards.find((c: any) => c._suspended);
      expect(suspended._timeCounters).toBe(1);
    });

    it('log menciona "contadores restantes" a cada upkeep', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      // _processSuspendedSpells retorna os logs em vez de empurrar ao state.log
      const logs = GameState._processSuspendedSpells(game.state, 0);
      expect(logs.some((l: string) => l.includes('contadores restantes'))).toBe(true);
    });

    it('após 4 upkeeps, carta não está mais em exile como suspended', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      for (let i = 0; i < 4; i++) GameState._processSuspendedSpells(game.state, 0);
      const stillSuspended = game.state.players[0].zones.exile.cards.find(
        (c: any) => c._suspended && c.name === 'Test Instant'
      );
      expect(stillSuspended).toBeUndefined();
    });

    it('log menciona "suspension termina" quando chega a 0 counters', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const instant = game.addToHand(0, SIMPLE_INSTANT);
      game.setMana(0, { R: 1 });
      game.cast(0, instant._uid);
      const allLogs: string[] = [];
      for (let i = 0; i < 4; i++) {
        allLogs.push(...GameState._processSuspendedSpells(game.state, 0));
      }
      expect(allLogs.some(l => l.toLowerCase().includes('suspension termina'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. SUSPEND — CRIATURA GANHA HASTE
  // ═══════════════════════════════════════════════════════════════════════

  describe('suspend — criatura ganha Haste ao ser castada', () => {
    it('criatura castada de suspend tem _suspendHaste ou keyword Haste', () => {
      const game = gameWithTaigam();
      game.state._spellsThisTurn[0] = 1;
      const creature = game.addToHand(0, SIMPLE_CREATURE);
      game.setMana(0, { G: 1, C: 2 });
      game.cast(0, creature._uid);
      // Drena os 4 time counters
      for (let i = 0; i < 4; i++) GameState._processSuspendedSpells(game.state, 0);
      const bf = game.battlefield(0);
      const fromSuspend = bf.find((c: any) => c.name === 'Test Creature' && !c._isCopy);
      expect(fromSuspend).toBeDefined();
      const hasHaste =
        fromSuspend?._suspendHaste === true ||
        fromSuspend?.keywords?.some((k: string) => k.toLowerCase().includes('haste')) ||
        fromSuspend?._tempKeywords?.includes('haste');
      expect(hasHaste).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. INTEGRAÇÃO — PARTIDA COMPLETA
  // ═══════════════════════════════════════════════════════════════════════

  it('não quebra uma partida completa (smoke test)', () => {
    const result = runCardTest({
      cardName: 'Taigam, Master Opportunist',
      setCode: 'tdm',
      copies: 2,
      maxTurns: 25,
      humanOptions: { dontAttack: true }, // Taigam 2/2 morre em trades sem isso
      assertions: [
        assertNoCrash(),
        assertGameFinished(),
        assertCardOnBattlefield('Taigam, Master Opportunist'),
      ],
    });
    expect(result.error).toBeNull();
    for (const a of result.assertions) {
      expect(a.passed, `${a.name}: ${a.actual}`).toBe(true);
    }
  });

});
