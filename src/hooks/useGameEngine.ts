// @ts-nocheck
// useGameEngine.ts — Bridge between the legacy game engine and React UI

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Card } from '../lib/types';
import { VfxManager } from '../components/game/VfxLayer';
import { setVfxBridge } from '../engine/vfx-bridge';

// ── Register VFX bridge so engine can trigger animations ──────────────────
setVfxBridge((type, targetUid) => VfxManager.play(type as any, targetUid));

// ── Lazy import helpers (avoid circular deps) ──────────────────────────────

let _GS: typeof import('../engine/game-state') | null = null;
let _AI: typeof import('../engine/game-ai') | null = null;
let _Combat: typeof import('../engine/combat') | null = null;
let _Cards: typeof import('../engine/cards') | null = null;
let _Mana: typeof import('../engine/mana') | null = null;

async function loadEngine() {
  if (!_GS) _GS = await import('../engine/game-state');
  if (!_AI) _AI = await import('../engine/game-ai');
  if (!_Combat) _Combat = await import('../engine/combat');
  if (!_Cards) _Cards = await import('../engine/cards');
  if (!_Mana) _Mana = await import('../engine/mana');
}

// ── Card conversion: DB Card → GameCard ────────────────────────────────────

function dbCardToGameCard(card: Card, uid: string): any {
  const gc: any = {
    ...card,
    _uid: uid,
    _tapped: false,
    _attacking: false,
    _blocking: null,
    _powerMod: 0,
    _toughnessMod: 0,
    _counters: {},
    _damage: 0,
    _summoningSick: true,
    _tempKeywords: [],
    _triggers: [],
  };
  // The game engine uses card.adventure for adventure/omen face data,
  // but the DB stores it as card.back_face. Normalize here.
  if (card.layout === 'adventure' && (card as any).back_face?.name) {
    gc.adventure = (card as any).back_face;
    // Scryfall stores combined mana_cost "{5}{B} // {1}{B}" for adventure cards.
    // parseCost would sum both faces → wrong CMC. Strip to creature face cost only.
    if (gc.mana_cost && gc.mana_cost.includes('//')) {
      gc.mana_cost = gc.mana_cost.split('//')[0].trim();
    }
  }
  return gc;
}

function deckToGameCards(deck: Card[]): any[] {
  return deck.map((card, i) => dbCardToGameCard(card, `p0-${i}-${card.id}`));
}

function botDeckToGameCards(deck: Card[]): any[] {
  return deck.map((card, i) => dbCardToGameCard(card, `p1-${i}-${card.id}`));
}

// ── Snapshot: extract render-safe data from game state ─────────────────────

function snapshot(gs: any) {
  if (!gs) return null;

  const p0 = gs.players[0];
  const p1 = gs.players[1];

  function zoneCards(zone: any) {
    try { return zone.getAll ? zone.getAll() : []; } catch { return []; }
  }

  // Augment graveyard cards with _graveyardAbilities so the UI can show Renew/Harmonize buttons
  function graveyardCards(zone: any) {
    const cards = zoneCards(zone);
    if (!_Cards) return cards;
    return cards.map((card: any) => {
      const abilities = _Cards!.getGraveyardAbilities(card);
      if (abilities.length > 0) {
        return { ...card, _graveyardAbilities: abilities };
      }
      return card;
    });
  }

  return {
    phase: gs.phase,
    turn: gs.turn,
    activePlayer: gs.activePlayer,
    winner: gs.winner,
    waitingForInput: gs.waitingForInput,
    log: [...(gs.log || [])].slice(-50),
    stackSize: gs.stack?.items?.length ?? 0,
    stackItems: (gs.stack?.items || []).map((item: any) => ({
      cardName: item.card?.name || item.spell?.name || item.type || 'Effect',
      controller: item.controller ?? -1,
      imageUrl: item.card?.image_small || item.card?.image_normal || '',
      typeLine: item.card?.type_line || '',
    })),

    players: [
      {
        id: 0,
        life: p0.life,
        isHuman: true,
        hand: zoneCards(p0.zones.hand),
        battlefield: zoneCards(p0.zones.battlefield),
        graveyard: graveyardCards(p0.zones.graveyard),
        exile: zoneCards(p0.zones.exile),
        libraryCount: p0.zones.library?.count ? p0.zones.library.count() : 0,
        manaPool: gs.manaPool[0] || {},
      },
      {
        id: 1,
        life: p1.life,
        isHuman: false,
        hand: zoneCards(p1.zones.hand),
        battlefield: zoneCards(p1.zones.battlefield),
        graveyard: graveyardCards(p1.zones.graveyard),
        exile: zoneCards(p1.zones.exile),
        libraryCount: p1.zones.library?.count ? p1.zones.library.count() : 0,
        manaPool: gs.manaPool[1] || {},
      },
    ],

    combat: {
      // Normalize attackers to string UIDs (CombatAttackerEntry has {uid,card}, legacy has string)
      attackers: (gs.combat?.attackers || []).map((a: any) => typeof a === 'string' ? a : a.uid),
      // Transform blockers: engine stores { attackerUid: [{uid, card}] }
      // CombatArrows expects { blockerUid: attackerUid }
      blockers: (() => {
        const raw = gs.combat?.blockers || {};
        const mapped: Record<string, string> = {};
        for (const [attackerUid, blockerList] of Object.entries(raw)) {
          if (Array.isArray(blockerList)) {
            for (const b of blockerList as any[]) {
              if (b?.uid) mapped[b.uid] = attackerUid;
            }
          }
        }
        return mapped;
      })(),
    },

    mulliganDone: gs.mulliganDone || [false, false],
    mulliganCount: gs.mulliganCount || [0, 0],

    // Pre-computed set of UIDs for cards the human player can currently play.
    // Uses the engine's getPlayableCards which accounts for cost reductions
    // (e.g., Bell-Ringer's second_spell discount), convoke, adventures, etc.
    // The UI uses this instead of re-computing affordability from raw CMC.
    humanPlayableUids: (() => {
      try {
        if (!_GS || !gs.players[0]) return new Set<string>();
        const playable = _GS.getPlayableCards(gs, 0);
        return new Set<string>(playable.map((c: any) => c._uid));
      } catch { return new Set<string>(); }
    })(),
  };
}

// ── Hook ────────────────────────────────────────────────────────────────────

export interface GameSnapshot {
  phase: string;
  turn: number;
  activePlayer: number;
  winner: number | null;
  waitingForInput: any;
  log: string[];
  stackSize: number;
  players: any[];
  combat: { attackers: string[]; blockers: Record<string, string> };
  mulliganDone: boolean[];
  mulliganCount: number[];
}

