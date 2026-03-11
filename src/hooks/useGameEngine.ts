// @ts-nocheck
// useGameEngine.ts — Bridge between the legacy game engine and React UI

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Card } from '../lib/types';
import { VfxManager, TRAVEL_MS } from '../components/game/VfxLayer';
import { setVfxBridge, setVfxTextBridge, setCombatVfxBridge } from '../engine/vfx-bridge';
import { aiBrain } from '../engine/ai-brain';
import { SoundManager } from '../engine/sound-manager';

// ── Register VFX bridges so engine can trigger animations ─────────────────

// Combat: sequential, one pair at a time with Arena-style travel animation
let _combatSlot = 0;
let _lastGroupKey: string | undefined = undefined;
let _slotResetTimer: ReturnType<typeof setTimeout> | null = null;
const COMBAT_STEP_MS = 750; // ms between each attacker group

// Text queue: each vfxPlayCombat pre-queues the delay for the next vfxPlayText call
const _textDelayQueue: number[] = [];

function _getCenter(uid: string): { x: number; y: number } | null {
  const el = document.querySelector(`[data-uid="${uid}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

setCombatVfxBridge((fromUid, toUid, revFrom, revTo, groupKey) => {
  // Capture positions + images NOW (DOM still has pre-combat layout)
  VfxManager.cacheCardPos(fromUid);
  VfxManager.cacheCardPos(toUid);
  const from = _getCenter(fromUid);
  const to   = _getCenter(toUid);
  if (!from || !to) return;

  // Optional simultaneous counter-strike (blocker → attacker)
  const revFromPos = revFrom ? _getCenter(revFrom) : null;
  const revToPos   = revTo   ? _getCenter(revTo)   : null;
  if (revFrom) VfxManager.cacheCardPos(revFrom);
  if (revTo)   VfxManager.cacheCardPos(revTo);

  // Increment slot only when attacker changes (double/triple block = same slot)
  if (groupKey !== _lastGroupKey) {
    if (_lastGroupKey !== undefined) _combatSlot++;
    _lastGroupKey = groupKey;
  }
  const slotDelay = _combatSlot * COMBAT_STEP_MS;
  if (_slotResetTimer) clearTimeout(_slotResetTimer);
  _slotResetTimer = setTimeout(() => { _combatSlot = 0; _lastGroupKey = undefined; }, slotDelay + 3000);

  // Both damage texts appear on impact
  const textDelay = slotDelay + 60;
  _textDelayQueue.push(textDelay);
  if (revFrom) _textDelayQueue.push(textDelay);

  // Register when this animation ends so ghosts stay alive long enough
  VfxManager.setCombatAnimEnd(Date.now() + slotDelay + 500);

  setTimeout(() => {
    VfxManager.play('damage', undefined, to.x, to.y);
    if (revFromPos && revToPos) VfxManager.play('damage', undefined, revToPos.x, revToPos.y);
  }, slotDelay);
});

setVfxBridge((_type, _targetUid) => {
  // playerDamage é detectado via useEffect de vida no GameScreen (cobre todos os casos)
  // outros VFX sendo definidos um a um; combat já tratado pelo combatBridge
});

setVfxTextBridge((text, _targetUid, color) => {
  // Use pre-queued delay from the corresponding combatStrike call
  // For text calls that aren't from combat, delay=0
  const delay = _textDelayQueue.shift() ?? 0;
  const { x, y } = (() => {
    const el = _targetUid ? document.querySelector(`[data-uid="${_targetUid}"]`) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  })();
  // Capture position now, show later at that fixed position
  setTimeout(() => VfxManager.playText(text, undefined, color, x, y - 10), delay);
});

// ── Lazy import helpers (avoid circular deps) ──────────────────────────────

let _GS: typeof import('../engine/game-state') | null = null;
let _AI: typeof import('../engine/game-ai') | null = null;
let _Combat: typeof import('../engine/combat') | null = null;
let _Cards: typeof import('../engine/cards') | null = null;
let _Mana: typeof import('../engine/mana') | null = null;
let _Stack: typeof import('../engine/stack') | null = null;

async function loadEngine() {
  if (!_GS) _GS = await import('../engine/game-state');
  if (!_AI) _AI = await import('../engine/game-ai');
  if (!_Combat) _Combat = await import('../engine/combat');
  if (!_Cards) _Cards = await import('../engine/cards');
  if (!_Mana) _Mana = await import('../engine/mana');
  if (!_Stack) _Stack = await import('../engine/stack');
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
  // Reversible cards (borderless adventure variants): fix triple name and normalize to adventure
  // e.g. "Marang River Regent // Coil and Catch // Marang River Regent" → treat as adventure
  if (card.layout === 'reversible_card' && gc.name && gc.name.split(' // ').length >= 3) {
    const parts = gc.name.split(' // ');
    gc.name = parts[0] + ' // ' + parts[1]; // Keep only "Front // Adventure"
    if (gc.type_line && gc.type_line.split(' // ').length >= 3) {
      const tParts = gc.type_line.split(' // ');
      gc.type_line = tParts[0] + ' // ' + tParts[1];
    }
  }
  // The game engine uses card.adventure for adventure/omen face data,
  // but the DB stores it as card.back_face. Normalize here.
  // Detect adventure/omen: explicit layout OR back_face with instant/sorcery type OR reversible_card
  const backFaceType = (card as any).back_face?.type_line || '';
  const backFaceIsSpell = /sorcery|instant/i.test(backFaceType);
  const isAdventureLayout = card.layout === 'adventure' ||
    (card.layout === 'reversible_card' && backFaceIsSpell) ||
    ((card as any).back_face?.name && backFaceIsSpell);
  if (isAdventureLayout && (card as any).back_face?.name) {
    gc.adventure = (card as any).back_face;
    gc.layout = 'adventure';
  }
  // Scryfall stores combined mana_cost "{5}{B} // {1}{B}" for adventure/omen cards
  // (both from DB back_face and from JSON card_faces). Strip to face 0 cost only.
  if (gc.mana_cost && gc.mana_cost.includes('//')) {
    gc.mana_cost = gc.mana_cost.split('//')[0].trim();
  }
  // DB stores keywords/colors/color_identity as JSON strings — parse them to arrays
  // so the engine's hasKeyword() and other array methods work correctly.
  if (typeof gc.keywords === 'string') {
    try { gc.keywords = JSON.parse(gc.keywords); } catch { gc.keywords = []; }
  }
  if (!Array.isArray(gc.keywords)) gc.keywords = [];
  if (typeof gc.colors === 'string') {
    try { gc.colors = JSON.parse(gc.colors); } catch { gc.colors = []; }
  }
  if (typeof gc.color_identity === 'string') {
    try { gc.color_identity = JSON.parse(gc.color_identity); } catch { gc.color_identity = []; }
  }
  return gc;
}

function deckToGameCards(deck: Card[]): any[] {
  // Filter out Alchemy rebalanced cards (A- prefix)
  const filtered = deck.filter(c => !c.name?.startsWith('A-'));
  return filtered.map((card, i) => dbCardToGameCard(card, `p0-${i}-${card.id}`));
}

function botDeckToGameCards(deck: Card[]): any[] {
  const filtered = deck.filter(c => !c.name?.startsWith('A-'));
  return filtered.map((card, i) => dbCardToGameCard(card, `p1-${i}-${card.id}`));
}

// ── Snapshot: extract render-safe data from game state ─────────────────────

function snapshot(gs: any) {
  if (!gs) return null;

  const p0 = gs.players[0];
  const p1 = gs.players[1];

  function zoneCards(zone: any, shallowCopy = false) {
    try {
      const cards = zone.getAll ? zone.getAll() : [];
      // Shallow copy so React memo can detect mutations (e.g. _isCopy, name changes)
      return shallowCopy ? cards.map((c: any) => ({ ...c })) : cards;
    } catch { return []; }
  }

  // Augment graveyard cards with _graveyardAbilities and harmonize metadata
  function graveyardCards(zone: any, pid: number) {
    const cards = zoneCards(zone);
    if (!_Cards) return cards;
    return cards.map((card: any) => {
      const abilities = _Cards!.getGraveyardAbilities(card);
      const harmonizeCost = _Cards!.getHarmonizeCost(card);
      let result = card;
      if (abilities.length > 0) {
        result = { ...result, _graveyardAbilities: abilities };
      }
      if (harmonizeCost) {
        // Check affordability so the sidebar shows correctly enabled/disabled state
        // Must factor in creature tap discount (best untapped creature power)
        let canCast = false;
        try {
          if (_Mana) {
            const bfCards: any[] = gs.players[pid]?.zones?.battlefield?.cards || [];
            const bestCreaturePower = bfCards
              .filter((c: any) => _Cards!.isCreature(c) && !c._tapped)
              .reduce((best: number, c: any) => Math.max(best, _Cards!.getPower(c) || 0), 0);
            if (harmonizeCost.includes('{X}')) {
              // X cost: just check if player can afford the fixed portion
              const fixedStr = harmonizeCost.replace(/\{X\}/g, '');
              const fixedCmc = _Mana!.parseCost(fixedStr).total || 0;
              const effectiveCmc = Math.max(0, fixedCmc - bestCreaturePower);
              canCast = _Mana!.canAfford(gs, pid, { mana_cost: fixedStr || '{0}', cmc: effectiveCmc } as any, fixedStr || '{0}', effectiveCmc);
            } else {
              const hCmc = _Cards!.getHarmonizeCMC(card);
              const effectiveCmc = Math.max(0, hCmc - bestCreaturePower);
              canCast = _Mana!.canAfford(gs, pid, { mana_cost: harmonizeCost, cmc: effectiveCmc } as any, harmonizeCost, effectiveCmc);
            }
          }
        } catch { canCast = true; }
        result = { ...result, _harmonizeCost: harmonizeCost, _harmonizeCanCast: canCast };
      }
      return result;
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
      imageUrl: item.card?.image_normal || item.card?.image_small || '',
      imageSmall: item.card?.image_small || '',
      typeLine: item.card?.type_line || '',
      card: item.card || null,
      modeLabel: item.card?._stackModeLabel || '',
    })),
    pendingCastCard: (gs as any)._pendingCastOnStack?.card || null,

    // Exiled playable cards (exile_top_play, exile_top_choose) per player
    exiledPlayable: (() => {
      const result: Record<number, any[]> = { 0: [], 1: [] };
      const ep = (gs as any)._exiledPlayable;
      if (ep) {
        for (const uid of Object.keys(ep)) {
          const entry = ep[uid];
          const pid = entry.controller ?? 0;
          if (pid === 0 || pid === 1) result[pid].push({ ...entry.card, _freeCast: entry.freeCast });
        }
      }
      return result;
    })(),

    suspendedSpells: (() => {
      const result: any[] = [];
      const ss = (gs as any)._suspendedSpells;
      if (ss) {
        for (const pid of [0, 1]) {
          if (ss[pid]) {
            for (const s of ss[pid]) {
              const card = s.originalCard;
              result.push({
                name: card?.name || '???',
                imageUrl: card?.image_uris?.small || card?.image_uris?.normal || '',
                timeCounters: s.timeCounters,
                controllerId: pid,
              });
            }
          }
        }
      }
      return result;
    })(),

    players: [
      {
        id: 0,
        life: p0.life,
        isHuman: true,
        hand: zoneCards(p0.zones.hand),
        battlefield: zoneCards(p0.zones.battlefield, true),
        graveyard: graveyardCards(p0.zones.graveyard, 0),
        exile: zoneCards(p0.zones.exile),
        libraryCount: p0.zones.library?.count ? p0.zones.library.count() : 0,
        manaPool: gs.manaPool[0] || {},
      },
      {
        id: 1,
        life: p1.life,
        isHuman: false,
        hand: zoneCards(p1.zones.hand),
        battlefield: zoneCards(p1.zones.battlefield, true),
        graveyard: graveyardCards(p1.zones.graveyard, 1),
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
    startingPlayer: gs.startingPlayer ?? 0,
    landPlayedThisTurn: !!gs._landPlayedThisTurn,

    // Trigger toast notifications — shallow copy so React detects new items
    triggerToastQueue: [...(gs._triggerToastQueue || [])],

    // Trigger queue items for persistent panel
    gameQueueItems: [],  // populated by UI from triggerToastQueue

    // Ring state (The One Ring / LTR)
    ringLevel: (gs._ringLevel || [0, 0]) as [number, number],
    ringBearer: (gs._ringBearer || [null, null]) as [string | null, string | null],
    pendingRingBearer: (gs._pendingRingBearer as { controller: number; creatures: any[] } | null) ?? null,

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

export interface GameQueueItem {
  id: string;
  cardName: string;
  imageUrl: string | null;
  controllerId: number;
  effectDesc: string;
  isActive: boolean;
}

export interface TriggerToastItem {
  id: number;
  cardName: string;
  imageUrl: string | null;
  imageUrlLarge: string | null;
  controllerId: number;
  effectDesc: string;
  isToken?: boolean;
  tokenColors?: string[];
}

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
  startingPlayer: number;
  triggerToastQueue: TriggerToastItem[];
  gameQueueItems: any[];
  _aiActions?: any[];
  exiledPlayable: Record<number, any[]>;
  pendingCastCard: any | null;
  landPlayedThisTurn?: boolean;
  stackItems?: any[];
  suspendedSpells: { name: string; imageUrl: string; timeCounters: number; controllerId: number }[];
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
  resolveSpiritDragonsChoice(dragonUid: string): void;
  resolvePostModalTarget(target: any): void;
  cancelModal(): void;
  activateGraveyardAbility(cardUid: string, abilityIdx: number): void;
  activateBattlefieldAbility(cardUid: string, abilityIdx: number, xValue?: number): void;
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
  resolveMillLand(choice: string, landUid?: string): void;
  resolveBlight(creatureUid: string): void;
  resolveBuffChoiceAction(creatureUid: string): void;
  resolveWardChoice(choice: 'pay' | 'decline' | 'repick'): void;
  resolveGrantTargetChoice(creatureUid: string): void;
  resolveEowynGrantChoice(creatureUid: string, keyword: string): void;
  resolveChooseOpponentDiscard(cardUid: string): void;
  resolveRingBearerChoice(creatureUid: string): void;
  resolveDistributeCountersAction(distribution: Record<string, number>): void;
  resolveHandExile(cardUid: string): void;
  resolveGraveyardCastChoice(cardUid: string): void;
  resolveAttachChoice(shouldEquip: boolean): void;
  resolvePlayerChoice(chosenPlayerId: number): void;
  resolveTriggerCostAction(choice: string): void;
  resolveUnlessPayAction(shouldPay: boolean): void;
  resolveMillTargetChoice(targetSelf: boolean): void;
  resolveWatcherTentacleUntap(krakenUid: string | null): void;
  resolveWatcherTentacleStun(targetUid: string | null): void;

  // Special card effects
  resolveTravelingBotanist(toHand: boolean): void;
  resolveExileChoice(cardUid: string): void;
  resolveLegendaryChoice(choice: 'keep_new' | 'cancel'): void;
  resolveTargetChoiceSingle(uid: string): void;
  resolveBeholdChoice(uid: string | null): void;
  resolveOrderBlockers(manualOrder?: Record<string, string[]>): void;
  resolveUnknownInput(): void;

  // Put card on bottom
  resolvePutOnBottom(cardUid: string): void;

  // Discard overlays
  resolveDiscard(cardUids: string[]): void;
  resolveMandatoryDiscard(cardUids: string[]): void;
  resolveLootDiscard(cardUid: string): void;
  resolveRummage(cardUids: string[]): void;

  // Hideaway land card selection
  resolveHideaway(cardUid: string): void;

  // Search library
  resolveSearchLibrary(cardUid: string | null): void;
  resolveSearchToGY(cardUid: string | null): void;
  resolveSearchExileCast(selectedUids: string[]): void;

  // X cost choice
  resolveXChoice(xValue: number): void;

  // ETB bounce target choice
  resolveETBBounceTarget(targetUids: string[]): void;

  // ETB destroy target choice
  resolveETBDestroyTarget(targetUids: string | string[] | null): void;

  // Move counters target choice (Host of the Hereafter / dying creature counters)
  resolveCounterInheritance(targetUid: string | null): void;

  // Exile GY creature cost (Great Arashin City etc.)
  resolveExileGYCreatureCost(cardUid: string | null): void;
  resolveExileGYCardsCost(uids: string[]): void;

  // Graveyard trigger pay choice (e.g. Furious Forebear)
  resolveGraveyardTrigger(accepted: boolean): void;


  // ETB tap target choice
  resolveETBTapTarget(targetUids: string[]): void;

  // ETB cant_block target choice (Summit Intimidator etc.)
  resolveETBCantBlockTarget(targetUid: string | null): void;

  // ETB exile target choice
  resolveETBExileTarget(targetUids: string[]): void;

  // Shire Shirriff: choose which token to sacrifice before exiling
  resolveSacrificeTokenChoice(tokenUid: string | null): void;

  // Grishnákh steal target choice
  resolveGrishnakhSteal(targetUid: string | null): void;

  // Gain control target (Rangers of Ithilien etc.)
  resolveGainControlTarget(targetUid: string | null): void;

  // Mount Doom: choose creatures to spare then destroy rest
  resolveChooseSparedCreatures(sparedUids: string[]): void;

  // ETB counter target choice (Sage of the Fang etc.)
  resolveETBCounterTarget(targetUid: string | null): void;

  // ETB remove all counters target (Purging Stormbrood)
  resolveETBRemoveCountersTarget(targetUid: string | null): void;

  // ETB "any target" damage choice (Sonic Shrieker etc.)
  resolveETBDamageTarget(target: { type: 'creature' | 'player' | 'permanent'; uid?: string; player?: number }): void;

  // ETB clone target choice (Naga Fleshcrafter)
  resolveETBCloneTarget(targetUid: string | null): void;

  // Distribute damage (damage_divided human choice)
  resolveDistributeDamage(distribution: Record<string, number>): void;

  // tap_creature cost choice
  resolveActivationTapCreature(tappedUid: string | null): void;

  // Ramp choice
  resolveRampChoice(landUid: string, options?: any): void;

  // Clash
  resolveClash(keepOnTop: boolean): void;

  // Look-top choice
  resolveLookTop(choices: string[]): void;
  resolveBotanistLook(choice: 'hand' | 'graveyard' | 'top'): void;
  resolveBounceToLibrary(position: 'top' | 'bottom'): void;

  // Reveal pick (Dragonologist etc.)
  resolveRevealPick(cardUid: string | null): void;

  // Trigger ordering (simultaneous triggers)
  resolveTriggerOrder(orderedIndices: number[]): void;

  // Confirm optional
  resolveConfirmOptional(confirmed: boolean): void;

  // Optional mill (Rainveil Rejuvenator etc.)
  resolveOptionalMill(doMill: boolean): void;

  // Ward payment confirm (human targeting a ward creature)
  resolveWardConfirm(pay: boolean): void;

  // Exile reveal (Kotis etc.) — cast a card or dismiss
  resolveExileReveal(cardUid: string | null): void;

  // Grant counter target (Alchemist's Assistant etc.)
  resolveGrantCounterTarget(cardUid: string): void;

  // Multi-buff choice
  resolveMultiBuffChoiceAction(creatureUids: string[]): void;

  // Put creatures from hand (Last March of the Ents)
  resolvePutCreaturesFromHand(uids: string[]): void;

  // Sacrifice choice
  resolveSacrifice(cardUid: string | null): void;

  // Crew vehicle
  resolveCrew(selectedUids: string[] | null): void;

  // GY return choice
  resolveGYReturn(cardUids: string[]): void;
  resolveFriendlyRivalryChoice(uid: string | null): void;
  resolveMultiUntap(uids: string[]): void;
  resolveTapOrUntap(uid: string | null): void;
  resolveFightTarget(uid: string | null): void;
  resolveFreeCastFromHand(uid: string | null): void;
  resolveFreeCastFromExile(uid: string | null): void;
  resolveSauronsRansomChoice(pileIndex: number): void;
  resolveMultiTapChoice(selectedUids: string[]): void;
  resolveAttachEquipmentChoice(uid: string | null): void;
  resolveAttachOwnCreature(uid: string | null): void;
  resolveDamageCreatureTarget(uid: string | null): void;
  resolveMoveCountersTarget(uid: string | null): void;
  resolveMoveCountersAmount(amounts: Record<string, number>): void;
  resolveLibraryOrder(orderedUids: string[]): void;

  resolveShuffleGYChoosePlayer(targetPid: number): void;
  resolveShuffleGYChooseCards(cardUids: string[]): void;
  resolveGYCounterTargets(targetUids: string[]): void;
  resolveLegendRuleSacrifice(sacrificeUid: string): void;
  activateGrantedAbility(creatureUid: string, abilityIdx: number): void;

  resolveGYBottomLibrary(cardUid: string | null): void;

  // Graveyard choice (which player's GY to exile from)
  resolveGraveyardChoice(pid: number): void;

  // Graveyard card choice (which specific cards to exile)
  resolveGraveyardCardChoice(cardUids: string[]): void;

  // Delve card exile choice
  resolveDelveChoice(selectedUids: string[]): void;

  // Restart game with same decks
  restartGame(): void;

  // Stop at specific phases during opponent's turn
  setStopAtPhases(phases: string[]): void;

  // Stop at specific phases during human's own turn
  setMyStopPhases(phases: string[]): void;

  // Long List of the Ents: confirm noted creature type
  resolveNoteCreatureType(type: string): void;
  resolveProtectionTypeChoice(cardType: string): void;
  resolveProtectionCreatureChoice(uid: string): void;
  resolveUnlessExile(doExile: boolean): void;

  // Graveyard → top of library (Treason of Isengard)
  resolveGraveyardToTop(cardUid: string | null): void;
}

function _describeEffect(e: any): string {
  if (!e) return '';
  if (e.type === 'damage') return `Deal ${e.amount || '?'} damage`;
  if (e.type === 'draw') return `Draw ${e.amount || 1}`;
  if (e.type === 'gainLife') return `Gain ${e.amount || '?'} life`;
  if (e.type === 'loseLife') return `Lose ${e.amount || '?'} life`;
  if (e.type === 'buff') return `+${e.power||0}/+${e.toughness||0}`;
  if (e.type === 'drain') return `Drain ${e.amount || '?'}`;
  if (e.type === 'create_token') return 'Create token';
  if (e.type === 'destroy') return 'Destroy';
  if (e.type === 'exile') return 'Exile';
  if (e.type === 'counter_self') return '+1/+1 counter';
  if (e.type === 'scry') return `Scry ${e.amount || 1}`;
  if (e.type === 'surveil') return `Surveil ${e.amount || 1}`;
  if (e.type === 'search_library') return 'Search library';
  if (e.type === 'bounce') return 'Return to hand';
  if (e.type === 'fight') return 'Fight';
  if (e.type === 'mill') return `Mill ${e.amount || 1}`;
  return e.type || '?';
}

export function useGameEngine(playerDeck: Card[], botDeck: Card[]) {
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gsRef = useRef<any>(null);
  // Expose game state for console debug scripts
  (window as any).__gsRef = gsRef;
  // testCard("Card Name", copies?, alsoOpponent?) — inject card + mana into hand
  if (!(window as any).testCard) {
    (window as any).testCard = async (name: string, copies = 1, alsoOpponent: boolean | string = false) => {
      // alsoOpponent can be true (give opp copy) or "back"/"omen" to use back face cost
      const useFace = typeof alsoOpponent === 'string' ? alsoOpponent : null;
      const giveOpp = alsoOpponent === true;
      const gs = (window as any).__gsRef?.current;
      const ref = (window as any).__gsRefresh;
      if (!gs || !ref) { console.error('Game not ready'); return; }
      const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
      if (!res.ok) { console.error('Card not found!'); return; }
      const data = await res.json();
      // For DFCs (modal/adventure/omen): mana_cost may be empty at top level; use the most expensive face
      let manaCost = data.mana_cost || '';
      if (data.card_faces) {
        if (useFace === 'back' || useFace === 'omen') {
          // Use back face cost specifically
          manaCost = data.card_faces[1]?.mana_cost || data.card_faces[0]?.mana_cost || manaCost;
        } else if (!manaCost) {
          const faceCosts = data.card_faces.map((f: any) => f.mana_cost || '').filter((c: string) => c);
          manaCost = faceCosts.sort((a: string, b: string) => {
            const cmc = (s: string) => { let t = 0; s.replace(/\{(\d+)\}/g, (_: any, n: string) => { t += parseInt(n); return ''; }); s.replace(/\{[WUBRG]\}/gi, () => { t++; return ''; }); return t; };
            return cmc(b) - cmc(a);
          })[0] || '';
        }
      }
      const landNames: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
      for (let i = 0; i < copies; i++) {
        const card = { ...data, _uid: `inject-${Date.now()}-${i}` };
        // Mark card to cast as back face (omen/adventure)
        if (useFace === 'back' || useFace === 'omen') card._castBackFace = true;
        gs.players[0].zones.hand.add(card);
        if (giveOpp) { const oc = { ...data, _uid: `inject-opp-${Date.now()}-${i}` }; gs.players[1].zones.hand.add(oc); }
      }
      // Add tapped lands + float mana
      const colorCounts: Record<string, number> = {};
      let m: RegExpExecArray | null;
      const cr = /\{([WUBRG])\}/gi;
      while ((m = cr.exec(manaCost))) colorCounts[m[1].toUpperCase()] = (colorCounts[m[1].toUpperCase()] || 0) + 1;
      const gm = manaCost.match(/\{(\d+)\}/);
      const generic = gm ? parseInt(gm[1]) : 0;
      let n = 0;
      for (const [color, count] of Object.entries(colorCounts)) {
        for (let i = 0; i < count; i++) {
          const ln = landNames[color] || 'Mountain';
          const land: any = { name: ln, type_line: `Basic Land — ${ln}`, mana_cost: '', cmc: 0, colors: [color], oracle_text: `{T}: Add {${color}}.`, _uid: `inj-land-${Date.now()}-${n++}`, _tapped: true };
          gs.players[0].zones.battlefield.add(land);
          gs.manaPool[0][color] = (gs.manaPool[0][color] || 0) + 1;
        }
      }
      const gc = Object.keys(colorCounts)[0] || 'R';
      for (let i = 0; i < generic; i++) {
        const ln = landNames[gc] || 'Mountain';
        const land: any = { name: ln, type_line: `Basic Land — ${ln}`, mana_cost: '', cmc: 0, colors: [gc], oracle_text: `{T}: Add {${gc}}.`, _uid: `inj-land-${Date.now()}-${n++}`, _tapped: true };
        gs.players[0].zones.battlefield.add(land);
        gs.manaPool[0][gc] = (gs.manaPool[0][gc] || 0) + 1;
      }
      ref();
      const faceNote = useFace ? ` [${useFace} face]` : '';
      console.log(`✅ ${data.name}${faceNote} x${copies} + ${n} lands + mana ready. Click to cast!`);
    };
    console.log('🎮 testCard("Card Name") or testCard("Card", 1, "omen") for back face. Ready!');
  }
  const aiRunningRef = useRef(false);
  const mountedRef = useRef(true);
  const trainedForGameRef = useRef(false);

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
  const [undoManaCount, setUndoManaCount] = useState(0);

  function clearManaUndo() {
    tapUndoRef.current = [];
    setCanUndoMana(false);
    setUndoManaCount(0);
  }

  // Update snapshot (React re-render trigger)
  const refresh = useCallback(() => {
    if (mountedRef.current && gsRef.current) {
      setSnap(snapshot(gsRef.current));
    }
  }, []);
  (window as any).__gsRefresh = refresh;

  // AI turn visual delay — actual AI logic runs inside advancePhase (engine-driven)
  // This function only provides a short visual pause so "AI thinking..." shows briefly
  const runAI = useCallback(async (delayMs = 400) => {
    if (aiRunningRef.current || !gsRef.current) return;
    const gs = gsRef.current;
    console.log(`[AI] Starting AI turn, phase=${gs.phase}, waitingForInput=${gs.waitingForInput?.type}, stack=${gs.stack?.items?.length}`);
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
    console.log(`[LOOP] afterResolve, phase=${gs.phase}, waitingForInput=${gs.waitingForInput?.type}, stack=${gs.stack?.items?.length}, winner=${gs.winner}`);
    // AI untap visual pause: render the untapped state, then continue AI turn
    if (gs.waitingForInput?.type === 'ai_untap_visual' && _GS) {
      refresh();
      safeTimeout(() => {
        if (!gsRef.current || !_GS) return;
        gsRef.current.waitingForInput = null;
        _GS.reprocessCurrentPhase(gsRef.current);
        refresh();
      }, 350);
      return;
    }
    // Check for queued legend rule (deferred because ETB needed input first)
    if (!gs.waitingForInput && gs._queuedLegendRule) {
      const legendData = gs._queuedLegendRule;
      delete gs._queuedLegendRule;
      // Verify there are still duplicates on BF (the sacrificed card may have already left)
      const bf = gs.players[legendData.controllerId].zones.battlefield;
      const stillAlive = legendData.candidates.filter((c: any) => bf.get(c.uid));
      if (stillAlive.length > 1) {
        gs._pendingLegendRuleSacrifice = { ...legendData, candidates: stillAlive };
        gs.waitingForInput = { type: 'legend_rule_sacrifice', playerId: legendData.controllerId };
        refresh();
        return;
      }
    }
    if (!gs.waitingForInput && !gs.winner && _GS) {
      const ap = gs.activePlayer;
      if (!gs.players[ap]?.isHuman) {
        // AI's turn — brief visual delay then continue so "thinking..." shows
        safeTimeout(() => {
          if (!gsRef.current || !_GS) return;
          console.log(`[LOOP] AI step (afterResolve delay), phase=${gsRef.current.phase}, waitingForInput=${gsRef.current.waitingForInput?.type}, stack=${gsRef.current.stack?.items?.length}`);
          _GS.reprocessCurrentPhase(gsRef.current);
          refresh();
        }, 300);
      } else {
        // Human's turn — continue immediately (restores main_phase WFI, etc.)
        console.log(`[LOOP] Human reprocess, phase=${gs.phase}, waitingForInput=${gs.waitingForInput?.type}`);
        _GS.reprocessCurrentPhase(gs);
        refresh();
      }
    }
  }, [refresh]);

  // ── AI Brain: train when game ends ──────────────────────────────────────
  useEffect(() => {
    if (snap?.winner != null && !trainedForGameRef.current) {
      trainedForGameRef.current = true;
      // AI is player 1; won = AI won
      const aiWon = snap.winner === 1;
      aiBrain.trainOnGame(aiWon).catch((e) => console.warn('[AiBrain] trainOnGame error:', e));
    }
    // Reset flag on new game (winner goes back to null)
    if (snap?.winner == null) {
      trainedForGameRef.current = false;
    }
  }, [snap?.winner]);

  // Safety valve: if AI has stack/instant priority stuck for >2s, auto-pass.
  // Human gets priority without timeout — they can take as long as they need.
  useEffect(() => {
    const wiType = snap?.waitingForInput?.type;
    if (wiType !== 'stack_priority' && wiType !== 'instant_priority') return;
    const wfi = snap.waitingForInput;
    // Only auto-pass for AI (playerId=1). Human keeps priority until they press Space.
    if (wfi.playerId !== 1) return;
    const timer = setTimeout(() => {
      const gs = gsRef.current;
      if (!gs) return;
      const curType = gs.waitingForInput?.type;
      if (curType !== 'stack_priority' && curType !== 'instant_priority') return;
      if (gs.waitingForInput?.playerId !== 1) return;
      console.warn('[STUCK] AI priority stuck for 2s — forcing pass');
      // Reset _processingPhases if stuck
      if ((gs as any)._processingPhases) {
        (gs as any)._processingPhases = false;
      }
      if ((gs as any)._pendingCastOnStack) {
        const pending = (gs as any)._pendingCastOnStack;
        delete (gs as any)._pendingCastOnStack;
        if ((gs as any).stack?.items?.length > 0) (gs as any).stack.items.pop();
        gs.waitingForInput = null;
        if (pending?.card) {
          (gs as any)._resumingFromStackPriority = true;
          gs.players[pending.playerId].zones.hand.add(pending.card);
          _GS.castSpell(gs, pending.playerId, pending.card._uid, pending.targets || [], pending.isAdventure || false, pending.isEvoke || false);
        }
      } else {
        gs.waitingForInput = null;
      }
      if (!gs.waitingForInput && _GS?.reprocessCurrentPhase) _GS.reprocessCurrentPhase(gs);
      refresh();
    }, 2000);
    return () => clearTimeout(timer);
  }, [snap?.waitingForInput?.type, snap?.waitingForInput?.playerId]);

  // Smart auto-pass for trigger priority: if human has nothing to cast at instant speed,
  // resolve the trigger automatically after a short visual delay (Arena-style).
  // If full control mode OR has playable instants/flash: wait for player input.
  useEffect(() => {
    const wi = snap?.waitingForInput;
    if (wi?.type !== 'trigger_priority' || wi?.playerId !== 0) return;
    const gs = gsRef.current;
    if (!gs) return;
    // Full control: always wait for player input
    if ((gs as any)._fullControl) return;
    // Check if human has any instant-speed options in hand
    const hand: any[] = gs.players[0]?.zones?.hand?.getAll?.() || [];
    const hasInstant = hand.some((c: any) => {
      const tl = (c.type_line || '').toLowerCase();
      return tl.includes('instant') || (c.oracle_text || '').toLowerCase().startsWith('flash');
    });
    if (hasInstant) return; // Player can respond — wait for their input
    // No instants available: auto-resolve after brief visual delay
    const timer = setTimeout(() => {
      if (!gsRef.current || gsRef.current.waitingForInput?.type !== 'trigger_priority') return;
      gsRef.current.waitingForInput = null;
      if (_GS) {
        _GS.processGameQueue(gsRef.current);
        if (!gsRef.current.waitingForInput && !gsRef.current._gameQueue?.length) {
          _GS.reprocessCurrentPhase(gsRef.current);
        }
      }
      refresh();
    }, 900);
    return () => clearTimeout(timer);
  }, [snap?.waitingForInput?.type, snap?.waitingForInput?.playerId, refresh]);

  // Safety valve: reset _processingPhases if stuck for >3s (prevents Space from being blocked)
  useEffect(() => {
    const timer = setInterval(() => {
      const gs = gsRef.current;
      if (!gs) return;
      if ((gs as any)._processingPhases && gs.waitingForInput?.playerId === 0) {
        console.warn('[STUCK] _processingPhases was true while waiting for human input — resetting');
        (gs as any)._processingPhases = false;
      }
    }, 3000);
    return () => clearInterval(timer);
  }, []);

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
      // Guard: engine trampoline still running — skip (but allow priority passes)
      if ((gs as any)._processingPhases &&
          gs.waitingForInput?.type !== 'stack_priority' &&
          gs.waitingForInput?.type !== 'instant_priority' &&
          gs.waitingForInput?.type !== 'trigger_priority') return;
      // Debounce: ignore if called within 250ms of last call
      // EXCEPTION: stack_priority passes are NOT debounced — the AI can trigger multiple
      // stack_priority states in rapid succession, and each one needs its own pass.
      const now = Date.now();
      const isStackPriorityPass = gs.waitingForInput?.type === 'stack_priority';
      if (!isStackPriorityPass && now - _lastNextPhaseMs < 250) return;
      _lastNextPhaseMs = now;
      clearManaUndo();
      try {
        const prevWaiting = gs.waitingForInput;
        // Clear waitingForInput so the engine trampoline loop can run _processPhase
        gs.waitingForInput = null;

        // When human confirms attackers (Space in combat_attackers), fire attack triggers
        // and tap attackers before advancing. This mirrors what the AI path does.
        if (prevWaiting?.type === 'declare_attackers' && gs.combat?.attackers?.length > 0) {
          // Tap attacking creatures (unless vigilance)
          for (const entry of gs.combat.attackers) {
            const attacker = (entry as any).card || entry;
            if (!attacker) continue;
            const hasVigilance = (attacker.keywords || []).some((k: string) => k?.toLowerCase() === 'vigilance') ||
              (attacker._tempKeywords || []).some((t: any) => (typeof t === 'string' ? t : t?.keyword || '').toLowerCase() === 'vigilance');
            if (!hasVigilance && !attacker._tapped) {
              attacker._tapped = true;
            }
            // Mark as tapped-by-attack to prevent double-tap in resetCombatState
            attacker._tappedByAttack = true;
          }
          // Centralized becomes_tapped detection (fires for Rescue Leopard, Traveling Botanist, etc.)
          if (_GS?.detectAndFireTapTriggers) {
            _GS.detectAndFireTapTriggers(gs);
          }
          if (_Combat?.fireAttackTriggers) {
            gs._attackTriggersFireDone = true; // prevent advancePhase from firing triggers again
            if (!gs._attackedThisTurn) gs._attackedThisTurn = {};
            gs._attackedThisTurn[0] = true;
            const triggerLogs = _Combat.fireAttackTriggers(gs.combat, gs, 0);
            gs.log.push(...triggerLogs);
          }
          // If a trigger set up a cost/choice overlay, stop here — don't advance phase
          if (gs.waitingForInput) {
            refresh();
            return;
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
          console.log(`[STACK_PRIORITY] Human passed. pending=${pending?.card?.name || 'NONE'}, stack=${(gs as any).stack?.items?.length}, countered=${pending?.card?._countered}`);
          if (pending) {
            // Pop the temporary stack item (pushed during priority gate check)
            if ((gs as any).stack?.items?.length > 0) (gs as any).stack.items.pop();

            if (pending.card._countered) {
              delete (gs as any)._pendingCastOnStack;
              // Spell was countered by human — send to graveyard without resolving
              delete pending.card._countered;
              gs.players[pending.playerId].zones.graveyard.add(pending.card);
              gs.log.push(`${pending.card.name} vai para o cemiterio (anulado).`);
            } else {
              // Before resolving the spell, flush any pending spell_targets triggers
              // (e.g. King of the Oathbreakers phases out before Isolation at Orthanc resolves)
              if ((gs as any)._gameQueue?.length > 0) {
                _GS.processGameQueue(gs);
                if (gs.waitingForInput) {
                  // trigger_priority is now active — delay spell resolution
                  // Leave _pendingCastOnStack so it resolves after triggers clear
                  refresh();
                  return;
                }
              }

              delete (gs as any)._pendingCastOnStack;
              // Spell not countered — resume the cast (skips cost checks)
              (gs as any)._resumingFromStackPriority = true;
              // Temporarily put card back in hand so castSpell can find and remove it
              gs.players[pending.playerId].zones.hand.add(pending.card);
              console.log(`[STACK_PRIORITY] Resuming castSpell for ${pending.card.name}`);
              _GS.castSpell(gs, pending.playerId, pending.card._uid, pending.targets || [], pending.isAdventure || false, pending.isEvoke || false);
              console.log(`[STACK_PRIORITY] After castSpell: waitingForInput=${gs.waitingForInput?.type}, stack=${(gs as any).stack?.items?.length}`);
            }
          } else {
            console.warn('[STACK_PRIORITY] No _pendingCastOnStack! Clearing stale stack.');
            if ((gs as any).stack?.items?.length > 0) (gs as any).stack.items.length = 0;
          }
          // Reprocess current phase so AI can continue (or human stays in main)
          if (!gs.waitingForInput) {
            _GS.reprocessCurrentPhase(gs);
          }
        } else if (prevWaiting?.type === 'trigger_priority') {
          // Human passed trigger priority — resolve the next trigger from the game queue
          // Give AI a chance to respond first
          const opId = gs.activePlayer === 0 ? 1 : 0;
          if (!gs.players[opId]?.isHuman && _AI) {
            _AI.playInstantPhase(gs, opId, gs.phase);
          }
          // Resume queue processing (will resolve the trigger that was paused)
          _GS.processGameQueue(gs);
          // If no more queue items and no new waitingForInput, reprocess current phase
          if (!gs.waitingForInput && !(gs as any)._gameQueue?.length) {
            _GS.reprocessCurrentPhase(gs);
          }
        } else {
          // Always drain trigger queue before advancing phase.
          // Catches cases where triggers fired but processGameQueue wasn't called yet
          // (e.g. activated ability fired a trigger that sat in _gameQueue unreached).
          const queueLen = (gs as any)._gameQueue?.length ?? 0;
          if (queueLen > 0) {
            _GS.processGameQueue(gs);
            // If processGameQueue set a WFI (e.g. trigger_priority), stop here — don't advance
            if (!gs.waitingForInput) {
              _GS.advancePhase(gs);
            }
          } else {
            _GS.advancePhase(gs);
          }
        }
        // Safety: clear stale stack items when no _pendingCastOnStack exists
        // This prevents orphaned stack items from blocking instant_priority forever
        if ((gs as any).stack?.items?.length > 0 && !(gs as any)._pendingCastOnStack) {
          console.warn('[STACK CLEANUP] Clearing', (gs as any).stack.items.length, 'orphaned stack item(s)');
          (gs as any).stack.items.length = 0;
        }
        // AI untap visual pause: render untapped state, then continue AI turn
        if (gs.waitingForInput?.type === 'ai_untap_visual') {
          refresh();
          safeTimeout(() => {
            if (!gsRef.current || !_GS) return;
            gsRef.current.waitingForInput = null;
            _GS.reprocessCurrentPhase(gsRef.current);
            refresh();
          }, 350);
          return;
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
        let card = hand.find((c: any) => c._uid === cardUid);
        // Also check exiled playable cards (Breaching Dragonstorm, Kotis, etc.)
        let isFreeCastFromExile = false;
        if (!card && gs._exiledPlayable && gs._exiledPlayable[cardUid]) {
          card = gs._exiledPlayable[cardUid].card;
          isFreeCastFromExile = !!gs._exiledPlayable[cardUid].freeCast;
        }
        if (!card) { console.warn(`[castSpell] Card ${cardUid} not found in hand or exile`); return; }

        // Free cast from exile: skip all mana handling, go straight to engine
        if (isFreeCastFromExile) {
          const result = _GS.castSpell(gs, pid, cardUid, targets);
          if (result?.success || result?.waitForInput || result?.pendingStack) {
            afterResolve(gs);
          }
          refresh();
          return;
        }

        // Compute effective mana cost (conditional cost like Dragon's Prey +{2} for dragons)
        let tapCost = card.mana_cost;
        // Strip combined adventure/omen cost e.g. "{3}{B} // {X}{B}{B}" → use front face only.
        // Scryfall stores combined costs for adventure/omen cards; parseCost would sum both faces.
        if (tapCost && tapCost.includes('//')) {
          tapCost = tapCost.split('//')[0].trim();
        }
        // For adventure/omen cards, card.cmc is the combined CMC of both faces (e.g. 10 for 6+4),
        // but tapCost is already stripped to the front face only. Always derive CMC from parsed tapCost
        // so hybrid minimums and adventure face splits are handled correctly.
        let tapCmc = (_Mana && tapCost) ? (_Mana.parseCost(tapCost).total || card.cmc) : card.cmc;
        if (_Mana && tapCost) {
          const _parsedForHybrid = _Mana.parseCost(tapCost);
          if (_parsedForHybrid.hybrids && _parsedForHybrid.hybrids.length > 0) {
            tapCmc = _parsedForHybrid.total; // hybrid minimum
          }
        }
        // Apply cost reduction from getPlayableCards (e.g. self_cost_reduction for Focus the Mind)
        if (card._costReduced && card._effectiveCmc !== undefined && card._effectiveCmc < tapCmc) {
          tapCmc = card._effectiveCmc;
        }
        // X spells: human gets to choose X value; AI taps all available mana
        if (tapCost && tapCost.includes('{X}') && _Mana) {
          const bf = gs.players[pid].zones.battlefield;
          const availPool: Record<string, number> = { ...(gs.manaPool[pid] || {}) };
          bf.cards
            .filter((c: any) => (c.type_line || '').toLowerCase().includes('land') && !c._tapped)
            .forEach((land: any) => {
              const colors = _Mana.getLandManaColors(land);
              colors.forEach((color: string) => { availPool[color] = (availPool[color] || 0) + 1; });
            });
          const totalAvailable = (Object.values(availPool) as number[]).reduce((s: number, v) => s + (v as number), 0);
          // Calculate fixed (non-X) cost
          const fixedCostStr = tapCost.replace(/\{X\}/g, '');
          const fixedParsed = _Mana.parseCost(fixedCostStr);
          const fixedTotal = fixedParsed.total || 0;
          const maxX = Math.max(0, totalAvailable - fixedTotal);

          // Human: prompt for X value if not already chosen
          if (pid === 0 && gs._pendingXChoice === undefined) {
            gs._pendingXCast = { cardUid, card, targets, tapCost, fixedTotal, maxX };
            gs.waitingForInput = { type: 'choose_x_cost', playerId: 0 };
            refresh();
            return;
          }
          // Resume with chosen X
          if (gs._pendingXChoice !== undefined) {
            const chosenX = gs._pendingXChoice as number;
            delete gs._pendingXChoice;
            tapCmc = fixedTotal + chosenX;
          } else {
            tapCmc = Math.max(tapCmc, totalAvailable);
          }
        }

        // Delve interactive: if human has a delve granter and GY non-lands, pause for choice
        // (only if delve wasn't already resolved in a previous resolveDelveChoice call)
        console.log(`[DELVE-CHECK] card=${card.name}, _Mana=${!!_Mana}, pendingDelveRed=${gs._pendingDelveReduction}, tapCost=${tapCost}, tapCmc=${tapCmc}`);
        if (_Mana && gs._pendingDelveReduction === undefined) {
          const delveGranter = gs.players[pid].zones.battlefield.cards.find((c: any) => c._grantDelve);
          console.log(`[DELVE-CHECK] delveGranter=${delveGranter?.name || 'NONE'}`);
          if (delveGranter) {
            const gyNonLands = (gs.players[pid].zones.graveyard.cards || []).filter((c: any) =>
              !(c.type_line || '').toLowerCase().includes('land')
            );
            console.log(`[DELVE-CHECK] gyNonLands=${gyNonLands.length}, tapCmc=${tapCmc}`);
            if (gyNonLands.length > 0 && tapCmc > 0) {
              const parsedCost = _Mana.parseCost(tapCost);
              const genericPortion = parsedCost.generic || 0;
              console.log(`[DELVE-CHECK] genericPortion=${genericPortion} → SHOWING DELVE OVERLAY`);
              if (genericPortion > 0) {
                gs._pendingDelveChoice = { playerId: pid, cardUid, targets, gyNonLands, maxDelve: Math.min(gyNonLands.length, genericPortion) };
                gs.waitingForInput = { type: 'delve_choice', playerId: pid };
                refresh();
                return;
              }
            }
          }
        }
        // If delve was pre-resolved, apply the reduction to tapCmc
        if (gs._pendingDelveReduction !== undefined) {
          tapCmc = Math.max(0, tapCmc - (gs._pendingDelveReduction as number));
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
        // Ward pre-check: if human targets a ward creature, show "Pay ward N?" prompt
        // Skip if this cast is resuming after the human confirmed ward payment (_skipWardCheck).
        // Skip if the spell can't be countered (Ward's counter effect doesn't apply).
        const _spellCantBeCountered = _Cards && ((_Cards as any).getPreprocessedEffects(card) as any)?.cantBeCountered;
        if (!gs._skipWardCheck && !_spellCantBeCountered && targets && targets.length > 0 && _Cards) {
          for (const t of targets) {
            if (t.type !== 'creature') continue;
            // Ward only triggers when an OPPONENT targets the creature
            if (t.player === pid) continue;
            const wCreature = gs.players[t.player]?.zones?.battlefield?.get(t.uid);
            if (!wCreature || !(_Cards as any).hasKeyword(wCreature, 'Ward')) continue;
            const wMatch = (wCreature.oracle_text || '').match(/ward[\s\u2014\-]+\{?(\d+)\}?/i);
            const wCost = wMatch ? parseInt(wMatch[1]) : 0;
            if (wCost <= 0) continue;
            // Show prompt regardless of affordability (player decides)
            gs._pendingWardCast = { cardUid, targets, tapCost, tapCmc, wardCost: wCost };
            (gs as any).waitingForInput = { type: 'ward_confirm', playerId: pid, wardCost: wCost, creatureName: wCreature.name };
            refresh();
            return;
          }
        }
        if (gs._skipWardCheck) delete (gs as any)._skipWardCheck;

        // Apply affinity discount (Salt Road Packbeast, etc.) before canPay check
        // Note: _effectiveCmc may have already reduced tapCmc above — we must update
        // tapCost string AND recalculate tapCmc from the parsed cost to avoid double-reduction.
        if (tapCost && tapCmc > 0 && _GS && _Mana && _Cards && _Cards.hasAffinity(card)) {
          const affinityDiscount = _GS.calculateAffinityDiscount(gs, pid, card);
          if (affinityDiscount > 0) {
            const parsedCost = _Mana.parseCost(tapCost);
            parsedCost.generic = Math.max(0, parsedCost.generic - affinityDiscount);
            tapCost = _Mana.costToString(parsedCost);
            // Recalculate tapCmc from the actual parsed cost (not by subtracting from potentially already-reduced value)
            const coloredTotal = Object.values(parsedCost.colored as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
            tapCmc = parsedCost.generic + coloredTotal;
          }
        }

        // Pre-tap color check: build the available pool from untapped lands + mana sources + current pool,
        // then verify colors can be met BEFORE tapping anything. This prevents lands from
        // being tapped uselessly when the color requirement can't be met.
        // Note: even if tapCmc=0 (cost reduction), colored requirements may still exist
        const hasColoredCost = tapCost && _Mana && (() => {
          const p = _Mana.parseCost(tapCost);
          const coloredTotal = Object.values(p.colored as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
          return coloredTotal > 0;
        })();
        if (tapCost && (tapCmc > 0 || hasColoredCost) && _Mana) {
          const bf = gs.players[pid].zones.battlefield;
          const availPool: Record<string, number> = { ...(gs.manaPool[pid] || {}) };
          bf.cards
            .filter((c: any) => (c.type_line || '').toLowerCase().includes('land') && !c._tapped)
            .forEach((land: any) => {
              const colors = _Mana.getLandManaColors(land);
              colors.forEach((color: string) => { availPool[color] = (availPool[color] || 0) + 1; });
            });
          // Also count mana from non-land sources (artifacts/creatures with mana abilities)
          if (_Cards) {
            const isCreature = _Cards.isCreature(card);
            bf.cards
              .filter((c: any) => !c._tapped && !(c.type_line || '').toLowerCase().includes('land'))
              .filter((c: any) => {
                // Skip creatures with summoning sickness (can't tap for mana)
                if (_Cards.isCreature(c) && c._summoningSick && !_Cards.hasKeyword(c, 'Haste')) return false;
                return true;
              })
              .forEach((perm: any) => {
                const manaAbilities = _Cards.getManaAbilities(perm);
                for (const ability of manaAbilities) {
                  // Skip creature-only mana for non-creature spells
                  const restricted = ability.effects?.some((e: any) => e.restriction === 'creature_only');
                  if (restricted && !isCreature) continue;
                  // Count producible colors
                  for (const eff of (ability.effects || [])) {
                    if (eff.type !== 'add_mana') continue;
                    if (eff.color === 'any') {
                      // "any" mana can pay colored or generic — add to each needed color from spell cost
                      const spellCost = _Mana.parseCost(tapCost);
                      const neededColors = Object.entries(spellCost.colored).filter(([,v]) => v > 0).map(([c]) => c);
                      if (neededColors.length > 0) {
                        // Add to the first needed color that pool can't already cover
                        const uncovered = neededColors.find(c => (availPool[c] || 0) < (spellCost.colored[c] || 0));
                        const pickColor = uncovered || neededColors[0];
                        availPool[pickColor] = (availPool[pickColor] || 0) + 1;
                      } else {
                        availPool['C'] = (availPool['C'] || 0) + 1;
                      }
                    }
                    else if (eff.color) {
                      // Resolve dynamic amounts like "power" to actual numbers
                      let amt = eff.amount || 1;
                      if (typeof amt === 'string') {
                        if (amt === 'power') amt = _Cards.getPower(perm) || 0;
                        else if (amt === 'toughness') amt = _Cards.getToughness(perm) || 0;
                        else amt = parseInt(amt, 10) || 1;
                      }
                      availPool[eff.color] = (availPool[eff.color] || 0) + amt;
                    }
                    else if (eff.colors) { for (const ec of eff.colors) availPool[ec] = (availPool[ec] || 0) + 1; }
                  }
                }
                // Also count filter/devotee mana abilities ({1}: add {color})
                // These don't add net mana but provide COLOR FIXING — they convert a generic land tap into needed color
                const filterAbilities = _Cards.getFilterManaAbilities(perm);
                for (const fAbility of filterAbilities) {
                  const usedKey = perm._uid + '_' + JSON.stringify(fAbility.effects.map((e: any) => e.type));
                  if (gs._abilityUsedThisTurn?.[usedKey]) continue;
                  for (const eff of (fAbility.effects || [])) {
                    if (eff.type !== 'add_mana') continue;
                    if (eff.colors && Array.isArray(eff.colors)) {
                      for (const ec of eff.colors) availPool[ec] = (availPool[ec] || 0) + 1;
                    } else if (eff.color && eff.color.length > 1 && eff.choose) {
                      for (const ec of eff.color.split('')) availPool[ec] = (availPool[ec] || 0) + 1;
                    } else if (eff.color) {
                      availPool[eff.color] = (availPool[eff.color] || 0) + 1;
                    }
                  }
                }
              });
          }
          if (!_Mana.canPay(availPool, tapCost, tapCmc)) {
            // Can't afford — abort without tapping anything
            refresh();
            return;
          }
        }

        // Use the real auto-tap system (handles colored mana, convoke, etc.)
        // Save pool snapshot so we can roll back if castSpell fails (e.g. hybrid mana edge cases)
        const poolSnapshot = (tapCost && tapCmc > 0) ? { ...gs.manaPool[pid] } : null;
        // Save full pre-cast snapshot (before auto-tap) for modal cancel undo
        const tappedBefore = gs.players[pid].zones.battlefield.cards
          .filter((c: any) => c._tapped).map((c: any) => c._uid);
        gs._preCastManaSnapshot = {
          pool: { ...gs.manaPool[pid] },
          tapped: tappedBefore,
          playerId: pid,
        };
        let tappedByAutoTap: string[] = [];
        if (tapCost && (tapCmc > 0 || hasColoredCost)) {
          tappedByAutoTap = _GS.autoTapForSpell(gs, pid, tapCost, tapCmc, card) || [];
        }

        const result = _GS.castSpell(gs, pid, cardUid, targets);

        // Roll back tapped lands if cast failed (prevents "tapped but not cast" freeze)
        // BUT don't roll back if paused (behold choice pending — mana already committed)
        if (result?.success === false && !result.paused) {
          console.warn(`[CAST-FAIL] ${card.name}: ${result.msg}, tapCost=${tapCost}, tapCmc=${tapCmc}`);
        }
        if (result?.success === false && !result.paused && tappedByAutoTap.length > 0 && poolSnapshot) {
          const bf = gs.players[pid].zones.battlefield;
          for (const uid of tappedByAutoTap) {
            const land = bf.get(uid);
            if (land) land._tapped = false;
          }
          gs.manaPool[pid] = poolSnapshot;
          // Show toast for restricted mana (Herd Heirloom creature-only)
          if (result.msg === 'restricted_mana') {
            if (typeof (window as any).__gameToast === 'function') {
              (window as any).__gameToast(`⚠️ Mana restrita! Essa mana só pode ser usada para conjurar tipos específicos (Dragões, Omens, Criaturas).`, 'warning');
            }
          }
          refresh();
          return;
        }

        // Clear mana undo when spell successfully starts casting
        if (result?.success !== false) clearManaUndo();

        // Auto-resolve stack priority after the human casts a spell during stack_priority.
        // GameStack.resolve resolves ALL items in the stack (human's spell + AI's pending spell),
        // so by the time castSpell returns, the AI's pending spell is either:
        //   a) Countered (_countered=true): send to GY, clean up
        //   b) Resolved normally (unless_pay paid, or non-counter instant cast): just clean up
        // Without this cleanup, _pendingCastOnStack remains → pass handler re-casts AI's spell!
        const pending = (gs as any)._pendingCastOnStack;
        if (pending && gs.waitingForInput?.type === 'stack_priority') {
          if (pending.card?._countered === true) {
            // Counter was successful
            if ((gs as any).stack?.items?.length > 0) (gs as any).stack.items.pop();
            delete (gs as any)._pendingCastOnStack;
            delete pending.card._countered;
            gs.players[pending.playerId].zones.graveyard.add(pending.card);
            gs.log.push(`${pending.card.name} vai para o cemiterio (anulado).`);
            (gs as any)._lastCounteredSpell = pending.card.name;
            if (typeof _GS.reprocessCurrentPhase === 'function') {
              _GS.reprocessCurrentPhase(gs);
            }
          } else {
            // Human cast a non-counter spell during stack_priority.
            // The AI's pending spell was NOT countered — it still needs to resolve.
            // Pop the temporary stack item and complete the cast now.
            if ((gs as any).stack?.items?.length > 0) (gs as any).stack.items.pop();
            delete (gs as any)._pendingCastOnStack;
            if (pending.card && _GS.castSpell) {
              (gs as any)._resumingFromStackPriority = true;
              gs.players[pending.playerId].zones.hand.add(pending.card);
              _GS.castSpell(gs, pending.playerId, pending.card._uid, pending.targets || [], pending.isAdventure || false, pending.isEvoke || false);
            }
            // Only clear stack_priority — don't overwrite overlays set by castSpell (distribute_damage, modal_choice, etc.)
            if (!gs.waitingForInput || gs.waitingForInput.type === 'stack_priority') {
              gs.waitingForInput = null;
            }
            if (!gs.waitingForInput && typeof _GS.reprocessCurrentPhase === 'function') {
              _GS.reprocessCurrentPhase(gs);
            }
          }
        }

        // Give AI a chance to react with removal/bounce/counter after human casts a spell.
        // Fires when: cast succeeded and either no overlay OR stack_priority is active (AI must respond).
        const isAIStackPriority = gs.waitingForInput?.type === 'stack_priority' && gs.waitingForInput?.playerId === 1;
        if (
          result?.success !== false &&
          (!gs.waitingForInput || isAIStackPriority) &&
          _AI &&
          pid === 0
        ) {
          // Cancel any previous pending AI reaction
          if ((window as any).__aiStackReactTimer) {
            clearTimeout((window as any).__aiStackReactTimer);
          }
          const hand = gs.players[pid].zones.hand.getAll();
          const castCard = hand.find((c: any) => c._uid === cardUid);
          if (!castCard || !castCard.type_line?.includes('Land')) {
            (window as any).__aiStackReactTimer = setTimeout(() => {
              (window as any).__aiStackReactTimer = null;
              const currentGs = gsRef.current;
              if (!currentGs) return;
              // Guard: only block if an overlay OTHER than stack_priority is open
              const wfi = currentGs.waitingForInput;
              if (wfi && wfi.type !== 'stack_priority') return;
              // Guard: only react during main phase (not already in a special priority window)
              const ph = currentGs.phase;
              if (ph !== 'main1' && ph !== 'main2') return;
              (_AI as any).playInstantPhase?.(currentGs, 1, 'stack_priority');
              // Safety: if AI didn't react and stack_priority is still for AI (pid=1), auto-pass
              if (currentGs.waitingForInput?.type === 'stack_priority' && currentGs.waitingForInput?.playerId === 1) {
                const pending = (currentGs as any)._pendingCastOnStack;
                if (pending) {
                  if ((currentGs as any).stack?.items?.length > 0) (currentGs as any).stack.items.pop();
                  delete (currentGs as any)._pendingCastOnStack;
                  currentGs.waitingForInput = null;
                  if (!pending.card._countered) {
                    (currentGs as any)._resumingFromStackPriority = true;
                    currentGs.players[pending.playerId].zones.hand.add(pending.card);
                    _GS?.castSpell(currentGs, pending.playerId, pending.card._uid, pending.targets || [], pending.isAdventure || false, pending.isEvoke || false);
                  }
                } else {
                  currentGs.waitingForInput = null;
                }
                if (!currentGs.waitingForInput && _GS) _GS.reprocessCurrentPhase(currentGs);
              }
              refresh();
            }, 400); // slightly longer to let ETB overlays open first
          }
        }

        // Fallback: fire becomes_tapped triggers after castSpell returns (in case castSpell didn't catch them)
        if (result?.success !== false && _GS?.detectAndFireTapTriggers) {
          _GS.detectAndFireTapTriggers(gs);
        }

        // Ensure human stays in main_phase after successful cast (prevents race with autoPass)
        if (result?.success !== false && !gs.waitingForInput &&
            (gs.phase === 'main1' || gs.phase === 'main2') && gs.players[pid]?.isHuman) {
          gs.waitingForInput = { type: 'main_phase', playerId: pid };
        }

        // Re-give instant priority during combat if human still has playable instants
        // (MTG: after a spell resolves, active player gets priority again)
        if (result?.success !== false && !gs.waitingForInput && gs.players[pid]?.isHuman &&
            gs.phase !== 'main1' && gs.phase !== 'main2' && _GS) {
          const playable = _GS.getPlayableCards(gs, pid);
          if (playable.length > 0) {
            gs.waitingForInput = { type: 'instant_priority', playerId: pid, phase: gs.phase };
          }
        }

        refresh();
      } catch (e) {
        console.warn('[castSpell] error:', e);
      }
    },

    // Resolve delve choice: check if cast is affordable with delve, then exile + cast
    resolveDelveChoice(selectedUids: string[]) {
      const gs = gsRef.current;
      if (!gs) return;
      const pending = gs._pendingDelveChoice;
      if (!pending) return;

      const { playerId, cardUid, targets } = pending;
      const exiledCount = selectedUids.length;

      // Pre-check: can the player afford the spell after delve reduction?
      const hand = gs.players[playerId].zones.hand.getAll();
      let card = hand.find((c: any) => c._uid === cardUid);
      if (!card && gs._exiledPlayable?.[cardUid]) card = gs._exiledPlayable[cardUid].card;
      if (card && _Mana) {
        let tapCost = card.mana_cost;
        if (tapCost && tapCost.includes('//')) tapCost = tapCost.split('//')[0].trim();
        const parsed = _Mana.parseCost(tapCost);
        const reducedCmc = Math.max(0, (parsed.total || card.cmc || 0) - exiledCount);
        if (!_Mana.canAfford(gs, playerId, { mana_cost: tapCost, cmc: reducedCmc }, tapCost, reducedCmc)) {
          // Can't afford even with delve — cancel, don't exile
          gs._pendingDelveChoice = null;
          gs.waitingForInput = null;
          gs.log.push(`Mana insuficiente mesmo com delve (${exiledCount} cartas). Cast cancelado.`);
          afterResolve(gs);
          refresh();
          return;
        }
      }

      gs._pendingDelveChoice = null;
      gs.waitingForInput = null;

      const gy = gs.players[playerId].zones.graveyard;
      const exile = gs.players[playerId].zones.exile;

      let actualExiled = 0;
      for (const uid of selectedUids) {
        const gyCard = gy.get ? gy.get(uid) : (gy.cards || []).find((c: any) => c._uid === uid);
        if (!gyCard) continue;
        if (gy.remove) gy.remove(uid); else { const idx = (gy.cards || []).findIndex((c: any) => c._uid === uid); if (idx >= 0) gy.cards.splice(idx, 1); }
        if (exile.add) exile.add(gyCard); else (exile.cards = exile.cards || []).push(gyCard);
        gs.log.push(`Delve: ${gyCard.name} exilado para pagar {1}.`);
        actualExiled++;
      }

      // Store the reduction so castSpell knows to apply it and skip auto-delve
      gs._pendingDelveReduction = actualExiled;

      // Resume the cast (castSpell action will apply _pendingDelveReduction)
      actions.castSpell(cardUid, targets);
    },

    // Cast as adventure/omen mode (5th param castingAdventure = true)
    castAdventure(cardUid: string, targets: any[] = []) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      const pid = 0;
      try {
        const hand = gs.players[pid].zones.hand.getAll();
        let card = hand.find((c: any) => c._uid === cardUid);
        // Also check exiled playable cards
        let isFreeCastFromExile = false;
        if (!card && gs._exiledPlayable && gs._exiledPlayable[cardUid]) {
          card = gs._exiledPlayable[cardUid].card;
          isFreeCastFromExile = !!gs._exiledPlayable[cardUid].freeCast;
        }
        if (!card) return;

        // Free cast from exile: skip mana, go straight to engine
        if (isFreeCastFromExile) {
          _GS.castSpell(gs, pid, cardUid, targets, true);
          afterResolve(gs);
          refresh();
          return;
        }

        // Tap mana for the adventure cost (not the creature cost)
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
          let advCmc = _Mana.parseCost(advCost).total || 0;

          // X-cost omens: prompt human for X value (Exude Toxin, etc.)
          if (advCost.includes('{X}')) {
            const fixedCostStr = advCost.replace(/\{X\}/g, '');
            const fixedParsed = _Mana.parseCost(fixedCostStr);
            const fixedTotal = fixedParsed.total || 0;
            const totalAvailable = (Object.values(advPool) as number[]).reduce((s: number, v) => s + (v as number), 0);
            const maxX = Math.max(0, totalAvailable - fixedTotal);

            if (gs._pendingXChoice === undefined) {
              gs._pendingXCast = { cardUid, card, targets, tapCost: advCost, fixedTotal, maxX, isAdventure: true };
              gs.waitingForInput = { type: 'choose_x_cost', playerId: 0 };
              refresh();
              return;
            }
            const chosenX = gs._pendingXChoice as number;
            delete gs._pendingXChoice;
            gs._humanChosenX = chosenX;
            advCmc = fixedTotal + chosenX;
          }

          if (!_Mana.canPay(advPool, advCost, advCmc)) { refresh(); return; }
          // Pass null as card: adventure/omen side is a sorcery, NOT a creature
          // so creature-only mana (Herd Heirloom) should NOT be used
          _GS.autoTapForSpell(gs, pid, advCost, advCmc, null);
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

        let colors = _Mana.getLandManaColors(card);
        // Filter conditional add_mana abilities (e.g. Grey Havens: any-color only if legendary in GY)
        if (colors.length > 1 && _Cards) {
          const db = (_Cards as any).getPreprocessedEffects(card);
          if (db?.activated) {
            const condAny = db.activated.find((a: any) =>
              a.effects?.some((e: any) => e.type === 'add_mana' && e.color === 'any' && e.condition)
            );
            if (condAny) {
              const cond = condAny.effects.find((e: any) => e.type === 'add_mana' && e.color === 'any')?.condition;
              let conditionMet = false;
              if (cond === 'legendary_creature_in_gy') {
                conditionMet = gs.players[0].zones.graveyard.getAll().some(
                  (c: any) => _Cards.isCreature(c) && (c.type_line || '').toLowerCase().includes('legendary')
                );
              }
              if (!conditionMet) {
                // Remove the 'any' ability's colors — keep only colors from unconditional abilities
                const safeColors: string[] = [];
                for (const ab of db.activated) {
                  const addManaEff = ab.effects?.find((e: any) => e.type === 'add_mana' && !e.condition);
                  if (addManaEff) {
                    if (addManaEff.color && addManaEff.color !== 'any') safeColors.push(addManaEff.color);
                    else if (addManaEff.colors) safeColors.push(...addManaEff.colors);
                  }
                }
                if (safeColors.length > 0) colors = safeColors;
              }
            }
          }
        }
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
          setUndoManaCount(tapUndoRef.current.length);
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
      setUndoManaCount(tapUndoRef.current.length);
      if (tapUndoRef.current.length === 0) setCanUndoMana(false);
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
          // Only allow attack if not tapped, not summoning sick, and doesn't have Defender
          const hasHaste = card._tempKeywords?.includes('Haste') ||
            (card.keywords || []).some((k: string) => k?.toLowerCase() === 'haste') ||
            (card.oracle_text || '').toLowerCase().includes('haste');
          const hasDefender = (card.keywords || []).some((k: string) => k?.toLowerCase() === 'defender') ||
            (card._tempKeywords || []).some((k: any) => (typeof k === 'string' ? k : k?.keyword || '').toLowerCase() === 'defender');
          const hasCanAttack = (card.keywords || []).some((k: string) => k?.toLowerCase().replace(/_/g, ' ') === 'can attack') ||
            (card._tempKeywords || []).some((k: any) => (typeof k === 'string' ? k : k?.keyword || '').toLowerCase().replace(/_/g, ' ') === 'can attack');
          console.log(`[ATTACK CHECK] ${card.name}: tapped=${card._tapped}, sick=${card._summoningSick}, haste=${hasHaste}, defender=${hasDefender}, canAttack=${hasCanAttack}, preventUntap=${card._preventUntap}`);
          if (!card._tapped && (!card._summoningSick || hasHaste) && (!hasDefender || hasCanAttack)) {
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
        // Only clear waitingForInput if no new pending input was set by the resolution
        if (!gs.waitingForInput) gs.waitingForInput = null;
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

    resolveGraveyardToTop(cardUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveGraveyardToTop(gs, cardUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGraveyardToTop] error:', e); }
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

    resolveMillTargetChoice(targetSelf: boolean) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveMillTargetChoice(gs, targetSelf);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveMillTargetChoice] error:', e); }
    },

    resolveWatcherTentacleUntap(krakenUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveWatcherTentacleUntap(gs, krakenUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveWatcherTentacleUntap] error:', e); }
    },

    resolveWatcherTentacleStun(targetUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveWatcherTentacleStun(gs, targetUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveWatcherTentacleStun] error:', e); }
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

    resolveSpiritDragonsChoice(dragonUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveSpiritDragonsChoice(gs, dragonUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveSpiritDragonsChoice] error:', e); }
    },

    resolvePostModalTarget(target: any) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        console.log(`[resolvePostModalTarget] target=${target}, _pendingModalResolution=${!!gs._pendingModalResolution}, waitingForInput=${gs.waitingForInput?.type}`);
        _GS.resolvePostModalTarget(gs, target);
        console.log(`[resolvePostModalTarget] AFTER: waitingForInput=${gs.waitingForInput?.type}`);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolvePostModalTarget] error:', e); }
    },

    cancelModal() {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.cancelModal === 'function') {
          _GS.cancelModal(gs);
        } else {
          // Fallback: clear modal state and restore card to hand
          gs._pendingModal = null;
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[cancelModal] error:', e); }
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

    activateBattlefieldAbility(cardUid: string, abilityIdx: number, xValue?: number) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.activateBattlefieldAbility === 'function') {
          _GS.activateBattlefieldAbility(gs, 0, cardUid, abilityIdx, xValue);
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

        // If this land's activated ability has a mana cost (e.g. Shire Terrace: {1}, {T}, Sacrifice)
        // validate and pay it before sacrificing.
        if (_Cards && _Mana && _GS) {
          const abilities = _Cards.getActivatedAbilities(land);
          const sacAbility = abilities.find((a: any) => a.cost?.sacrifice === true);
          if (sacAbility?.cost?.mana) {
            const costStr = _Mana.formatManaCost(sacAbility.cost.mana);
            const parsed = _Mana.parseCost(costStr);
            const cmc = parsed.total || 0;
            const canAfford = _Mana.canAfford(gs, 0, { mana_cost: costStr, cmc } as any, costStr, cmc);
            if (!canAfford) {
              gs.log.push(`${land.name}: insufficient mana — need ${costStr}.`);
              if (typeof (window as any).__gameToast === 'function') {
                (window as any).__gameToast(`Insufficient mana to activate ${land.name}.`, 'warning');
              }
              refresh();
              return;
            }
            _GS.autoTapForSpell(gs, 0, costStr, cmc);
            gs.manaPool[0] = _Mana.payMana(gs.manaPool[0], costStr, cmc);
          }
        }

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
          afterResolve(gs);
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

      // Can't be blocked by more than one creature (e.g. Glorfindel mode 2)
      const attacker = gs.players[1].zones.battlefield.getAll().find((c: any) => c._uid === attackerUid);
      if (attacker && (attacker.keywords || []).some((k: string) => k.toLowerCase().includes('cant be blocked by more than one'))) {
        if (!gs.combat.blockers[attackerUid]) gs.combat.blockers[attackerUid] = [];
        if (gs.combat.blockers[attackerUid].length >= 1) {
          // Already has a blocker — reject this assignment
          return;
        }
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
        const defenderBf = gs.players[1 - gs.activePlayer].zones.battlefield.getAll();
        for (const entry of (gs.combat.attackers || [])) {
          const attackerCard = attackersBf.find((c: any) => c._uid === (entry.uid || entry));
          if (!attackerCard) continue;
          const hasMenace = (_Cards.hasKeyword as any)(attackerCard, 'Menace');
          if (hasMenace) {
            const blockerList = gs.combat.blockers[attackerCard._uid] || [];
            if (blockerList.length === 1) {
              const singleBlocker = blockerList[0]?.card;
              if (singleBlocker) singleBlocker._blocking = null;
              gs.combat.blockers[attackerCard._uid] = [];
              gs.log.push(`Blqueio invalido! ${attackerCard.name} tem Menace e precisa de 2+ bloqueadores. Bloqueio removido.`);
            }
          }
          // must_be_blocked: at least one creature must block this attacker if able
          const mustBlock = (attackerCard.keywords || []).some((k: string) => k?.toLowerCase() === 'must be blocked') ||
            (attackerCard._tempKeywords || []).some((t: any) => (typeof t === 'string' ? t : t.keyword)?.toLowerCase() === 'must be blocked');
          if (mustBlock) {
            const assigned = gs.combat.blockers[attackerCard._uid] || [];
            if (assigned.length === 0) {
              const canBlockIt = defenderBf.some((b: any) =>
                _Cards.isCreature(b) && !b._tapped && _Cards.canBlock(b, attackerCard, gs)
              );
              if (canBlockIt) {
                gs.log.push(`${attackerCard.name} deve ser bloqueado! Atribua pelo menos um bloqueador.`);
                refresh();
                return; // Prevent advancing — force player to assign blockers
              }
            }
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
      if (!gs || !_GS || !_Mana) return;
      try {
        // X-cost harmonize: prompt human for X value before casting
        const card = gs.players[0].zones.graveyard.get(cardUid);
        if (card) {
          const hCost = _Cards?.getHarmonizeCost(card);
          if (hCost && hCost.includes('{X}') && gs._pendingXChoice === undefined) {
            // Calculate max X available
            const bf = gs.players[0].zones.battlefield;
            const availPool: Record<string, number> = { ...(gs.manaPool[0] || {}) };
            bf.cards
              .filter((c: any) => (c.type_line || '').toLowerCase().includes('land') && !c._tapped)
              .forEach((land: any) => {
                const colors = _Mana!.getLandManaColors(land);
                colors.forEach((color: string) => { availPool[color] = (availPool[color] || 0) + 1; });
              });
            const totalAvail = (Object.values(availPool) as number[]).reduce((s: number, v) => s + (v as number), 0);
            const fixedStr = hCost.replace(/\{X\}/g, '');
            const fixedTotal = _Mana!.parseCost(fixedStr).total || 0;
            // Factor in creature tap discount
            let discount = 0;
            if (tappedCreatureUid) {
              const cr = bf.get(tappedCreatureUid);
              if (cr && _Cards?.isCreature(cr) && !cr._tapped) discount = _Cards.getPower(cr);
            }
            const maxX = Math.max(0, totalAvail - Math.max(0, fixedTotal - discount));
            gs._pendingXCast = { cardUid, card, targets, tapCost: hCost, fixedTotal, maxX, isHarmonize: true, tappedCreatureUid };
            gs.waitingForInput = { type: 'choose_x_cost', playerId: 0 };
            refresh();
            return;
          }
          // Resume with chosen X
          if (gs._pendingXChoice !== undefined) {
            const chosenX = gs._pendingXChoice as number;
            delete gs._pendingXChoice;
            gs._humanChosenX = chosenX;
          }
        }
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
        const result = _GS.equipCreature(gs, 0, equipmentUid, creatureUid);
        if (result !== false) afterResolve(gs);
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
        // Only clear WFI if the engine fully resolved the mana choice (no more pending picks).
        // If _pendingManaChoice is still set, we're mid-combination (Wizard's Rockets "any combination")
        // and must keep the overlay open for the remaining picks.
        if (!gs._pendingManaChoice) {
          if (!gs.waitingForInput || gs.waitingForInput.type === 'mana_color_choice') {
            gs.waitingForInput = null;
          }
        }

        // Track undo entry for land taps and mana abilities (Dragonstorm Globe etc.)
        if (tapCardUid) {
          tapUndoRef.current.push({ uid: tapCardUid, color });
          setCanUndoMana(true);
          setUndoManaCount(tapUndoRef.current.length);
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
        if (!gs.waitingForInput || gs.waitingForInput.type === 'endure_choice') gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveEndure] error:', e); }
    },

    resolveMillLand(choice: string, landUid?: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveMillLandChoice(gs, choice as 'land' | 'counter', landUid);
        if (!gs.waitingForInput || gs.waitingForInput.type === 'mill_land_choice') gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveMillLand] error:', e); }
    },

    resolveBlight(creatureUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveBlightChoice(gs, creatureUid);
        if (!gs.waitingForInput || gs.waitingForInput.type === 'blight_choice') gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveBlight] error:', e); }
    },

    resolveBuffChoiceAction(creatureUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveBuffChoice(gs, creatureUid);
        // resolveBuffChoice already clears waitingForInput internally.
        // Do NOT force-null here — it may have queued a second buff_choice trigger
        // (e.g. two Riling Dawnbreakers both triggering on combat_begin).
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveBuffChoiceAction] error:', e); }
    },

    resolveWardChoice(choice: 'pay' | 'decline' | 'repick') {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveWardChoice(gs, choice);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveWardChoice] error:', e); }
    },

    resolveGrantTargetChoice(creatureUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveGrantTarget(gs, creatureUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGrantTargetChoice] error:', e); }
    },

    resolveEowynGrantChoice(creatureUid: string, keyword: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveEowynGrant(gs, creatureUid, keyword);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveEowynGrantChoice] error:', e); }
    },

    resolveChooseOpponentDiscard(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveChooseOpponentDiscard(gs, cardUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveChooseOpponentDiscard] error:', e); }
    },

    resolveRingBearerChoice(creatureUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveRingBearerChoice(gs, creatureUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveRingBearerChoice] error:', e); }
    },

    resolveDistributeCountersAction(distribution: Record<string, number>) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveDistributeCounters(gs, distribution);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveDistributeCounters] error:', e); }
    },

    resolveHandExile(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveHandExileChoice(gs, cardUid);
        // Only clear waitingForInput if no new pending input was set (e.g. counter target choice)
        if (!gs.waitingForInput) gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveHandExile] error:', e); }
    },

    resolveGraveyardCastChoice(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveGraveyardCastChoice(gs, cardUid);
        // DON'T null waitingForInput here — the callback inside resolveGraveyardCastChoice
        // may have set a NEW waitingForInput (e.g. ETB of copied creature needs human input)
        if (!gs.waitingForInput) {
          afterResolve(gs);
        }
        refresh();
      } catch (e) { console.warn('[resolveGraveyardCastChoice] error:', e); }
    },

    resolveAttachChoice(shouldEquip: boolean) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveAttachChoice(gs, shouldEquip);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveAttachChoice] error:', e); }
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
        // Only clear waitingForInput if resolveTriggerCost didn't set a new input state
        // (e.g. endure_choice, scry, etc.) — don't override those!
        if (!gs.waitingForInput || gs.waitingForInput.type === 'trigger_cost') {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveTriggerCostAction] error:', e); }
    },

    resolveUnlessPayAction(shouldPay: boolean) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveUnlessPay(gs, shouldPay);
        if (!gs.waitingForInput || gs.waitingForInput.type === 'unless_pay') gs.waitingForInput = null;
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
          // Resume cast — skip the pre-cast legendary check (castSpell handles legend rule internally now)
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

    // ── behold_choice: player reveals a dragon from hand, then re-casts the paused spell ──
    resolveBeholdChoice(uid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        const pending = (gs as any)._pendingBeholdChoice;
        gs.waitingForInput = null;
        delete (gs as any)._pendingBeholdChoice;

        // ETB behold (e.g. Sarkhan Dragon Ascendant): no cardUid, just set _beholding
        // and let remaining ETB effects (saved in _pendingStackEffects) continue
        if (!pending?.cardUid) {
          if (pending?.source === 'etb' && uid) {
            // Find the dragon card by uid and mark as beheld
            const dragonCard = (pending.cards || []).find((c: any) => c._uid === uid);
            if (dragonCard) {
              if (!gs._beholding) gs._beholding = {};
              gs._beholding[0] = dragonCard;
              gs.log.push(`${dragonCard.name} revelado (behold Dragon).`);
            }
          }
          // Process remaining stack effects (e.g. create_token with if_beheld_dragon)
          if ((gs as any)._pendingStackEffects) {
            const pse = (gs as any)._pendingStackEffects;
            (gs as any)._pendingStackEffects = null;
            if (_Stack && pse.effects?.length > 0) {
              _Stack.resolveEffects(gs, pse.controller, pse.card, pse.effects, pse.targets || []);
            }
          }
          afterResolve(gs);
          refresh();
          return;
        }

        // Find the paused spell still in hand
        const allHand: any[] = gs.players[0].zones.hand.getAll
          ? gs.players[0].zones.hand.getAll()
          : [];
        const spellCard = allHand.find((c: any) => c._uid === pending.cardUid);

        if (!spellCard) {
          // Card no longer in hand (shouldn't happen) — just continue
          afterResolve(gs);
          refresh();
          return;
        }

        if (uid) {
          // User chose to behold a dragon — mark spell card for resume
          spellCard._beholdPaid = true;
          spellCard._beholdCardUid = uid;
        } else {
          // User declined behold — pay alternate cost if any, mark as declined
          spellCard._beholdDeclined = true;
          const beholdCost = pending.beholdCost;
          if (beholdCost?.alternateCost && _Mana) {
            const extraCost = `{${beholdCost.alternateCost}}`;
            if (typeof (_GS as any).autoTapForSpell === 'function') {
              (_GS as any).autoTapForSpell(gs, 0, extraCost, beholdCost.alternateCost);
            }
            gs.manaPool[0] = (_Mana as any).payMana(gs.manaPool[0], extraCost, beholdCost.alternateCost);
            gs.log.push(`Voce paga ${extraCost} (behold recusado).`);
          }
        }

        // Base spell cost was already paid in the first castSpell call (before behold overlay paused).
        // Skip re-tapping for base cost; just flag engine to skip the mana check on second cast.
        gs._beholdManaAlreadyPaid = true;

        // Re-cast (behold block will be skipped via _beholdPaid/_beholdDeclined flags)
        // Restore original targets (e.g. counterspell target that was passed when first cast)
        const originalTargets = pending.targets || [];
        const result = _GS.castSpell(gs, 0, pending.cardUid, originalTargets);
        if (result?.success === false && !result?.paused) {
          // Failed for some other reason — nothing more to do
          refresh();
          return;
        }

        clearManaUndo();
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveBeholdChoice]', e); }
    },

    // ── order_blockers: resolve with manually chosen order or AI heuristic ──
    resolveOrderBlockers(manualOrder?: Record<string, string[]>) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        if (manualOrder && gs.combat) {
          // Apply manually chosen blocker order
          for (const [attackerUid, orderedUids] of Object.entries(manualOrder)) {
            gs.combat.blockerOrder[attackerUid] = orderedUids;
          }
        } else if (typeof (_GS as any)?.orderBlockers === 'function') {
          (_GS as any).orderBlockers(gs, 0); // Fallback: AI heuristic
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

    // ── Put card on bottom of library ────────────────────────────────────────

    resolvePutOnBottom(cardUid: string) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const hand = gs.players[0].zones.hand;
        const lib  = gs.players[0].zones.library;
        const card = hand.getAll().find((c: any) => c._uid === cardUid);
        if (card) {
          hand.remove(card._uid);
          lib.addToBottom(card);
          gs.log.push(`${card.name} é posto na base do grimório.`);
        }
        gs._pendingPutOnBottom = null;
        gs.waitingForInput = null;
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolvePutOnBottom] error:', e); }
    },

    // ── Discard overlays ────────────────────────────────────────────────────

    resolveDiscard(cardUids: string[]) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const hand = gs.players[0].zones.hand;
        const gy = gs.players[0].zones.graveyard;

        // Handle activated ability discard cost (e.g. Witch-king of Angmar)
        const activationPending = gs._pendingActivationDiscard;
        if (activationPending) {
          cardUids.forEach((uid: string) => {
            const card = hand.getAll().find((c: any) => c._uid === uid);
            if (card) {
              hand.remove(card._uid);
              gy.add(card);
              gs.log.push(`Voce descarta ${card.name}.`);
            }
          });
          gs._pendingActivationDiscard = null;
          gs.waitingForInput = null;
          gs._skipDiscardCost = true;
          _GS?.activateBattlefieldAbility(gs, activationPending.pid, activationPending.creatureUid, activationPending.abilityIdx);
          delete gs._skipDiscardCost;
          afterResolve(gs);
          refresh();
          return;
        }

        // Handle additional cast cost discard (e.g. Quarrel's End)
        const castPending = gs._pendingCastDiscard;
        if (castPending) {
          cardUids.forEach((uid: string) => {
            const card = hand.getAll().find((c: any) => c._uid === uid);
            if (card) {
              hand.remove(card._uid);
              gy.add(card);
              gs.log.push(`Voce descarta ${card.name}.`);
            }
          });
          gs._pendingCastDiscard = null;
          gs.waitingForInput = null;
          gs._skipAdditionalCostCheck = true;
          _GS?.castSpell(gs, castPending.playerId, castPending.cardUid, castPending.targets,
            castPending.isAdventure, castPending.isEvoke);
          delete gs._skipAdditionalCostCheck;
          afterResolve(gs);
          refresh();
          return;
        }

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
        // Clear the discard waitingForInput BEFORE checking bonus effects
        // (resolveOnNonlandDiscard may set a NEW waitingForInput like etb_any_damage_target)
        gs.waitingForInput = null;
        // Glacial Dragonhunt: after discarding a nonland, resolve bonus effects
        const onNonlandDiscard = pending?.onNonlandDiscard;
        if (discarded && onNonlandDiscard?.length > 0) {
          const gy2 = gs.players[0].zones.graveyard;
          const justDiscarded = cardUids.map((uid: string) => gy2.getAll().find((c: any) => c._uid === uid)).filter(Boolean);
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
        // Only reprocess if no new waitingForInput was set (e.g. damage target from Glacial Dragonhunt)
        if (!gs.waitingForInput) {
          if (typeof _GS?.reprocessCurrentPhase === 'function') {
            _GS.reprocessCurrentPhase(gs);
          }
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

    // ── ETB destroy target (human chose which permanent to destroy) ──────────

    resolveETBDestroyTarget(targetUids: string | string[] | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveETBDestroyTarget === 'function') {
          _GS.resolveETBDestroyTarget(gs, targetUids);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveETBDestroyTarget]', e); }
    },

    // ── Graveyard trigger pay choice (e.g. Furious Forebear) ──────────────────

    resolveCounterInheritance(targetUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveCounterInheritance === 'function') {
          _GS.resolveCounterInheritance(gs, targetUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveCounterInheritance]', e); }
    },

    resolveExileGYCreatureCost(cardUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveExileGYCreatureCost === 'function') {
          _GS.resolveExileGYCreatureCost(gs, cardUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveExileGYCreatureCost]', e); }
    },

    resolveExileGYCardsCost(uids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveExileGYCardsCost === 'function') {
          _GS.resolveExileGYCardsCost(gs, uids);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveExileGYCardsCost]', e); }
    },

    resolveGraveyardTrigger(accepted: boolean) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveGraveyardTrigger === 'function') {
          _GS.resolveGraveyardTrigger(gs, accepted);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGraveyardTrigger]', e); }
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

    // ── ETB tap target (human chose which creature(s) to tap) ─────────────────

    resolveETBTapTarget(targetUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveETBTapTarget === 'function') {
          _GS.resolveETBTapTarget(gs, targetUids);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveETBTapTarget]', e); }
    },

    // ── ETB cant_block target (Summit Intimidator etc.) ─────────────────────
    resolveETBCantBlockTarget(targetUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveETBCantBlockTarget === 'function') {
          _GS.resolveETBCantBlockTarget(gs, targetUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveETBCantBlockTarget]', e); }
    },

    // ── ETB exile target (human chose which permanent(s) to exile) ───────────

    resolveETBDamageTarget(target: { type: 'creature' | 'player' | 'permanent'; uid?: string; player?: number }) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveETBDamageTarget === 'function') {
          _GS.resolveETBDamageTarget(gs, target);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveETBDamageTarget]', e); }
    },

    resolveETBExileTarget(targetUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveETBExileTarget === 'function') {
          _GS.resolveETBExileTarget(gs, targetUids);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveETBExileTarget]', e); }
    },

    resolveSacrificeTokenChoice(tokenUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof (_GS as any).resolveSacrificeTokenChoice === 'function') {
          (_GS as any).resolveSacrificeTokenChoice(gs, tokenUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveSacrificeTokenChoice]', e); }
    },

    resolveGrishnakhSteal(targetUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof (_GS as any).resolveGrishnakhSteal === 'function') {
          (_GS as any).resolveGrishnakhSteal(gs, targetUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGrishnakhSteal]', e); }
    },

    resolveGainControlTarget(targetUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        (_GS as any).resolveGainControlTarget(gs, targetUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGainControlTarget]', e); gs.waitingForInput = null; refresh(); }
    },

    resolveChooseSparedCreatures(sparedUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        (_GS as any).resolveChooseSparedCreatures(gs, sparedUids);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveChooseSparedCreatures]', e); gs.waitingForInput = null; refresh(); }
    },

    // ── ETB counter target (human chose which creature to buff with counter) ──
    resolveETBCounterTarget(targetUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveETBCounterTarget === 'function') {
          _GS.resolveETBCounterTarget(gs, targetUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveETBCounterTarget]', e); }
    },

    // ── ETB remove all counters target (Purging Stormbrood) ──────────────────
    resolveETBRemoveCountersTarget(targetUid: string | null) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const pending = gs._pendingRemoveCountersAll;
        delete gs._pendingRemoveCountersAll;
        gs.waitingForInput = null;
        if (targetUid && pending) {
          // Find the creature across both players
          for (const p of gs.players) {
            const card = p.zones.battlefield.get(targetUid);
            if (card && card._counters) {
              let totalRemoved = 0;
              for (const ct in card._counters) {
                totalRemoved += card._counters[ct];
                card._counters[ct] = 0;
              }
              gs.log.push(`Remove todos os ${totalRemoved} contador(es) de ${card.name}.`);
              if (_Cards && _Cards.getToughness(card) <= 0) {
                _GS?.creatureDies(gs, card, gs.players.indexOf(p));
                gs.log.push(`${card.name} morre.`);
              }
              break;
            }
          }
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveETBRemoveCountersTarget]', e); }
    },

    // ── ETB clone target (human chose which creature to copy) ────────────────
    resolveETBCloneTarget(targetUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveETBCloneTarget === 'function') {
          _GS.resolveETBCloneTarget(gs, targetUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveETBCloneTarget]', e); }
    },

    // ── Legend rule sacrifice (human chose which legendary to sacrifice) ─────
    resolveLegendRuleSacrifice(sacrificeUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveLegendRuleSacrifice === 'function') {
          _GS.resolveLegendRuleSacrifice(gs, sacrificeUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveLegendRuleSacrifice]', e); }
    },

    activateGrantedAbility(creatureUid: string, abilityIdx: number) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.activateGrantedAbility(gs, 0, creatureUid, abilityIdx);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[activateGrantedAbility]', e); }
    },

    // ── Distribute damage (human chose how to split damage_divided) ──────────
    resolveDistributeDamage(distribution: Record<string, number>) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveDistributeDamage === 'function') {
          _GS.resolveDistributeDamage(gs, distribution);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveDistributeDamage]', e); }
    },

    // ── tap_creature cost resolution (human chose which creature to tap) ─────

    resolveActivationTapCreature(tappedUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveActivationTapCreature === 'function') {
          _GS.resolveActivationTapCreature(gs, tappedUid);
          console.log(`[HOOK] after resolveActivationTapCreature: wfi=${gs.waitingForInput?.type || 'none'}, pending=${gs._pendingOptionalDiscard ? 'yes' : 'no'}`);
        } else {
          gs.waitingForInput = null;
        }
        // Engine's _afterResolve already ran inside resolveActivationTapCreature.
        // Only call hook afterResolve if no overlay was set (otherwise we'd overwrite it).
        if (!gs.waitingForInput) {
          afterResolve(gs);
        }
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

    resolveSearchToGY(cardUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveSearchToGY === 'function') {
          _GS.resolveSearchToGY(gs, cardUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveSearchToGY]', e); }
    },

    resolveSearchExileCast(selectedUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        // Pass selected uids as JSON string through the existing resolveSearchLibrary pathway
        if (typeof _GS.resolveSearchLibrary === 'function') {
          _GS.resolveSearchLibrary(gs, selectedUids.length > 0 ? JSON.stringify(selectedUids) : null);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveSearchExileCast]', e); }
    },

    // ── X cost choice (human chose how much X to pay) ───────────────────────
    resolveXChoice(xValue: number) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const pending = gs._pendingXCast;
        if (!pending) return;
        gs._pendingXChoice = xValue;
        gs._humanChosenX = xValue;
        gs.waitingForInput = null;
        delete gs._pendingXCast;
        // Re-trigger: graveyard ability, harmonize, adventure, or normal spell
        if (pending.isGraveyardAbility) {
          actions.activateGraveyardAbility(pending.cardUid, pending.abilityIdx);
        } else if (pending.isHarmonize) {
          actions.castHarmonize(pending.cardUid, pending.targets || [], pending.tappedCreatureUid);
        } else if (pending.isAdventure) {
          actions.castAdventure(pending.cardUid, pending.targets || []);
        } else {
          actions.castSpell(pending.cardUid, pending.targets || []);
        }
      } catch (e) { console.warn('[resolveXChoice]', e); }
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

    // ── Bounce to library choice (Riverwalk Technique) ─────────────────

    resolveBounceToLibrary(position: 'top' | 'bottom') {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const pending = gs._pendingBounceToLibrary;
        if (!pending) { gs.waitingForInput = null; afterResolve(gs); refresh(); return; }
        const card = pending.card;
        delete gs._pendingBounceToLibrary;
        gs.waitingForInput = null;
        if (position === 'top') {
          gs.players[pending.ownerId].zones.library.addToTop(card);
          gs.log.push(`${card.name} is put on top of library.`);
        } else {
          gs.players[pending.ownerId].zones.library.addToBottom(card);
          gs.log.push(`${card.name} is put on the bottom of library.`);
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveBounceToLibrary]', e); }
    },

    // ── Botanist look (Traveling Botanist) ──────────────────────────────

    resolveBotanistLook(choice: 'hand' | 'graveyard' | 'top') {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const pending = gs._pendingBotanistLook;
        if (!pending) { gs.waitingForInput = null; afterResolve(gs); refresh(); return; }
        const card = pending.card;
        delete gs._pendingBotanistLook;
        gs.waitingForInput = null;
        if (choice === 'hand' && pending.isLand) {
          gs.players[pending.controllerId].zones.hand.add(card);
          gs.log.push(`${card.name} (land) goes to hand.`);
        } else if (choice === 'graveyard') {
          gs.players[pending.controllerId].zones.graveyard.add(card);
          gs.log.push(`${card.name} goes to graveyard.`);
        } else {
          // top — put back on top of library
          gs.players[pending.controllerId].zones.library.addToTop(card);
          gs.log.push(`${card.name} stays on top of library.`);
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveBotanistLook]', e); }
    },

    // ── Reveal pick (Dragonologist etc.) ────────────────────────────────

    resolveRevealPick(cardUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveRevealPick === 'function') {
          _GS.resolveRevealPick(gs, cardUid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveRevealPick]', e); }
    },

    // ── Trigger ordering ──────────────────────────────────────────────────

    resolveTriggerOrder(orderedIndices: number[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveTriggerOrder(gs, orderedIndices);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveTriggerOrder]', e); }
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

    // ── Optional mill ───────────────────────────────────────────────────────

    resolveOptionalMill(doMill: boolean) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveOptionalMill(gs, doMill);
        afterResolve(gs);
        // Safety: ensure human gets priority back after ETB mill resolves
        const ph = gs.phase;
        if ((ph === 'main1' || ph === 'main2') && gs.players[gs.activePlayer]?.isHuman) {
          if (!gs.waitingForInput || gs.waitingForInput.type !== 'main_phase') {
            console.log(`[resolveOptionalMill] SAFETY: restoring main_phase for human (was wfi=${gs.waitingForInput?.type})`);
            gs.waitingForInput = { type: 'main_phase', playerId: gs.activePlayer };
          }
        }
        refresh();
      } catch (e) { console.warn('[resolveOptionalMill]', e); }
    },

    // ── Ward payment confirm ─────────────────────────────────────────────────

    resolveWardConfirm(pay: boolean) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const pending = (gs as any)._pendingWardCast as any;
        (gs as any)._pendingWardCast = null;
        gs.waitingForInput = null;
        if (pay && pending) {
          // Pay ward cost first (auto-tap generic mana for ward {N})
          const wardCost = pending.wardCost || 0;
          if (wardCost > 0 && _GS && _Mana) {
            const wardCostStr = `{${wardCost}}`;
            _GS.autoTapForSpell(gs, 0, wardCostStr, wardCost);
            gs.manaPool[0] = _Mana.payMana(gs.manaPool[0] || {}, wardCostStr, wardCost);
            gs.log.push(`Ward ${wardCost} pago.`);
          }
          // Human wants to pay ward — re-cast with skip flag so ward prompt doesn't fire again
          (gs as any)._skipWardCheck = true;
          actions.castSpell(pending.cardUid, pending.targets);
        } else {
          gs.log.push('Spell cancelado — Ward não foi pago.');
          afterResolve(gs);
          refresh();
        }
      } catch (e) { console.warn('[resolveWardConfirm]', e); }
    },

    // ── Exile reveal (Kotis etc.) ────────────────────────────────────────────

    resolveExileReveal(cardUid: string | null) {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        const pending = (gs as any)._pendingExileReveal;
        (gs as any)._pendingExileReveal = null;
        gs.waitingForInput = null;

        if (cardUid && pending?.canPlay) {
          // Human chose to cast/play a card from exile
          // _exiledPlayable was already set, so castSpell will find it there
          const entry = gs._exiledPlayable?.[cardUid];
          if (entry) {
            const isLand = (entry.card.type_line || '').toLowerCase().includes('land');
            if (isLand) {
              // Play land from exile
              for (const p of gs.players) p.zones.exile.remove?.(cardUid);
              delete gs._exiledPlayable[cardUid];
              const bfCard = _Cards?.prepareForBattlefield(entry.card) || entry.card;
              gs.players[0].zones.battlefield.add(bfCard);
              gs._landPlayedThisTurn = true;
              gs.log.push(`${entry.card.name} jogado do exílio.`);
              if (_GS?._applyStaticOnETB) _GS._applyStaticOnETB(gs, bfCard, 0);
            } else {
              // Cast spell from exile — castSpell checks _exiledPlayable
              actions.castSpell(cardUid);
              return; // castSpell handles refresh
            }
          }
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveExileReveal]', e); }
    },

    // ── Grant counter target (Alchemist's Assistant etc.) ───────────────────

    resolveGrantCounterTarget(cardUid: string) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        const pending = (gs as any)._pendingGrantCounter;
        if (!pending) { gs.waitingForInput = null; afterResolve(gs); refresh(); return; }
        delete (gs as any)._pendingGrantCounter;
        gs.waitingForInput = null;
        const creature = gs.players[pending.controllerId].zones.battlefield.get(cardUid);
        if (creature) {
          if (!creature._counters) creature._counters = {};
          // Array of keyword counters (e.g. Qarsi Revenant: ["flying","deathtouch","lifelink"])
          if (pending.counters && Array.isArray(pending.counters)) {
            if (!creature.keywords) creature.keywords = [];
            for (const kw of pending.counters) {
              const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);
              creature._counters[kwCap] = (creature._counters[kwCap] || 0) + 1;
              if (!creature.keywords.includes(kwCap)) creature.keywords.push(kwCap);
              if (kwCap === 'Haste') creature._summoningSick = false;
            }
            gs.log.push(`${creature.name} recebe contadores: ${pending.counters.join(', ')}.`);
          } else {
            const ctr = pending.counter || '+1/+1';
            const amt = pending.amount || 1;
            creature._counters[ctr] = (creature._counters[ctr] || 0) + amt;
            if (ctr !== '+1/+1' && ctr !== '-1/-1') {
              if (!creature.keywords) creature.keywords = [];
              const kwCap = ctr.charAt(0).toUpperCase() + ctr.slice(1);
              if (!creature.keywords.includes(kwCap)) creature.keywords.push(kwCap);
            }
            gs.log.push(`${creature.name} recebe ${amt} contador ${ctr}.`);
          }
          // Resume pending graveyard ability effects (e.g. Naga Fleshcrafter: counter + mass_clone)
          if ((gs as any)._pendingGYAbilityEffects) {
            const gyPending = (gs as any)._pendingGYAbilityEffects;
            (gs as any)._pendingGYAbilityEffects = null;
            for (const eff of gyPending.effects) {
              // mass_clone: auto-use the same creature that got the counter as template (no second overlay)
              if (eff.type === 'mass_clone' && creature) {
                const myCreatures = gs.players[pending.controllerId].zones.battlefield.cards.filter(
                  (c: any) => _Cards && _Cards.isCreature(c) && c._uid !== creature._uid
                );
                myCreatures.forEach((c: any) => {
                  if (!c._originalCard) {
                    c._originalCard = { name: c.name, power: c.power, toughness: c.toughness, type_line: c.type_line, keywords: c.keywords ? [...c.keywords] : [], oracle_text: c.oracle_text, mana_cost: c.mana_cost, cmc: c.cmc, image_normal: c.image_normal, image_small: c.image_small };
                  }
                  c._copyingUntilEOT = true;
                  c.name = creature.name; c.power = creature.power; c.toughness = creature.toughness;
                  c.type_line = creature.type_line; c.keywords = creature.keywords ? [...creature.keywords] : [];
                  c.oracle_text = creature.oracle_text; c.mana_cost = creature.mana_cost; c.cmc = creature.cmc;
                  c.image_normal = creature.image_normal; c.image_small = creature.image_small;
                });
                gs.log.push(`All creatures become copies of ${creature.name} until end of turn.`);
                continue;
              }
              const targets: any[] = [];
              if (eff.target === 'same') targets.push({ uid: creature._uid, player: pending.controllerId });
              const result = _GS._resolveSimpleEffect(gs, gyPending.pid, eff, {
                cardUid: gyPending.card?._uid, card: gyPending.card, fromZone: 'graveyard', targets
              });
              if (result) gs.log.push(result);
              if (gs.waitingForInput) break;
            }
          }
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGrantCounterTarget]', e); }
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

    // ── Put creatures from hand (Last March of the Ents) ────────────────────

    resolvePutCreaturesFromHand(uids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolvePutCreaturesFromHand === 'function') {
          _GS.resolvePutCreaturesFromHand(gs, uids);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolvePutCreaturesFromHand]', e); }
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

    // ── Crew vehicle ─────────────────────────────────────────────────────────

    resolveCrew(selectedUids: string[] | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveCrew === 'function') {
          _GS.resolveCrew(gs, selectedUids);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveCrew]', e); }
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

    resolveFriendlyRivalryChoice(uid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveFriendlyRivalryChoice === 'function') {
          _GS.resolveFriendlyRivalryChoice(gs, uid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveFriendlyRivalryChoice]', e); }
    },

    resolveMultiUntap(uids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof (_GS as any).resolveMultiUntap === 'function') {
          (_GS as any).resolveMultiUntap(gs, uids);
        } else { gs.waitingForInput = null; }
        afterResolve(gs); refresh();
      } catch (e) { console.warn('[resolveMultiUntap]', e); }
    },

    resolveTapOrUntap(uid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveTapOrUntap === 'function') {
          _GS.resolveTapOrUntap(gs, uid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveTapOrUntap]', e); }
    },

    resolveFightTarget(uid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveFightTarget === 'function') {
          _GS.resolveFightTarget(gs, uid);
          afterResolve(gs);
          refresh();
        } else {
          gs.waitingForInput = null;
          afterResolve(gs);
          refresh();
        }
      } catch (e) { console.warn('[resolveFightTarget]', e); }
    },

    resolveFreeCastFromHand(uid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveFreeCastFromHand === 'function') {
          _GS.resolveFreeCastFromHand(gs, uid);
        } else {
          gs.waitingForInput = null;
          afterResolve(gs);
          refresh();
        }
        refresh();
      } catch (e) { console.warn('[resolveFreeCastFromHand]', e); }
    },

    resolveFreeCastFromExile(uid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveFreeCastFromExile === 'function') {
          _GS.resolveFreeCastFromExile(gs, uid);
        } else {
          gs.waitingForInput = null;
          afterResolve(gs);
        }
        refresh();
      } catch (e) { console.warn('[resolveFreeCastFromExile]', e); }
    },

    resolveSauronsRansomChoice(pileIndex: number) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveSauronsRansomChoice === 'function') {
          _GS.resolveSauronsRansomChoice(gs, pileIndex);
        } else {
          gs.waitingForInput = null;
          afterResolve(gs);
        }
        refresh();
      } catch (e) { console.warn('[resolveSauronsRansomChoice]', e); }
    },

    resolveMultiTapChoice(selectedUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveMultiTapChoice === 'function') {
          _GS.resolveMultiTapChoice(gs, selectedUids);
        } else {
          gs.waitingForInput = null;
          afterResolve(gs);
        }
        refresh();
      } catch (e) { console.warn('[resolveMultiTapChoice]', e); }
    },

    resolveAttachEquipmentChoice(uid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveAttachEquipmentChoice === 'function') {
          _GS.resolveAttachEquipmentChoice(gs, uid);
        } else {
          gs.waitingForInput = null;
          afterResolve(gs);
        }
        refresh();
      } catch (e) { console.warn('[resolveAttachEquipmentChoice]', e); }
    },

    resolveAttachOwnCreature(uid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveAttachOwnCreature === 'function') {
          _GS.resolveAttachOwnCreature(gs, uid);
        } else {
          gs.waitingForInput = null;
          afterResolve(gs);
        }
        refresh();
      } catch (e) { console.warn('[resolveAttachOwnCreature]', e); }
    },

    resolveDamageCreatureTarget(uid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveDamageCreatureTarget === 'function') {
          _GS.resolveDamageCreatureTarget(gs, uid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveDamageCreatureTarget]', e); }
    },

    resolveMoveCountersTarget(uid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveMoveCountersTarget === 'function') {
          _GS.resolveMoveCountersTarget(gs, uid);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveMoveCountersTarget]', e); }
    },

    resolveMoveCountersAmount(amounts: Record<string, number>) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveMoveCountersAmount === 'function') {
          _GS.resolveMoveCountersAmount(gs, amounts);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveMoveCountersAmount]', e); }
    },

    resolveLibraryOrder(orderedUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        if (typeof _GS.resolveLibraryOrder === 'function') {
          _GS.resolveLibraryOrder(gs, orderedUids);
        } else {
          gs.waitingForInput = null;
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveLibraryOrder]', e); }
    },

    resolveShuffleGYChoosePlayer(targetPid: number) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveShuffleGYChoosePlayer(gs, targetPid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveShuffleGYChoosePlayer]', e); }
    },

    resolveShuffleGYChooseCards(cardUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveShuffleGYChooseCards(gs, cardUids);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveShuffleGYChooseCards]', e); }
    },

    resolveGYCounterTargets(targetUids: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveGYCounterTargets(gs, targetUids);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGYCounterTargets]', e); }
    },

    resolveGYBottomLibrary(cardUid: string | null) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      try {
        _GS.resolveGYBottomLibrary(gs, cardUid);
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveGYBottomLibrary]', e); }
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

    resolveNoteCreatureType(type: string) {
      if (!_GS) return;
      try {
        const gs = gsRef.current!;
        _GS.resolveNoteCreatureType(gs, 0, type);
        refresh();
      } catch (e) { console.warn('[resolveNoteCreatureType]', e); }
    },

    resolveProtectionTypeChoice(cardType: string) {
      try {
        const gs = gsRef.current!;
        const pending = gs._pendingProtectionGrant;
        if (!pending) return;
        gs.waitingForInput = null;
        // Store the chosen type, then pick the creature target
        const bf = gs.players[pending.controllerId].zones.battlefield.cards.filter((c: any) => {
          const uid = c._uid;
          return pending.candidateUids?.includes(uid) ?? true;
        });
        if (bf.length === 0) { gs._pendingProtectionGrant = null; refresh(); return; }
        if (bf.length === 1) {
          gs._pendingProtectionGrant = null;
          const c = bf[0];
          if (!c._tempProtectionFrom) c._tempProtectionFrom = [];
          c._tempProtectionFrom.push({ type: cardType, appliedTurn: gs.turn, duration: pending.duration });
          gs.log.push(`${c.name} gains protection from ${cardType}s until end of turn.`);
          afterResolve(gs);
          refresh();
        } else {
          // Show creature selection — store type for after creature chosen
          gs._pendingProtectionGrant = { ...pending, chosenType: cardType };
          gs.waitingForInput = { type: 'protection_creature_choice', playerId: pending.controllerId, choices: bf };
          refresh();
        }
      } catch (e) { console.warn('[resolveProtectionTypeChoice]', e); }
    },

    resolveProtectionCreatureChoice(uid: string) {
      try {
        const gs = gsRef.current!;
        const pending = gs._pendingProtectionGrant;
        if (!pending) return;
        gs._pendingProtectionGrant = null;
        gs.waitingForInput = null;
        const creature = gs.players[pending.controllerId].zones.battlefield.cards.find((c: any) => c._uid === uid);
        if (creature) {
          if (!creature._tempProtectionFrom) creature._tempProtectionFrom = [];
          creature._tempProtectionFrom.push({ type: pending.chosenType, appliedTurn: gs.turn, duration: pending.duration });
          gs.log.push(`${creature.name} gains protection from ${pending.chosenType}s until end of turn.`);
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveProtectionCreatureChoice]', e); }
    },

    resolveUnlessExile(doExile: boolean) {
      try {
        const gs = gsRef.current!;
        const pending = gs._pendingUnlessExile;
        if (!pending) return;
        gs._pendingUnlessExile = null;
        gs.waitingForInput = null;
        if (doExile) {
          if (pending.creatureUid) {
            // New: exile the enchanted creature (Morgul-Knife Wound oracle: exile THIS creature)
            const pid = pending.controllerId;
            const creature = gs.players[pid]?.zones.battlefield.get(pending.creatureUid);
            if (creature) {
              gs.players[pid].zones.battlefield.remove?.(creature._uid);
              if (!gs.exile) gs.exile = { cards: [] };
              gs.exile.cards.push(creature);
              gs.log.push(`${creature.name} exiled (Morgul-Knife Wound).`);
            }
          } else if (pending.auraUid) {
            // Legacy: exile the aura
            const aura = gs.players.flatMap((p: any) => p.zones.battlefield.cards).find((c: any) => c._uid === pending.auraUid);
            if (aura) {
              const owner = aura._ownerId ?? 0;
              gs.players[owner].zones.battlefield.remove?.(aura._uid);
              if (!gs.exile) gs.exile = { cards: [] };
              gs.exile.cards.push(aura);
              gs.log.push(`${aura.name} exiled (Morgul-Knife Wound).`);
            }
          }
        } else {
          gs.players[pending.controllerId].life -= pending.amount;
          gs.log.push(`${pending.controllerId === 0 ? 'You lose' : 'Opponent loses'} ${pending.amount} life.`);
        }
        afterResolve(gs);
        refresh();
      } catch (e) { console.warn('[resolveUnlessExile]', e); }
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

    setStopAtPhases(phases: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      if (_GS.setStopAtPhases) _GS.setStopAtPhases(gs, phases);
    },

    setMyStopPhases(phases: string[]) {
      const gs = gsRef.current;
      if (!gs || !_GS) return;
      if (_GS.setMyStopPhases) _GS.setMyStopPhases(gs, phases);
    },
  };

  return { snap, loading, error, actions, gsRef, canUndoMana, undoManaCount };
}