export interface GameActions {
  nextPhase(): void;
  castSpell(cardUid: string, targets?: any[]): void;
  castAdventure(cardUid: string, targets?: any[]): void;
  playLand(cardUid: string): void;
  tapLand(cardUid: string): void;
  undoTapLand(): void;
  declareAttacker(cardUid: string, pwUid?: string): void;
  keepHand(bottomCardUids?: string[]): void;
  mulligan(): void;
  resolveChoice(type: string, value: any): void;
  // Interactive overlays
  resolveScry(choices: ('top' | 'bottom' | 'graveyard')[], topOrder?: number[]): void;
  resolveModal(modeIndices: number[]): void;
  resolveChooseTarget(targets: any[]): void;
  resolvePostModalTarget(target: any): void;
  activateGraveyardAbility(cardUid: string, abilityIdx: number): void;
  activateBattlefieldAbility(cardUid: string, abilityIdx: number): void;
  activateFetchLand(cardUid: string): void;

  // Blocking
  declareBlocker(blockerUid: string, attackerUid: string): void;
  unassignBlocker(blockerUid: string): void;
  confirmBlockers(): void;

  // Equipment
  equipCreature(equipmentUid: string, creatureUid: string): void;

  // Activated abilities
  activateLoyaltyAbility(cardUid: string, abilityIdx: number): void;
  activateCycling(cardUid: string): void;
  castHarmonize(cardUid: string, targets?: any[], tappedCreatureUid?: string): void;
  transformCreature(cardUid: string): void;
  activateHideaway(cardUid: string): void;

  // Simple resolve functions
  resolveManaColor(color: string): void;
  resolveEndure(choice: string): void;
  resolveMillLand(choice: string): void;
  resolveBlight(creatureUid: string): void;
  resolveBuffChoiceAction(creatureUid: string): void;
  resolveDistributeCountersAction(creatureUid: string): void;
  resolveHandExile(cardUid: string): void;
  resolvePlayerChoice(chosenPlayerId: number): void;
  resolveTriggerCostAction(choice: string): void;
  resolveUnlessPayAction(shouldPay: boolean): void;

  // Special card effects
  resolveTravelingBotanist(toHand: boolean): void;
  resolveExileChoice(cardUid: string): void;
  resolveLegendaryChoice(choice: 'keep_new' | 'cancel'): void;
  resolveTargetChoiceSingle(uid: string): void;
  resolveBeholdChoice(uid: string | null): void;
  resolveOrderBlockers(): void;
  resolveUnknownInput(): void;

  // Discard overlays
  resolveDiscard(cardUids: string[]): void;
  resolveMandatoryDiscard(cardUids: string[]): void;
  resolveLootDiscard(cardUid: string): void;
  resolveRummage(cardUids: string[]): void;

  // Hideaway land card selection
  resolveHideaway(cardUid: string): void;

  // Search library
  resolveSearchLibrary(cardUid: string | null): void;

  // ETB bounce target choice
  resolveETBBounceTarget(targetUids: string[]): void;

  // tap_creature cost choice
  resolveActivationTapCreature(tappedUid: string | null): void;

  // Ramp choice
  resolveRampChoice(landUid: string, options?: any): void;

  // Clash
  resolveClash(keepOnTop: boolean): void;

  // Look-top choice
  resolveLookTop(choices: string[]): void;

  // Confirm optional
  resolveConfirmOptional(confirmed: boolean): void;

  // Multi-buff choice
  resolveMultiBuffChoiceAction(creatureUids: string[]): void;

  // Sacrifice choice
  resolveSacrifice(cardUid: string | null): void;

  // GY return choice
  resolveGYReturn(cardUids: string[]): void;

  // Graveyard choice (which player's GY to exile from)
  resolveGraveyardChoice(pid: number): void;

  // Graveyard card choice (which specific cards to exile)
  resolveGraveyardCardChoice(cardUids: string[]): void;

  // Restart game with same decks
  restartGame(): void;
}

export function useGameEngine(playerDeck: Card[], botDeck: Card[]) {
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gsRef = useRef<any>(null);
  const aiRunningRef = useRef(false);
  const mountedRef = useRef(true);

  // Pending timers — cleared on unmount to prevent memory leaks
  const pendingTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  function safeTimeout(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      pendingTimers.current.delete(id);
      if (mountedRef.current) fn();
    }, ms);
    pendingTimers.current.add(id);
    return id;
  }

  // Mana undo tracking: stack of { uid, color } for each land tapped this priority
  const tapUndoRef = useRef<Array<{ uid: string; color: string }>>([]);
  const [canUndoMana, setCanUndoMana] = useState(false);

  function clearManaUndo() {
    tapUndoRef.current = [];
    setCanUndoMana(false);
  }

  // Update snapshot (React re-render trigger)
  const refresh = useCallback(() => {
    if (mountedRef.current && gsRef.current) {
      setSnap(snapshot(gsRef.current));
    }
  }, []);

  // AI turn visual delay — actual AI logic runs inside advancePhase (engine-driven)
  // This function only provides a short visual pause so "AI thinking..." shows briefly
  const runAI = useCallback(async (delayMs = 400) => {
    if (aiRunningRef.current || !gsRef.current) return;
    aiRunningRef.current = true;
    await new Promise(r => setTimeout(r, delayMs));
    aiRunningRef.current = false;
    if (mountedRef.current) refresh();
  }, [refresh]);

  // After resolving an interactive overlay, continue phase processing.
  // Replaces the pattern "if (!waitingForInput && !isHuman) runAI()" which
  // only did a visual refresh without actually advancing game state.
  // reprocessCurrentPhase re-runs _processPhase so:
  //   - main1/main2 → restores main_phase waitingForInput for human, or runs AI
  //   - upkeep (with _upkeepProcessed flag) → skips saga/triggers, gives priority, advances
  //   - other phases → continues the current phase from where it paused
  const afterResolve = useCallback((gs: any) => {
    if (!gs.waitingForInput && !gs.winner && _GS) {
      const ap = gs.activePlayer;
      if (!gs.players[ap]?.isHuman) {
        // AI's turn — brief visual delay then continue so "thinking..." shows
        safeTimeout(() => {
          if (!gsRef.current || !_GS) return;
          _GS.reprocessCurrentPhase(gsRef.current);
          refresh();
        }, 300);
      } else {
        // Human's turn — continue immediately (restores main_phase WFI, etc.)
        _GS.reprocessCurrentPhase(gs);
      }
    }
  }, [refresh]);

  // Initialize
  useEffect(() => {
    mountedRef.current = true;

    async function init() {
      try {
        await loadEngine();

        const p0Cards = deckToGameCards(playerDeck);
        const p1Cards = botDeckToGameCards(botDeck);

        const gs = _GS.create(p0Cards, p1Cards);

        // Mark players
        gs.players[0].isHuman = true;
        gs.players[1].isHuman = false;

        // Don't call startGame yet — let mulligan screen handle it.
        // AI auto-mulligans: keep its opening hand immediately
        if (!gs.mulliganDone[1]) {
          _GS.keepHand(gs, 1, []); // AI always keeps opening hand
        }

        // Stay in mulligan phase for human player
        gs.waitingForInput = { type: 'mulligan', playerId: 0 };

        gsRef.current = gs;
        setLoading(false);
        refresh();
      } catch (e: any) {
        console.error('[useGameEngine] Init error:', e);
        setError(e?.message || String(e));
        setLoading(false);
      }
    }

    init();
    return () => {
      mountedRef.current = false;
      // Clear all pending timers to prevent leaks
      for (const id of pendingTimers.current) clearTimeout(id);
      pendingTimers.current.clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──────────────────────────────────────────────────────────────

  // Debounce: prevent rapid Space presses from advancing multiple phases
  let _lastNextPhaseMs = 0;

  const actions: GameActions = {
    nextPhase() {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      // Don't advance during mulligan — handled by keepHand/mulligan actions
      if (gs.phase === 'mulligan') return;
      // Guard: engine trampoline still running — skip
      if ((gs as any)._processingPhases) return;
      // Debounce: ignore if called within 250ms of last call
      const now = Date.now();
      if (now - _lastNextPhaseMs < 250) return;
      _lastNextPhaseMs = now;
      clearManaUndo();
      try {
        const prevWaiting = gs.waitingForInput;
        // Clear waitingForInput so the engine trampoline loop can run _processPhase
        gs.waitingForInput = null;

        // When human confirms attackers (Space in combat_attackers), fire attack triggers
        // and tap attackers before advancing. This mirrors what the AI path does.
        if (prevWaiting?.type === 'declare_attackers' && gs.combat?.attackers?.length > 0) {
          // Tap attacking creatures (unless vigilance) and fire "attacks" + "becomes_tapped" triggers
          for (const entry of gs.combat.attackers) {
            const attacker = (entry as any).card || entry;
            if (!attacker) continue;
            const hasVigilance = (attacker.keywords || []).some((k: string) => k?.toLowerCase() === 'vigilance') ||
              (attacker.oracle_text || '').toLowerCase().includes('vigilance');
            if (!hasVigilance && !attacker._tapped) {
              attacker._tapped = true;
              // Fire becomes_tapped trigger (e.g. Rescue Leopard)
              if (_GS?.fireTrigger) {
                const tapLogs = _GS.fireTrigger(gs, 'becomes_tapped', {
                  cardUid: attacker._uid,
                  card: attacker,
                  controllerId: 0,
                });
                if (tapLogs?.length > 0) gs.log.push(...tapLogs);
              }
            }
            // Mark as tapped-by-attack to prevent double-tap in resetCombatState
            attacker._tappedByAttack = true;
          }
          if (_Combat?.fireAttackTriggers) {
            const triggerLogs = _Combat.fireAttackTriggers(gs.combat, gs, 0);
            gs.log.push(...triggerLogs);
          }
        }

        // For instant_priority windows that are INSIDE a phase (not the phase boundary),
        // re-run the current phase instead of advancing to the next one.
        // e.g. passing priority in combat_damage should resolve damage, not skip to combat_end.
        const MID_PHASE_PRIORITIES = new Set(['post_attackers', 'post_blockers', 'combat_damage']);
        if (
          prevWaiting?.type === 'instant_priority' &&
          MID_PHASE_PRIORITIES.has(prevWaiting.phase) &&
          typeof _GS.reprocessCurrentPhase === 'function'
        ) {
          _GS.reprocessCurrentPhase(gs);
        } else if (prevWaiting?.type === 'stack_priority') {
          // Human passed stack priority — resolve or counter the pending spell
          const pending = (gs as any)._pendingCastOnStack;
          if (pending) {
            // Pop the temporary stack item (pushed during priority gate check)
            if ((gs as any).stack?.items?.length > 0) (gs as any).stack.items.pop();
            delete (gs as any)._pendingCastOnStack;

            if (pending.card._countered) {
              // Spell was countered by human — send to graveyard without resolving
              delete pending.card._countered;
              gs.players[pending.playerId].zones.graveyard.add(pending.card);
              gs.log.push(`${pending.card.name} vai para o cemiterio (anulado).`);
            } else {
              // Spell not countered — resume the cast (skips cost checks)
              (gs as any)._resumingFromStackPriority = true;
              // Temporarily put card back in hand so castSpell can find and remove it
              gs.players[pending.playerId].zones.hand.add(pending.card);
              _GS.castSpell(gs, pending.playerId, pending.card._uid, pending.targets || [], pending.isAdventure || false, pending.isEvoke || false);
            }
          }
          // Reprocess current phase so AI can continue (or human stays in main)
          if (!gs.waitingForInput) {
            _GS.reprocessCurrentPhase(gs);
          }
        } else {
          _GS.advancePhase(gs);
        }
        refresh();
        // If now AI turn, show brief "thinking" state then run AI loop
        const ap = gs.activePlayer;
        if (!gs.players[ap]?.isHuman && !gs.winner) {
          // Refresh once to show "AI thinking..." indicator, then process AI
          safeTimeout(() => {
            if (!gsRef.current || !_GS) return;
            // If engine left the game mid-AI-turn waiting for something, use runAI
            if (gsRef.current.waitingForInput || gsRef.current.players[gsRef.current.activePlayer]?.isHuman === false) {
              runAI(0);
            }
            refresh();
          }, 200);
        }
      } catch (e) {
        console.warn('[nextPhase] error:', e);
        // Force reset any stuck processing state
        if (gsRef.current) {
          gsRef.current._processingPhases = false;
          const ap = gsRef.current.activePlayer;
          if (gsRef.current.players[ap]?.isHuman) {
            gsRef.current.waitingForInput = { type: 'main_phase', playerId: ap };
          }
          refresh();
        }
      }
    },

    castSpell(cardUid: string, targets: any[] = []) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      const pid = 0; // human is always player 0
      try {
        const hand = gs.players[pid].zones.hand.getAll();
        const card = hand.find((c: any) => c._uid === cardUid);
        if (!card) return;

        // Compute effective mana cost (conditional cost like Dragon's Prey +{2} for dragons)
        let tapCost = card.mana_cost;
        // For hybrid costs, use the minimum viable CMC (parseCost.total) rather than Scryfall CMC.
        // e.g. {2/W}{2/B}{2/G}: Scryfall cmc=6 but minimum payment is 3 (one colored per hybrid).
        let tapCmc = card.cmc;
        if (_Mana && tapCost) {
          const _parsedForHybrid = _Mana.parseCost(tapCost);
          if (_parsedForHybrid.hybrids && _parsedForHybrid.hybrids.length > 0) {
            tapCmc = _parsedForHybrid.total; // hybrid minimum
          }
        }
        if (_Cards && _Mana && targets && targets.length > 0) {
          const t0 = targets[0];
          const targetPlayer = gs.players[t0.player];
          if (targetPlayer) {
            const targetCard = targetPlayer.zones.battlefield.get(t0.uid);
            if (targetCard) {
              const eff = _Cards.getEffectiveManaCost(card, targetCard);
              if (eff && eff !== card.mana_cost) {
                tapCost = eff;
                tapCmc = _Mana.parseCost(eff).total || card.cmc;
              }
            }
          }
        }
        // Pre-tap color check: build the available pool from untapped lands + current pool,
        // then verify colors can be met BEFORE tapping anything. This prevents lands from
        // being tapped uselessly when the color requirement can't be met.
        if (tapCost && tapCmc > 0 && _Mana) {
          const bf = gs.players[pid].zones.battlefield;
          const availPool: Record<string, number> = { ...(gs.manaPool[pid] || {}) };
          bf.cards
            .filter((c: any) => (c.type_line || '').toLowerCase().includes('land') && !c._tapped)
            .forEach((land: any) => {
              const colors = _Mana.getLandManaColors(land);
              colors.forEach((color: string) => { availPool[color] = (availPool[color] || 0) + 1; });
            });
          if (!_Mana.canPay(availPool, tapCost, tapCmc)) {
            // Can't afford — abort without tapping anything
            refresh();
            return;
          }
        }

        // Use the real auto-tap system (handles colored mana, convoke, etc.)
        if (tapCost && tapCmc > 0) {
          _GS.autoTapForSpell(gs, pid, tapCost, tapCmc);
        }

        const result = _GS.castSpell(gs, pid, cardUid, targets);
        // Clear mana undo when spell successfully starts casting
        if (result?.success !== false) clearManaUndo();

        // Auto-resolve stack priority after casting a counter spell.
        // When the human casts a counter during stack_priority, the counter resolves
        // immediately (marking _countered=true). Without this, the human would need to
        // manually click "Let Resolve" — which is confusing and non-obvious.
        const pending = (gs as any)._pendingCastOnStack;
        if (
          pending?.card?._countered === true &&
          gs.waitingForInput?.type === 'stack_priority'
        ) {
          // Pop the temporary stack item and clear pending
          if ((gs as any).stack?.items?.length > 0) (gs as any).stack.items.pop();
          delete (gs as any)._pendingCastOnStack;
          delete pending.card._countered;
          // Send countered spell to graveyard
          gs.players[pending.playerId].zones.graveyard.add(pending.card);
          gs.log.push(`${pending.card.name} vai para o cemiterio (anulado).`);
          // Continue game processing
          if (typeof _GS.reprocessCurrentPhase === 'function') {
            _GS.reprocessCurrentPhase(gs);
          }
        }

        refresh();
      } catch (e) {
        console.warn('[castSpell] error:', e);
      }
    },

    // Cast as adventure/omen mode (5th param castingAdventure = true)
    castAdventure(cardUid: string, targets: any[] = []) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      const pid = 0;
      try {
        const hand = gs.players[pid].zones.hand.getAll();
        const card = hand.find((c: any) => c._uid === cardUid);
        if (!card) return;

        // Tap mana for the adventure cost (not the creature cost)
        // Pass cmc=undefined so autoTapForSpell uses parseCost(manaCost) directly
        // (passing cmc=0 would incorrectly reduce the cost to 0)
        // Adventure/omen data is stored in card.back_face (not card.adventure)
        const advCost = card.back_face?.mana_cost ?? card.adventure?.mana_cost ?? '';
        if (advCost && _Mana) {
          // Pre-tap color check — build available pool, verify colors before tapping
          const bf = gs.players[pid].zones.battlefield;
          const advPool: Record<string, number> = { ...(gs.manaPool[pid] || {}) };
          bf.cards
            .filter((c: any) => (c.type_line || '').toLowerCase().includes('land') && !c._tapped)
            .forEach((land: any) => {
              const colors = _Mana.getLandManaColors(land);
              colors.forEach((color: string) => { advPool[color] = (advPool[color] || 0) + 1; });
            });
          const advCmc = _Mana.parseCost(advCost).total || 0;
          if (!_Mana.canPay(advPool, advCost, advCmc)) { refresh(); return; }
          _GS.autoTapForSpell(gs, pid, advCost, undefined);
        }

        // castSpell(state, pid, uid, targets, castingAdventure, castingEvoke)
        _GS.castSpell(gs, pid, cardUid, targets, true);
        clearManaUndo();
        refresh();
      } catch (e) {
        console.warn('[castAdventure] error:', e);
      }
    },

    playLand(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.playLand(gs, 0, cardUid);
        clearManaUndo();
        refresh();
      } catch (e) {
        console.warn('[playLand] error:', e);
      }
    },

    tapLand(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS || !_Mana) return;
      // Don't tap if any overlay is already waiting (e.g. mana_color_choice for another land)
      if (gs.waitingForInput && gs.waitingForInput.type !== 'main_phase' && gs.waitingForInput.type !== 'declare_attackers') return;
      try {
        const card = gs.players[0].zones.battlefield.get(cardUid);
        if (!card || card._tapped) return;

        const colors = _Mana.getLandManaColors(card);
        if (colors.length > 1) {
          // Dual/multi-color land — show color picker overlay
          gs._pendingManaChoice = { colors, controllerId: 0, cardUid, tapLand: true };
          gs.waitingForInput = { type: 'mana_color_choice', playerId: 0 };
          refresh();
          return;
        }

        // Single color — tap normally
        const prevPool = { ...gs.manaPool[0] };
        const tapped = _GS.tapLandForMana(gs, 0, cardUid);
        if (tapped) {
          let addedColor = 'C';
          for (const [c, v] of Object.entries(gs.manaPool[0] as Record<string, number>)) {
            if (v > (prevPool[c] || 0)) { addedColor = c; break; }
          }
          tapUndoRef.current.push({ uid: cardUid, color: addedColor });
          setCanUndoMana(true);
        }
        refresh();
      } catch (e) {
        console.warn('[tapLand] error:', e);
      }
    },

    undoTapLand() {
      const gs = gsRef.current;
      if (!gs || tapUndoRef.current.length === 0) return;
      const entry = tapUndoRef.current.pop();
      if (entry) {
        try {
          const card = gs.players[0].zones.battlefield.get(entry.uid);
          if (card) card._tapped = false;
          const pool = gs.manaPool[0];
          if (pool[entry.color] > 0) pool[entry.color]--;
        } catch (e) {
          console.warn('[undoTapLand] error:', e);
        }
      }
      setCanUndoMana(tapUndoRef.current.length > 0);
      refresh();
    },

    declareAttacker(cardUid: string, pwUid?: string) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const bf = gs.players[0].zones.battlefield.getAll();
        const card = bf.find((c: any) => c._uid === cardUid);
        if (!card) return;
        if (card._attacking) {
          // Remove attacker — filter by uid on the CombatAttackerEntry object
          card._attacking = false;
          gs.combat.attackers = gs.combat.attackers.filter((a: any) =>
            typeof a === 'string' ? a !== cardUid : a.uid !== cardUid
          );
        } else {
          // Only allow attack if not tapped and not summoning sick (haste bypasses sick)
          const hasHaste = card._tempKeywords?.includes('Haste') ||
            (card.keywords || []).some((k: string) => k?.toLowerCase() === 'haste') ||
            (card.oracle_text || '').toLowerCase().includes('haste');
          if (!card._tapped && (!card._summoningSick || hasHaste)) {
            card._attacking = true;
            if (!gs.combat.attackers) gs.combat.attackers = [];
            // Push CombatAttackerEntry — include attackTarget if attacking a planeswalker
            const entry: any = { uid: cardUid, card };
            if (pwUid) entry.attackTarget = pwUid;
            gs.combat.attackers.push(entry);
          }
        }
        refresh();
      } catch (e) {
        console.warn('[declareAttacker] error:', e);
      }
    },

    keepHand(bottomCardUids: string[] = []) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.keepHand(gs, 0, bottomCardUids);
        // AI mulligan is already resolved in create(), so start the game
        // If somehow AI hasn't kept yet, let it decide now
        if (!gs.mulliganDone[1]) {
          _GS.keepHand(gs, 1, []);
        }
        // Both players have kept — start the actual game
        _GS.startGame(gs);
        refresh();
        // If AI goes first, trigger AI turn
        const ap = gs.activePlayer;
        if (!gs.players[ap]?.isHuman) {
          safeTimeout(() => runAI(), 600);
        }
      } catch (e) {
        console.warn('[keepHand] error:', e);
      }
    },

    mulligan() {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.mulligan(gs, 0);
        refresh();
      } catch (e) {
        console.warn('[mulligan] error:', e);
      }
    },

    resolveChoice(type: string, value: any) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (type === 'scry') {
          gs._pendingScry = null;
          gs.waitingForInput = null;
        } else if (type === 'blight') {
          _GS.resolveBlightChoice(gs, value);
        } else if (type === 'buff') {
          _GS.resolveBuffChoice(gs, value);
        } else if (type === 'mana') {
          _GS.resolveManaChoice(gs, value);
        } else if (type === 'unlessPay') {
          _GS.resolveUnlessPay(gs, value);
        } else if (type === 'handExile') {
          _GS.resolveHandExileChoice(gs, value);
        }
        gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) {
        console.warn('[resolveChoice] error:', e);
      }
    },

    resolveScry(choices: ('top' | 'bottom' | 'graveyard')[], topOrder?: number[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveScry(gs, choices, topOrder);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveScry] error:', e); }
    },

    resolveModal(modeIndices: number[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveModal(gs, modeIndices);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveModal] error:', e); }
    },

    resolveChooseTarget(targets: any[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveChooseTarget(gs, targets);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveChooseTarget] error:', e); }
    },

    resolvePostModalTarget(target: any) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolvePostModalTarget(gs, target);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolvePostModalTarget] error:', e); }
    },

    activateGraveyardAbility(cardUid: string, abilityIdx: number) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.activateGraveyardAbility === 'function') {
          _GS.activateGraveyardAbility(gs, 0, cardUid, abilityIdx);
          afterResolve(gs);
          refresh();
        }
      } catch (e) { console.warn('[activateGraveyardAbility] error:', e); }
    },

    activateBattlefieldAbility(cardUid: string, abilityIdx: number) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.activateBattlefieldAbility === 'function') {
          _GS.activateBattlefieldAbility(gs, 0, cardUid, abilityIdx);
        } else {
          // Fallback: use the same logic as AI activated abilities
          console.warn('[activateBattlefieldAbility] function not found in game-state');
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[activateBattlefieldAbility] error:', e); }
    },

    // Sacrifice fetchland (Evolving Wilds, Terramorphic Expanse, etc.)
    // Sacrifices the land and opens a search-library overlay for basic lands
    activateFetchLand(cardUid: string) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const bf = gs.players[0].zones.battlefield;
        const gy = gs.players[0].zones.graveyard;

        // Get the land before removing it
        const land = typeof bf.get === 'function' ? bf.get(cardUid) : null;
        if (!land) return;

        // Sacrifice: remove from battlefield, add to graveyard
        if (typeof bf.remove === 'function') bf.remove(cardUid);
        if (typeof gy.add === 'function') gy.add(land);
        gs.log.push(`Voce sacrifica ${land.name}.`);

        // Find all basic lands in library
        const lib = gs.players[0].zones.library;
        const allLibCards: any[] = typeof lib.getAll === 'function' ? lib.getAll() : ((lib as any).cards || []);
        const basicLands = allLibCards.filter((c: any) =>
          c.type_line && c.type_line.includes('Basic Land')
        );

        if (basicLands.length === 0) {
          gs.log.push('Nenhum terreno basico na biblioteca.');
          gs.waitingForInput = null;
          refresh();
          return;
        }

        // Deduplicate by name for display
        const seen = new Set<string>();
        const unique = basicLands.filter((c: any) => {
          if (seen.has(c.name)) return false;
          seen.add(c.name);
          return true;
        });

        gs._pendingRamp = {
          playerId: 0,
          lands: unique,
          toBattlefield: true, // put onto battlefield tapped (Evolving Wilds behavior)
        };
        gs.waitingForInput = { type: 'ramp_choice', playerId: 0 };
        refresh();
      } catch (e) { console.warn('[activateFetchLand] error:', e); }
    },

    // ── Blocking ────────────────────────────────────────────────────────────

    declareBlocker(blockerUid: string, attackerUid: string) {
      const gs = gsRef.current;
      if (!gs) return;
      if (!gs.combat.blockers) gs.combat.blockers = {};
      const bf = gs.players[0].zones.battlefield.getAll();
      const blocker = bf.find((c: any) => c._uid === blockerUid);
      if (!blocker) return;

      // First remove this blocker from any attacker they're already blocking
      // (prevents one creature blocking two attackers)
      for (const atkUid of Object.keys(gs.combat.blockers)) {
        gs.combat.blockers[atkUid] = gs.combat.blockers[atkUid].filter(
          (b: any) => b.uid !== blockerUid
        );
      }

      // Check Menace: attacker with Menace needs 2+ blockers — allow assignment but warn later
      blocker._blocking = attackerUid;
      if (!gs.combat.blockers[attackerUid]) gs.combat.blockers[attackerUid] = [];
      const already = gs.combat.blockers[attackerUid].some((b: any) => b.uid === blockerUid);
      if (!already) gs.combat.blockers[attackerUid].push({ uid: blockerUid, card: blocker });
      refresh();
    },

    unassignBlocker(blockerUid: string) {
      const gs = gsRef.current;
      if (!gs) return;
      // Remove this blocker from all attacker entries
      if (gs.combat.blockers) {
        for (const attackerUid of Object.keys(gs.combat.blockers)) {
          gs.combat.blockers[attackerUid] = gs.combat.blockers[attackerUid].filter(
            (b: any) => b.uid !== blockerUid
          );
        }
      }
      const bf = gs.players[0].zones.battlefield.getAll();
      const blocker = bf.find((c: any) => c._uid === blockerUid);
      if (blocker) blocker._blocking = null;
      refresh();
    },

    confirmBlockers() {
      const gs = gsRef.current;
      if (!gs || !_GS) return;

      // Validate Menace: attacker with Menace can only be blocked by 2+ creatures.
      // If exactly 1 blocker assigned to a Menace attacker, remove that block (it's illegal).
      if (gs.combat?.blockers && _Cards) {
        const attackersBf = gs.players[gs.activePlayer].zones.battlefield.getAll();
        for (const entry of (gs.combat.attackers || [])) {
          const attackerCard = attackersBf.find((c: any) => c._uid === (entry.uid || entry));
          if (!attackerCard) continue;
          const hasMenace = (_Cards.hasKeyword as any)(attackerCard, 'Menace');
          if (!hasMenace) continue;
          const blockerList = gs.combat.blockers[attackerCard._uid] || [];
          if (blockerList.length === 1) {
            // Illegal: menace requires 2+ blockers. Remove the single blocker.
            const singleBlocker = blockerList[0]?.card;
            if (singleBlocker) singleBlocker._blocking = null;
            gs.combat.blockers[attackerCard._uid] = [];
            gs.log.push(`Blqueio invalido! ${attackerCard.name} tem Menace e precisa de 2+ bloqueadores. Bloqueio removido.`);
          }
        }
      }

      gs.waitingForInput = null;
      try { _GS.advancePhase(gs); } catch (e) { console.warn('[confirmBlockers]', e); }
      refresh();
      const ap = gs.activePlayer;
      if (!gs.players[ap]?.isHuman) safeTimeout(() => runAI(), 300);
    },

    // ── Activated abilities ─────────────────────────────────────────────────

    activateLoyaltyAbility(cardUid: string, abilityIdx: number) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.activateLoyaltyAbility(gs, 0, cardUid, abilityIdx);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[activateLoyaltyAbility]', e); }
    },

    activateCycling(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.activateCycling(gs, 0, cardUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[activateCycling]', e); }
    },

    castHarmonize(cardUid: string, targets: any[] = [], tappedCreatureUid?: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.castHarmonize(gs, 0, cardUid, targets, tappedCreatureUid || null);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[castHarmonize]', e); }
    },

    transformCreature(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.transformCreature(gs, 0, cardUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[transformCreature]', e); }
    },

    activateHideaway(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        const result = _GS.activateHideaway(gs, 0, cardUid);
        if (!result?.success) console.warn('[activateHideaway] failed:', result?.msg);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[activateHideaway]', e); }
    },

    // ── Equipment ────────────────────────────────────────────────────────────

    equipCreature(equipmentUid: string, creatureUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.equipCreature(gs, 0, equipmentUid, creatureUid);
        refresh();
      } catch (e) { console.warn('[equipCreature]', e); }
    },

    // ── Simple resolve functions ────────────────────────────────────────────

    resolveManaColor(color: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        // Capture dual-land-tap info before resolveManaChoice clears _pendingManaChoice
        const pendingChoice = gs._pendingManaChoice;
        const isTapLand = pendingChoice?.tapLand === true;
        const tapCardUid = pendingChoice?.cardUid;

        _GS.resolveManaChoice(gs, color);
        gs.waitingForInput = null;

        // Track undo entry for dual land taps
        if (isTapLand && tapCardUid) {
          tapUndoRef.current.push({ uid: tapCardUid, color });
          setCanUndoMana(true);
        }

        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveManaColor] error:', e); }
    },

    resolveEndure(choice: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveEndureChoice(gs, choice as 'counters' | 'tokens');
        gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveEndure] error:', e); }
    },

    resolveMillLand(choice: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveMillLandChoice(gs, choice as 'land' | 'counter');
        gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveMillLand] error:', e); }
    },

    resolveBlight(creatureUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveBlightChoice(gs, creatureUid);
        gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveBlight] error:', e); }
    },

    resolveBuffChoiceAction(creatureUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveBuffChoice(gs, creatureUid);
        gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveBuffChoiceAction] error:', e); }
    },

    resolveDistributeCountersAction(creatureUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveDistributeCounters(gs, creatureUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveDistributeCounters] error:', e); }
    },

    resolveHandExile(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveHandExileChoice(gs, cardUid);
        gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveHandExile] error:', e); }
    },

    resolvePlayerChoice(chosenPlayerId: number) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolvePlayerChoice(gs, chosenPlayerId);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolvePlayerChoice] error:', e); }
    },

    resolveTriggerCostAction(choice: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveTriggerCost(gs, choice as 'pay' | 'skip');
        gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveTriggerCostAction] error:', e); }
    },

    resolveUnlessPayAction(shouldPay: boolean) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveUnlessPay(gs, shouldPay);
        gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveUnlessPayAction] error:', e); }
    },

    // Traveling Botanist: player chose to put land in hand or graveyard
    resolveTravelingBotanist(toHand: boolean) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const pending = gs._pendingTravelingBotanist;
        if (pending?.card) {
          if (toHand) {
            gs.players[0].zones.hand.add(pending.card);
            gs.log.push(`Revela ${pending.card.name} e coloca na mao.`);
          } else {
            gs.players[0].zones.graveyard.add(pending.card);
            gs.log.push(`Envia ${pending.card.name} ao cemiterio.`);
          }
        }
        gs._pendingTravelingBotanist = null;
        gs.waitingForInput = null;
        if (typeof _GS?.reprocessCurrentPhase === 'function') {
          _GS.reprocessCurrentPhase(gs);
        }
        refresh();
      } catch (e) { console.warn('[resolveTravelingBotanist] error:', e); }
    },

    // Generic fallback for unhandled waitingForInput types — clears and continues
    resolveExileChoice(cardUid: string) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        if (typeof (_GS as any)?.submitExileChoice === 'function') {
          (_GS as any).submitExileChoice(gs, 0, [cardUid]);
        } else {
          // fallback: clear waitingForInput
          gs.waitingForInput = null;
          if (typeof _GS?.reprocessCurrentPhase === 'function') _GS.reprocessCurrentPhase(gs);
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveExileChoice] error:', e); }
    },

    // ── Legendary rule: player chooses to cast new (sacrificing existing) or cancel ──
    resolveLegendaryChoice(choice: 'keep_new' | 'cancel') {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const pending = (gs as any)._pendingLegendaryChoice;
        if (!pending) return;
        gs.waitingForInput = null;
        delete (gs as any)._pendingLegendaryChoice;
        if (choice === 'keep_new') {
          // Resume the cast with legendary check skipped
          (gs as any)._skipLegendaryCheck = true;
          if (typeof (_GS as any)?.castSpell === 'function') {
            (_GS as any).castSpell(
              gs, 0,
              pending.cardUid,
              pending.targets || [],
              pending.castingAdventure || false,
              pending.castingEvoke || false,
              false,
              pending.useCost,
              pending.useCmc,
              pending.fromExile || false
            );
          }
          (gs as any)._skipLegendaryCheck = false;
        } else {
          gs.log.push(`Cancelou conjuração de ${pending.cardToCast?.name}.`);
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveLegendaryChoice]', e); }
    },

    // ── target_choice_single: pick one creature from pending targets ──
    resolveTargetChoiceSingle(uid: string) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const pending = (gs as any)._pendingTargetChoice;
        if (!pending) return;
        gs.waitingForInput = null;
        delete (gs as any)._pendingTargetChoice;
        if (uid) {
          const bf0 = gs.players[0].zones.battlefield.getAll();
          const bf1 = gs.players[1].zones.battlefield.getAll();
          const target = [...bf0, ...bf1].find((c: any) => c._uid === uid);
          if (target) {
            if (pending.effectType === 'tap') target._tapped = true;
            gs.log.push(`Escolheu ${target.name}.`);
          }
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveTargetChoiceSingle]', e); }
    },

    // ── behold_choice: player reveals a dragon from hand ──
    resolveBeholdChoice(uid: string | null) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const pending = (gs as any)._pendingBeholdChoice;
        gs.waitingForInput = null;
        delete (gs as any)._pendingBeholdChoice;
        if (uid && pending) {
          const hand = gs.players[0].zones.hand.getAll();
          const card = hand.find((c: any) => c._uid === uid);
          if (card) {
            if (!(gs as any)._beholding) (gs as any)._beholding = [null, null];
            (gs as any)._beholding[0] = card;
            gs.log.push(`${card.name} revelado (behold).`);
          }
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveBeholdChoice]', e); }
    },

    // ── order_blockers: auto-resolve using AI order ──
    resolveOrderBlockers() {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        if (typeof (_GS as any)?.orderBlockers === 'function') {
          (_GS as any).orderBlockers(gs, 0); // Use AI heuristic for ordering
        }
        if (gs.combat) gs.combat._blockerOrderDone = true;
        gs.waitingForInput = null;
        if (typeof _GS?.reprocessCurrentPhase === 'function') _GS.reprocessCurrentPhase(gs);
        refresh();
      } catch (e) { console.warn('[resolveOrderBlockers]', e); }
    },

    resolveUnknownInput() {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveUnknownInput] error:', e); }
    },

    // ── Discard overlays ────────────────────────────────────────────────────

    resolveDiscard(cardUids: string[]) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const hand = gs.players[0].zones.hand;
        const gy = gs.players[0].zones.graveyard;
        const pending = gs._pendingOptionalDiscard;
        const drawOnDiscard = pending?.drawOnDiscard;
        const returnFromGY = pending?.returnFromGY;
        const returnTarget = pending?.returnTarget || 'creature_or_land';
        const discarded = cardUids.length > 0;
        cardUids.forEach((uid: string) => {
          const cards = hand.getAll();
          const card = cards.find((c: any) => c._uid === uid);
          if (card) {
            if (typeof hand.remove === 'function') hand.remove(card._uid);
            if (typeof gy.add === 'function') gy.add(card);
            gs.log.push(`Voce descarta ${card.name}.`);
          }
        });
        // If this was an optional_discard_choice with drawOnDiscard (Rescue Leopard), draw a card
        if (drawOnDiscard && discarded) {
          const drawn = gs.players[0].zones.library.drawFromTop();
          if (drawn) {
            gs.players[0].zones.hand.add(drawn);
            gs.log.push(`Voce compra ${drawn.name}.`);
          }
        }
        gs._pendingOptionalDiscard = null;
        // Glacial Dragonhunt: after discarding a nonland, resolve bonus effects
        const onNonlandDiscard = pending?.onNonlandDiscard;
        if (discarded && onNonlandDiscard?.length > 0) {
          const gy = gs.players[0].zones.graveyard;
          const justDiscarded = cardUids.map((uid: string) => gy.getAll().find((c: any) => c._uid === uid)).filter(Boolean);
          const anyNonland = justDiscarded.some((c: any) => !(c.type_line || '').includes('Land'));
          if (anyNonland && typeof _GS?.resolveOnNonlandDiscard === 'function') {
            _GS.resolveOnNonlandDiscard(gs, onNonlandDiscard, 0);
          }
        }
        // Awaken the Honored Dead Chapter III: after discard, offer GY return choice
        if (returnFromGY && discarded) {
          const gyCards = gy.getAll ? gy.getAll() : [];
          const candidates = gyCards.filter((c: any) => {
            if (returnTarget === 'creature_or_land') {
              return (c.type_line || '').includes('Creature') || (c.type_line || '').includes('Land');
            }
            return (c.type_line || '').includes('Creature');
          });
          if (candidates.length > 0) {
            gs._pendingGYReturn = { candidates, amount: 1, toHand: true, controller: 0, effect: {} };
            gs.waitingForInput = { type: 'choose_gy_return', playerId: 0, optional: false };
            refresh();
            return; // Wait for GY pick overlay
          }
        }
        gs.waitingForInput = null;
        // Re-run cleanup phase to call _endOfTurnCleanup + advance
        if (typeof _GS?.reprocessCurrentPhase === 'function') {
          _GS.reprocessCurrentPhase(gs);
        }
        refresh();
      } catch (e) { console.warn('[resolveDiscard] error:', e); }
    },

    resolveMandatoryDiscard(cardUids: string[]) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        // Delegate to engine which handles targetPlayer, up_to/optional flags, and _pendingStackEffects
        if (typeof _GS?.resolveMandatoryDiscard === 'function') {
          _GS.resolveMandatoryDiscard(gs, cardUids);
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveMandatoryDiscard] error:', e); }
    },

    resolveLootDiscard(cardUid: string) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const hand = gs.players[0].zones.hand;
        const gy = gs.players[0].zones.graveyard;
        const cards = hand.getAll();
        const card = cards.find((c: any) => c._uid === cardUid);
        if (card) {
          if (typeof hand.remove === 'function') hand.remove(card._uid); // uid string, not object
          if (typeof gy.add === 'function') gy.add(card);
          gs.log.push(`Voce descarta ${card.name}.`);
        }
        gs.waitingForInput = null;
        if (typeof _GS?.reprocessCurrentPhase === 'function') {
          _GS.reprocessCurrentPhase(gs);
        }
        refresh();
      } catch (e) { console.warn('[resolveLootDiscard] error:', e); }
    },

    resolveRummage(cardUids: string[]) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const hand = gs.players[0].zones.hand;
        const gy = gs.players[0].zones.graveyard;
        cardUids.forEach((uid: string) => {
          const cards = hand.getAll();
          const card = cards.find((c: any) => c._uid === uid);
          if (card) {
            if (typeof hand.remove === 'function') hand.remove(card._uid); // uid string, not object
            if (typeof gy.add === 'function') gy.add(card);
            gs.log.push(`Voce descarta ${card.name}.`);
          }
        });
        gs.waitingForInput = null;
        if (typeof _GS?.reprocessCurrentPhase === 'function') {
          _GS.reprocessCurrentPhase(gs);
        }
        refresh();
      } catch (e) { console.warn('[resolveRummage] error:', e); }
    },

    // ── Hideaway selection ───────────────────────────────────────────────────

    resolveHideaway(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveHideaway === 'function') {
          _GS.resolveHideaway(gs, cardUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveHideaway]', e); }
    },

    // ── ETB bounce target (human chose which permanent to bounce) ────────────

    resolveETBBounceTarget(targetUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveETBBounceTarget === 'function') {
          _GS.resolveETBBounceTarget(gs, targetUids);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveETBBounceTarget]', e); }
    },

    // ── tap_creature cost resolution (human chose which creature to tap) ─────

    resolveActivationTapCreature(tappedUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveActivationTapCreature === 'function') {
          _GS.resolveActivationTapCreature(gs, tappedUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveActivationTapCreature]', e); }
    },

    // ── Search library ──────────────────────────────────────────────────────

    resolveSearchLibrary(cardUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveSearchLibrary === 'function') {
          _GS.resolveSearchLibrary(gs, cardUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveSearchLibrary]', e); }
    },

    // ── Ramp choice ─────────────────────────────────────────────────────────

    resolveRampChoice(landUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveRampChoice === 'function') {
          _GS.resolveRampChoice(gs, landUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveRampChoice]', e); }
    },

    // ── Clash ───────────────────────────────────────────────────────────────

    resolveClash(keepOnTop: boolean) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveClash === 'function') {
          _GS.resolveClash(gs, keepOnTop);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveClash]', e); }
    },

    // ── Look-top choice ─────────────────────────────────────────────────────

    resolveLookTop(choices: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveLookTop === 'function') {
          _GS.resolveLookTop(gs, choices);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveLookTop]', e); }
    },

    // ── Confirm optional ────────────────────────────────────────────────────

    resolveConfirmOptional(confirmed: boolean) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveConfirmOptional === 'function') {
          _GS.resolveConfirmOptional(gs, confirmed);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveConfirmOptional]', e); }
    },

    // ── Multi-buff choice ───────────────────────────────────────────────────

    resolveMultiBuffChoiceAction(creatureUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (gs._pendingMultiBuffChoice) {
          gs._pendingMultiBuffChoice.selected = creatureUids;
        }
        _GS.resolveMultiBuffChoice(gs);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveMultiBuffChoice]', e); }
    },

    // ── Sacrifice choice ────────────────────────────────────────────────────

    resolveSacrifice(cardUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveSacrifice === 'function') {
          _GS.resolveSacrifice(gs, cardUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveSacrifice]', e); }
    },

    // ── GY return choice ────────────────────────────────────────────────────

    resolveGYReturn(cardUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveGYReturn === 'function') {
          _GS.resolveGYReturn(gs, cardUids);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGYReturn]', e); }
    },

    // ── Graveyard choice (which GY to exile from) ───────────────────────────

    resolveGraveyardChoice(pid: number) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveGraveyardChoice === 'function') {
          _GS.resolveGraveyardChoice(gs, pid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGraveyardChoice]', e); }
    },

    // ── Graveyard card choice ───────────────────────────────────────────────

    resolveGraveyardCardChoice(cardUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveGraveyardCardChoice === 'function') {
          _GS.resolveGraveyardCardChoice(gs, cardUids);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGraveyardCardChoice]', e); }
    },

    restartGame() {
      if (!_GS) return;
      try {
        aiRunningRef.current = false;
        clearManaUndo();
        const p0Cards = deckToGameCards(playerDeck);
        const p1Cards = botDeckToGameCards(botDeck);
        const gs = _GS.create(p0Cards, p1Cards);
        gs.players[0].isHuman = true;
        gs.players[1].isHuman = false;
        if (!gs.mulliganDone[1]) {
          _GS.keepHand(gs, 1, []);
        }
        gs.waitingForInput = { type: 'mulligan', playerId: 0 };
        gsRef.current = gs;
        refresh();
      } catch (e) { console.warn('[restartGame]', e); }
    },
  };

  return { snap, loading, error, actions, gsRef, canUndoMana };
}
