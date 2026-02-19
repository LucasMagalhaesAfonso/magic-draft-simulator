// GameScreen.tsx — Game UI connected to the real engine via useGameEngine hook

import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Card } from '../lib/types';
import { CardImage } from './card/CardImage';
import { useGameEngine } from '../hooks/useGameEngine';
import { buildDeck as botBuildDeck } from '../draft/bot-ai';
import {
  ScryOverlay, ModalOverlay, TargetingPrompt, GraveyardOverlay,
  InstantPriorityBanner, StackPriorityBanner, BlockerConfirmBanner,
  DiscardOverlay, ManaColorOverlay, SearchLibraryOverlay, CreatureChoiceOverlay,
  LookTopOverlay, ClashOverlay, ConfirmOptionalOverlay, UnlessPayOverlay,
  MillLandChoiceOverlay, EndureChoiceOverlay, TriggerCostOverlay,
  AbilityModal, ExileOverlay, CombatArrows,
} from './game/GameOverlays';
import { VfxLayer, VfxManager } from './game/VfxLayer';
import { getLandManaColors, canPay } from '../engine/mana';
import type { ManaPool } from '../engine/engine-types';
import './GameScreen.css';

// ── Phase strip config ─────────────────────────────────────────────────────────

const PHASES = [
  { key: 'mulligan',           label: 'Mulligan' },
  { key: 'untap',              label: 'Untap' },
  { key: 'upkeep',             label: 'Upkeep' },
  { key: 'draw',               label: 'Draw' },
  { key: 'main1',              label: 'Main 1' },
  { key: 'combat_begin',       label: 'Combat' },
  { key: 'combat_attackers',   label: 'Attack' },
  { key: 'combat_blockers',    label: 'Block' },
  { key: 'combat_damage',      label: 'Damage' },
  { key: 'combat_end',         label: 'C.End' },
  { key: 'main2',              label: 'Main 2' },
  { key: 'end',                label: 'End' },
  { key: 'cleanup',            label: 'Cleanup' },
];

// ── Helpers for AI bot deck ────────────────────────────────────────────────────

const LAND_BASES: Record<string, Partial<Card>> = {
  W: { name: 'Plains',   type_line: 'Basic Land — Plains',   mana_cost: '', cmc: 0, produced_mana: ['W' as any] },
  U: { name: 'Island',   type_line: 'Basic Land — Island',   mana_cost: '', cmc: 0, produced_mana: ['U' as any] },
  B: { name: 'Swamp',    type_line: 'Basic Land — Swamp',    mana_cost: '', cmc: 0, produced_mana: ['B' as any] },
  R: { name: 'Mountain', type_line: 'Basic Land — Mountain', mana_cost: '', cmc: 0, produced_mana: ['R' as any] },
  G: { name: 'Forest',   type_line: 'Basic Land — Forest',   mana_cost: '', cmc: 0, produced_mana: ['G' as any] },
};

function makeLandCard(color: string, idx: number): Card {
  const base = LAND_BASES[color]!;
  return {
    id: `basic_${color}_${idx}`,
    oracle_id: '',
    name: base.name!,
    mana_cost: '',
    cmc: 0,
    type_line: base.type_line!,
    oracle_text: '',
    colors: [],
    color_identity: [],
    keywords: [],
    set_code: 'BASIC',
    set_name: 'Basic',
    collector_number: '',
    rarity: 'common',
    image_small: `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(base.name!)}&format=image&version=small`,
    image_normal: `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(base.name!)}&format=image`,
    image_art_crop: '',
    layout: 'normal',
    produced_mana: base.produced_mana as any,
  };
}

function buildFullDeck(spells: Card[], lands: Record<string, number>): Card[] {
  const deck = [...spells];
  for (const [color, count] of Object.entries(lands)) {
    for (let i = 0; i < count; i++) {
      deck.push(makeLandCard(color, i));
    }
  }
  return deck;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function GameScreen() {
  const { deck, draftPool, setScreen, playmat, playmatArt, landArts, sleeveArt } = useAppStore();

  // Resolve land art override for basic lands
  const LAND_COLOR_MAP: Record<string, string> = {
    Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G',
  };
  function getLandArtUrl(card: any): string | undefined {
    const name = card.name as string;
    const color = LAND_COLOR_MAP[name];
    return color ? landArts?.[color] : undefined;
  }

  const [showLog, setShowLog] = useState(false);
  const [zoom, setZoom] = useState<any>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // ── Overlay states ────────────────────────────────────────────────────────
  const [graveyardOpen, setGraveyardOpen] = useState<{ pid: number } | null>(null);
  const [exileOpen, setExileOpen] = useState<{ pid: number } | null>(null);
  // Targeting: pending spell waiting for player to click a target
  const [targeting, setTargeting] = useState<{ cardUid: string; card: any } | null>(null);
  // Blocking: selected own creature waiting to be assigned to an attacker
  const [blockingWith, setBlockingWith] = useState<string | null>(null);
  // Ability modal: double-click on creature/planeswalker
  const [abilityModal, setAbilityModal] = useState<{ card: any; abilities: any[] } | null>(null);
  // Equipment modal: double-click on equipment to pick which creature to attach
  const [equipModal, setEquipModal] = useState<{ equipUid: string; equipName: string } | null>(null);
  // Attack target picker: when declaring an attacker and opponent has planeswalkers
  const [attackTargetPicker, setAttackTargetPicker] = useState<{ attackerUid: string } | null>(null);
  // Adventure modal: choose between casting as creature or adventure/omen
  const [adventureModal, setAdventureModal] = useState<{ card: any } | null>(null);
  // Conditional cost confirmation (e.g. Dragon's Prey costs {2} more when targeting a Dragon)
  const [conditionalCostConfirm, setConditionalCostConfirm] = useState<{
    cardUid: string; card: any; targets: any[]; extraCost: string; extraAmount: number; targetName: string;
  } | null>(null);
  // London mulligan: phase 2 - selecting cards to put on bottom
  const [showingBottomSelect, setShowingBottomSelect] = useState(false);
  const [mulliganBottomSelected, setMulliganBottomSelected] = useState<string[]>([]);

  // Toast / banner / auto-pass states
  const [toasts, setToasts] = useState<{id: number; msg: string; type: string}[]>([]);
  const toastIdRef = useRef(0);
  const [showStack, setShowStack] = useState(false);
  const [turnBanner, setTurnBanner] = useState<string | null>(null);
  const [autoPass, setAutoPass] = useState(false);
  const autoPassRef = useRef(false);
  // Full Control Mode: pause at every phase transition (like Arena Ctrl)
  const [fullControl, setFullControl] = useState(false);
  const fullControlRef = useRef(false);
  const prevLifeRef = useRef<[number, number] | null>(null);
  const prevActivePlayerRef = useRef<number | null>(null);

  // Build decks for the engine
  const playerSpells = deck?.mainboard ?? draftPool.slice(0, 23);
  const playerLands  = deck?.lands    ?? { W: 9, U: 8, B: 0, R: 0, G: 0 };
  const playerDeck   = buildFullDeck(playerSpells, playerLands);

  // AI deck: use BotAI.buildDeck for proper 2-color optimization
  const aiPool = draftPool.filter(c => !c.type_line?.includes('Land'));
  const aiDeckData = aiPool.length >= 10
    ? botBuildDeck(aiPool)
    : { deck: playerSpells.slice(0, 23), lands: { W: 9, U: 8 } as Record<string, number>, sideboard: [] as any[] };
  const aiDeck = buildFullDeck(aiDeckData.deck, aiDeckData.lands);

  const { snap, loading, error, actions, gsRef, canUndoMana } = useGameEngine(playerDeck, aiDeck);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [snap?.log]);

  function addToast(msg: string, type: string = 'info') {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev.slice(-4), { id, msg, type }]); // max 5 toasts
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2500);
  }

  // Life change toasts + flash
  useEffect(() => {
    if (!snap) return;
    const p0life = snap.players[0].life;
    const p1life = snap.players[1].life;
    const prev = prevLifeRef.current;
    if (prev) {
      const d0 = p0life - prev[0];
      const d1 = p1life - prev[1];
      if (d0 < 0) addToast(`-${-d0} ❤️`, 'damage');
      else if (d0 > 0) addToast(`+${d0} ❤️`, 'heal');
      if (d1 < 0) addToast(`AI -${-d1} ❤️`, 'damage');
      else if (d1 > 0) addToast(`AI +${d1} ❤️`, 'heal');
    }
    prevLifeRef.current = [p0life, p1life];
  }, [snap?.players[0].life, snap?.players[1].life]); // eslint-disable-line

  // Turn banner
  useEffect(() => {
    if (!snap || snap.phase === 'mulligan') return;
    const prev = prevActivePlayerRef.current;
    if (prev !== null && prev !== snap.activePlayer) {
      setTurnBanner(snap.activePlayer === 0 ? 'Seu Turno' : 'Turno do Oponente');
      setTimeout(() => setTurnBanner(null), 1800);
    }
    prevActivePlayerRef.current = snap.activePlayer;
  }, [snap?.turn, snap?.activePlayer]); // eslint-disable-line

  // Keep refs in sync
  useEffect(() => { autoPassRef.current = autoPass; }, [autoPass]);
  useEffect(() => { fullControlRef.current = fullControl; }, [fullControl]);

  // VFX: life change effects
  const prevLifeVfxRef = useRef<[number, number] | null>(null);
  useEffect(() => {
    if (!snap) return;
    const p0life = snap.players[0].life;
    const p1life = snap.players[1].life;
    const prev = prevLifeVfxRef.current;
    if (prev) {
      const d0 = p0life - prev[0];
      const d1 = p1life - prev[1];
      if (d0 < 0) VfxManager.play('playerDamage', 'p0');
      else if (d0 > 0) VfxManager.play('heal', 'p0');
      if (d1 < 0) VfxManager.play('playerDamage', 'p1');
      else if (d1 > 0) VfxManager.play('heal', 'p1');
    }
    prevLifeVfxRef.current = [p0life, p1life];
  }, [snap?.players[0].life, snap?.players[1].life]); // eslint-disable-line

  // VFX: creature enters/leaves battlefield
  const prevBfUidsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!snap) return;
    const allBfNow = [
      ...snap.players[0].battlefield.map((c: any) => c._uid),
      ...snap.players[1].battlefield.map((c: any) => c._uid),
    ];
    const nowSet = new Set<string>(allBfNow);
    const prev = prevBfUidsRef.current;
    // Entering battlefield
    for (const uid of nowSet) {
      if (!prev.has(uid)) {
        // Small delay so the element is in DOM
        setTimeout(() => VfxManager.play('buff', uid), 80);
      }
    }
    // Leaving battlefield (died / exiled)
    for (const uid of prev) {
      if (!nowSet.has(uid)) {
        VfxManager.play('death', uid);
      }
    }
    prevBfUidsRef.current = nowSet;
  }, [snap?.players[0].battlefield?.length, snap?.players[1].battlefield?.length]); // eslint-disable-line

  useEffect(() => {
    if (!autoPass || !snap) return;
    const wi = snap.waitingForInput;
    const phase = snap.phase;
    // Stop at end step, cleanup, or when input needed (except main_phase which we can skip)
    if (phase === 'end' || phase === 'cleanup' || snap.activePlayer !== 0) {
      setAutoPass(false);
      return;
    }
    if (wi && wi.type !== 'main_phase' && wi.type !== 'instant_priority') {
      setAutoPass(false);
      return;
    }
    // Auto advance after short delay
    const timer = setTimeout(() => {
      if (autoPassRef.current) actions.nextPhase();
    }, 120);
    return () => clearTimeout(timer);
  }, [snap?.phase, snap?.waitingForInput?.type, autoPass]); // eslint-disable-line

  // Keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (snap?.phase === 'mulligan') break; // Mulligan uses K/M keys, not Space
          if (targeting) { setTargeting(null); break; }
          if (blockingWith) { setBlockingWith(null); break; }
          if (snap?.waitingForInput?.type === 'declare_blockers' && snap.waitingForInput.playerId === 0) {
            actions.confirmBlockers();
          } else {
            actions.nextPhase();
          }
          break;
        case 'Escape':
          if (targeting) { setTargeting(null); break; }
          if (blockingWith) { setBlockingWith(null); break; }
          if (graveyardOpen) { setGraveyardOpen(null); break; }
          if (exileOpen) { setExileOpen(null); break; }
          break;
        case 'Enter': {
          // Confirm scry/surveil if waiting
          const wi = snap?.waitingForInput;
          if (wi?.type === 'scry' || wi?.type === 'surveil') {
            // Confirm with current choices (all top by default)
            const pending = (window as any)._gsRef?.current?._pendingScry;
            if (pending) actions.resolveScry(pending.choices);
          }
          break;
        }
        case 'l': case 'L':
          setShowLog(v => !v);
          break;
        case 'a': case 'A':
          if (snap?.phase === 'combat_attackers' && snap.activePlayer === 0) {
            snap.players[0].battlefield
              .filter((c: any) => {
                if (!c.type_line?.includes('Creature') || c._tapped) return false;
                const hasHaste = c._tempKeywords?.includes('Haste') ||
                  (c.keywords || []).some((k: string) => k?.toLowerCase() === 'haste') ||
                  (c.oracle_text || '').toLowerCase().includes('haste');
                return !c._summoningSick || hasHaste;
              })
              .forEach((c: any) => actions.declareAttacker(c._uid));
          }
          break;
        case 'k': case 'K':
          if (snap?.phase === 'mulligan') actions.keepHand();
          break;
        case 'm': case 'M':
          if (snap?.phase === 'mulligan') actions.mulligan();
          break;
        case '1': case '2': case '3': case '4': {
          // Quick modal mode selection
          const wi2 = snap?.waitingForInput;
          if (wi2?.type === 'modal_choice') {
            const idx = parseInt(e.key) - 1;
            actions.resolveModal([idx]);
          }
          break;
        }
        case 'f': case 'F':
          setAutoPass(v => !v);
          break;
        case 'Tab':
          e.preventDefault();
          setShowStack(v => !v);
          break;
        case 'Control':
          // Full Control Mode toggle: pause at every phase like Arena Ctrl
          fullControlRef.current = !fullControlRef.current;
          setFullControl(v => !v);
          break;
        case 'e': case 'E':
          // Open exile zone
          setExileOpen(prev => prev ? null : { pid: 0 });
          break;
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [snap, actions, targeting, graveyardOpen, blockingWith, showStack, autoPass, exileOpen]);

  // Helper: does this spell need interactive targeting?
  // Strips activated ability lines (e.g. "{1}, {T}: Target creature...") to avoid
  // false positives for creatures with targeted activated abilities.
  // Modal spells (Choose one/two) should never enter targeting mode before the modal;
  // the chosen mode handles targeting during resolution.
  function isModalSpell(card: any): boolean {
    const text = (card?.oracle_text || '').trim().toLowerCase();
    return text.startsWith('choose one') || text.startsWith('choose two') ||
           text.startsWith('choose a mode') || /\n—\s*•/.test(card?.oracle_text || '');
  }

  function spellNeedsTargeting(card: any): boolean {
    if (!card) return false;
    // Modal spells never pre-target — the chosen mode handles targeting
    if (isModalSpell(card)) return false;
    const typeLineLower = (card.type_line || '').toLowerCase();
    // Creatures never need targets at cast time. ETB triggered abilities that target
    // are resolved when the creature enters, not when it's cast. Casting always succeeds
    // even with no valid ETB targets (the trigger simply fizzles).
    // Exception: Aura enchantments with "Enchant X" that need a target on cast.
    if (typeLineLower.includes('creature') && !typeLineLower.includes('aura')) return false;
    const isPermSpell = (card.type_line || '').match(/Artifact|Enchantment|Planeswalker|Land/);
    let text = (card.oracle_text || '').toLowerCase();
    if (isPermSpell) {
      // Remove activated ability lines: lines starting with a mana-cost pattern like {1}, {T}:
      text = text.split('\n').filter((line: string) => {
        return !/^\{[^}]+\}[^:]*:/.test(line.trim());
      }).join('\n');
    }
    return text.includes('target creature') || text.includes('target player') ||
           text.includes('target opponent') || text.includes('target permanent') ||
           text.includes('target land') || text.includes('target artifact') ||
           text.includes('target enchantment') || text.includes('target planeswalker') ||
           text.includes('target nonland') || text.includes('any target');
  }

  // Detect conditional extra cost when targeting a specific card
  // Returns { extraCost: "{2}", extraAmount: 2 } or null
  function getConditionalExtraCost(castCard: any, targetCard: any): { extraCost: string; extraAmount: number } | null {
    const text = (castCard.oracle_text || '').toLowerCase();
    // Pattern: "costs {X} more to cast if it targets a <type>"
    const match = text.match(/costs?\s+(\{[^}]+\})\s+more\s+to\s+cast\s+if\s+(?:it\s+)?targets?\s+a\s+(\w+)/i);
    if (!match) return null;
    const extraCostStr = match[1].toUpperCase(); // "{2}"
    const creatureType = match[2].toLowerCase();  // "dragon"
    if (!(targetCard?.type_line || '').toLowerCase().includes(creatureType)) return null;
    const numMatch = extraCostStr.match(/\{(\d+)\}/);
    const extraAmount = numMatch ? parseInt(numMatch[1]) : 0;
    return { extraCost: extraCostStr, extraAmount };
  }

  // Build valid targets for current targeting spell
  function getValidTargets(card: any) {
    if (!snap) return [];
    const text = (card?.oracle_text || '').toLowerCase();
    const targets: any[] = [];

    const wantsCreature = text.includes('target creature') || text.includes('target permanent') || text.includes('target nonland');
    const wantsPlayer = text.includes('target player') || text.includes('target opponent') || text.includes('deals') || text.includes('damage');
    const wantsEnemy = text.includes('target opponent') || (text.includes('destroy') && text.includes('target'));
    const wantsAny = text.includes('target creature or player') || text.includes('any target');
    // Planeswalkers are valid targets for: "planeswalker", "target permanent", "target nonland permanent", "any target"
    const wantsPlaneswalker = text.includes('planeswalker') || text.includes('target permanent') || text.includes('target nonland') || wantsAny;
    const wantsArtifact = text.includes('target artifact') || text.includes('target permanent') || text.includes('target nonland') || wantsAny;
    const wantsEnchantment = text.includes('target enchantment') || text.includes('target permanent') || text.includes('target nonland') || wantsAny;

    // Add creatures
    if (wantsCreature || wantsAny || wantsEnemy) {
      snap.players[1].battlefield
        .filter((c: any) => c.type_line?.includes('Creature'))
        .forEach((c: any) => targets.push({ type: 'creature', uid: c._uid, player: 1, card: c }));
      if (!wantsEnemy) {
        snap.players[0].battlefield
          .filter((c: any) => c.type_line?.includes('Creature'))
          .forEach((c: any) => targets.push({ type: 'creature', uid: c._uid, player: 0, card: c }));
      }
    }
    // Add planeswalkers
    if (wantsPlaneswalker || wantsAny) {
      snap.players[1].battlefield
        .filter((c: any) => c.type_line?.includes('Planeswalker'))
        .forEach((c: any) => targets.push({ type: 'permanent', uid: c._uid, player: 1, card: c }));
      if (!wantsEnemy) {
        snap.players[0].battlefield
          .filter((c: any) => c.type_line?.includes('Planeswalker'))
          .forEach((c: any) => targets.push({ type: 'permanent', uid: c._uid, player: 0, card: c }));
      }
    }
    // Add artifacts (non-creature)
    if (wantsArtifact) {
      [0, 1].forEach(pid => {
        if (wantsEnemy && pid === 0) return;
        snap.players[pid].battlefield
          .filter((c: any) => c.type_line?.includes('Artifact') && !c.type_line?.includes('Creature'))
          .forEach((c: any) => targets.push({ type: 'permanent', uid: c._uid, player: pid, card: c }));
      });
    }
    // Add enchantments (non-creature)
    if (wantsEnchantment) {
      [0, 1].forEach(pid => {
        if (wantsEnemy && pid === 0) return;
        snap.players[pid].battlefield
          .filter((c: any) => c.type_line?.includes('Enchantment') && !c.type_line?.includes('Creature'))
          .forEach((c: any) => targets.push({ type: 'permanent', uid: c._uid, player: pid, card: c }));
      });
    }
    // Add players
    if (wantsPlayer || wantsAny) {
      targets.push({ type: 'player', player: 1, name: 'Oponente' });
      if (!wantsEnemy) targets.push({ type: 'player', player: 0, name: 'Você' });
    }

    return targets;
  }

  function handleCardClick(card: any, pid: number) {
    if (!snap) return;
    const wi = snap.waitingForInput;

    // ── Targeting mode: clicking a creature/permanent to target it ──────────
    if (targeting) {
      const t = getValidTargets(targeting.card);
      const hit = t.find((x: any) => (x.type === 'creature' || x.type === 'permanent') && x.uid === card._uid);
      if (hit) {
        const tgt = [{ type: hit.type, uid: card._uid, player: hit.player }];

        // Check for conditional extra cost (e.g. Dragon's Prey: +{2} when targeting Dragons)
        const condCost = getConditionalExtraCost(targeting.card, card);
        if (condCost) {
          // Check if player has enough mana (pool + untapped lands)
          const baseCmc = targeting.card.cmc || 0;
          const needed = baseCmc + condCost.extraAmount;
          if (totalAvailableMana < needed) {
            addToast(`Mana insuficiente — precisa de ${condCost.extraCost} a mais para dar alvo num Dragão`, 'damage');
            setTargeting(null);
            return;
          }
          // Show confirmation before casting
          setConditionalCostConfirm({
            cardUid: targeting.cardUid,
            card: targeting.card,
            targets: tgt,
            extraCost: condCost.extraCost,
            extraAmount: condCost.extraAmount,
            targetName: card.name,
          });
          setTargeting(null);
          return;
        }

        if (targeting.card._isAdventure) {
          actions.castAdventure(targeting.cardUid, tgt);
        } else {
          actions.castSpell(targeting.cardUid, tgt);
        }
        setTargeting(null);
      }
      return;
    }

    // ── Blocking mode: clicking an attacker to assign a blocker ──────────
    if (wi?.type === 'declare_blockers' && wi.playerId === 0) {
      const myBF = snap.players[0].battlefield;
      const oppBF = snap.players[1].battlefield;
      const isMyCreature = myBF.some((c: any) => c._uid === card._uid) && !card._tapped && card.type_line?.includes('Creature');
      const isOppAttacker = oppBF.some((c: any) => c._uid === card._uid) && card._attacking;

      if (isMyCreature && !blockingWith) {
        // Step 1: select own creature to block with
        // Check if this creature is already assigned as a blocker (blockers are keyed by attacker uid)
        const blockers = gsRef.current?.combat?.blockers || {};
        const alreadyBlocking = Object.values(blockers).some(
          (arr: any) => Array.isArray(arr) && arr.some((b: any) => b.uid === card._uid)
        );
        if (alreadyBlocking) {
          actions.unassignBlocker(card._uid);
        } else {
          setBlockingWith(card._uid);
        }
        return;
      }
      if (isOppAttacker && blockingWith) {
        // Step 2: click attacker to assign
        actions.declareBlocker(blockingWith, card._uid);
        setBlockingWith(null);
        return;
      }
      // Cancel blocker selection if clicking elsewhere
      setBlockingWith(null);
      return;
    }

    // ── choose_target engine waiting (saga chapters) ──────────────────────
    if (wi?.type === 'choose_target') {
      actions.resolveChooseTarget([{ type: 'creature', uid: card._uid, player: pid }]);
      return;
    }

    // ── post_modal_target: pick a creature/permanent after modal mode chosen ──
    if (wi?.type === 'post_modal_target' && wi.playerId === 0) {
      const targetType = wi.targetType;
      let isValid = false;
      const tl = (card.type_line || '').toLowerCase();
      const kws = ((card.keywords || []) as string[]).map(k => (k || '').toLowerCase());

      if (targetType === 'creature' || targetType === 'any') {
        isValid = tl.includes('creature');
      } else if (targetType === 'own_creature') {
        isValid = pid === 0 && tl.includes('creature');
      } else if (targetType === 'opponent_creature') {
        isValid = pid === 1 && tl.includes('creature');
      } else if (targetType === 'creature_with_flying') {
        isValid = tl.includes('creature') && kws.includes('flying');
      } else if (targetType === 'artifact') {
        isValid = tl.includes('artifact');
      } else if (targetType === 'enchantment') {
        isValid = tl.includes('enchantment');
      } else if (targetType === 'permanent') {
        isValid = !tl.includes('instant') && !tl.includes('sorcery');
      } else if (targetType === 'nonland_permanent') {
        isValid = !tl.includes('land') && !tl.includes('instant') && !tl.includes('sorcery');
      }

      if (isValid) {
        actions.resolvePostModalTarget({ type: 'creature', uid: card._uid, player: pid });
      }
      return;
    }

    const phase = snap.phase;
    const isInstantPriority = wi?.type === 'instant_priority' && wi.playerId === 0;
    const isStackPriority = wi?.type === 'stack_priority' && wi.playerId === 0;
    const isMainPhase = phase === 'main1' || phase === 'main2';
    const canPlaySpells = isMainPhase || isInstantPriority || isStackPriority;

    if (pid !== 0) return; // clicking opp cards handled by targeting/blocking above

    const inHand = snap.players[0].hand.some((c: any) => c._uid === card._uid);
    const inBF   = snap.players[0].battlefield.some((c: any) => c._uid === card._uid);
    const isLand = card.type_line?.includes('Land');
    const isInstant = card.type_line?.includes('Instant') || card.oracle_text?.toLowerCase().includes('flash');

    if (inHand) {
      // Lands only in main phase
      if (isLand) {
        if (!isMainPhase) return;
        actions.playLand(card._uid);
        return;
      }
      // Instants/flash anytime during instant/stack priority, sorceries only in main
      if (!canPlaySpells && !isInstant) return;
      if (!canPlaySpells && !isInstantPriority && !isStackPriority) return;
      // During stack priority, only instants/flash cards are allowed
      if (isStackPriority && !isInstant) return;

      // If card has adventure/omen mode (layout='adventure', data in back_face), show choice modal
      if (card.layout === 'adventure' && card.back_face?.name) {
        setAdventureModal({ card });
        return;
      }

      if (spellNeedsTargeting(card)) {
        setTargeting({ cardUid: card._uid, card });
      } else {
        actions.castSpell(card._uid);
      }
    } else if (inBF) {
      if (phase === 'combat_attackers' && snap.activePlayer === 0) {
        // If creature is already attacking, toggle it off
        if (card._attacking) {
          actions.declareAttacker(card._uid);
        } else {
          // Check if opponent has any planeswalkers to potentially attack
          const oppPlaneswalkers = snap.players[1].battlefield.filter(
            (c: any) => c.type_line?.includes('Planeswalker')
          );
          if (oppPlaneswalkers.length > 0) {
            // Show attack target picker
            setAttackTargetPicker({ attackerUid: card._uid });
          } else {
            actions.declareAttacker(card._uid);
          }
        }
      } else if (isLand && !card._tapped) {
        // Sacrifice-to-search lands (Evolving Wilds, Terramorphic Expanse, etc.)
        // should NOT tap for mana — they have no mana ability, only a sac ability
        const oText = (card.oracle_text || '').toLowerCase();
        const isSacFetchland = oText.includes('sacrifice') && oText.includes('search your library') && oText.includes('basic land');
        if (isSacFetchland) {
          // Sacrifice the fetchland and show basic land search overlay
          actions.activateFetchLand(card._uid);
        } else {
          actions.tapLand(card._uid);
        }
      } else if (!isLand && (isMainPhase || isInstantPriority) && snap.activePlayer === 0) {
        // Single-click opens ability/equip modal for non-land permanents in main phase or instant priority
        handleDoubleClick(card);
      }
    }
  }

  // Handle clicking on a player life total as a target
  function handlePlayerTarget(pid: number) {
    if (!snap) return;
    if (targeting) {
      const t = getValidTargets(targeting.card);
      const hit = t.find(x => x.type === 'player' && x.player === pid);
      if (hit) {
        const tgt = [{ type: 'player', player: pid }];
        if (targeting.card._isAdventure) {
          actions.castAdventure(targeting.cardUid, tgt);
        } else {
          actions.castSpell(targeting.cardUid, tgt);
        }
        setTargeting(null);
      }
      return;
    }
    if (snap.waitingForInput?.type === 'choose_target') {
      actions.resolveChooseTarget([{ type: 'player', player: pid }]);
    }
    // post_modal_target: allow player targeting for damage/drain-type modes
    if (snap.waitingForInput?.type === 'post_modal_target' && snap.waitingForInput.playerId === 0) {
      const targetType = snap.waitingForInput.targetType;
      if (targetType === 'any' || targetType === 'player' || targetType === 'opponent') {
        actions.resolvePostModalTarget({ type: 'player', player: pid });
      }
    }
  }

  // Handle double-click on battlefield cards → show ability modal or equip modal
  function handleDoubleClick(card: any) {
    if (!snap || snap.activePlayer !== 0) return;
    const phase = snap.phase;
    const wiType = snap.waitingForInput?.type;
    const isInstantWindow = wiType === 'instant_priority' || wiType === 'stack_priority';
    if (phase !== 'main1' && phase !== 'main2' && !isInstantWindow) return;
    const gs = gsRef.current;
    if (!gs) return;

    // Equipment: show creature picker to attach to
    if ((card.type_line || '').includes('Equipment')) {
      setEquipModal({ equipUid: card._uid, equipName: card.name });
      return;
    }

    // Dynamically import cards engine to get abilities
    import('../engine/cards').then(({ getActivatedAbilities, getLoyaltyAbilities }) => {
      const isPlane = card.type_line?.includes('Planeswalker');
      const abilities = isPlane ? getLoyaltyAbilities(card) : getActivatedAbilities(card);
      if (abilities && abilities.length > 0) {
        setAbilityModal({ card, abilities });
      }
    }).catch(() => {
      // fallback: try harmonize
      const harmonizeCost = (card as any)._harmonizeGranted || (card.oracle_text || '').includes('Harmonize');
      if (harmonizeCost) actions.castHarmonize(card._uid);
    });
  }

  // Handle activating an ability from the ability modal
  function handleActivateAbility(cardUid: string, abilityIdx: number, card: any) {
    const isPlaneswalker = card.type_line?.includes('Planeswalker');
    if (isPlaneswalker) {
      actions.activateLoyaltyAbility(cardUid, abilityIdx);
    } else {
      // Use battlefield ability activation (not graveyard)
      actions.activateBattlefieldAbility(cardUid, abilityIdx);
    }
  }

  // ── Loading / Error ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="game-loading">
        <div className="draft-spinner" />
        <p>Initializing game engine...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="game-loading">
        <p style={{ color: 'var(--danger)' }}>Engine error: {error}</p>
        <button className="btn" onClick={() => setScreen('home')}>Back to Home</button>
      </div>
    );
  }

  if (!snap || !snap.players || snap.players.length < 2) return null;

  const { phase, turn, activePlayer, log, winner, stackSize, combat, mulliganDone } = snap;
  const [p0, p1] = snap.players;
  const phaseIdx = PHASES.findIndex(p => p.key === phase);
  const myMana = Object.entries(p0.manaPool || {}).filter(([, v]) => (v as number) > 0);

  // Compute playable hand cards (includes untapped lands for auto-tap estimate)
  const totalMana = Object.values(p0.manaPool || {}).reduce((s: number, v) => s + ((v as number) || 0), 0);
  const isMainPhaseHuman = activePlayer === 0 && (phase === 'main1' || phase === 'main2');
  const wi = snap.waitingForInput;
  const isInstantPriorityHuman = wi?.playerId === 0 && (wi?.type === 'instant_priority' || wi?.type === 'stack_priority');
  const humanHasPriority = isMainPhaseHuman || isInstantPriorityHuman || (wi?.playerId === 0);
  const landPlayedThisTurn = !!(gsRef.current?.landPlayedThisTurn);
  // Count untapped lands on battlefield to estimate auto-tap mana
  const untappedLandCards = p0.battlefield.filter((c: any) =>
    c.type_line?.toLowerCase().includes('land') && !c._tapped
  );
  const untappedLands = untappedLandCards.length;
  const totalAvailableMana = totalMana + untappedLands;

  // Build color-aware available mana pool (current pool + untapped land colors)
  // Used to correctly gate playable cards by color, not just quantity
  const colorPool: Record<string, number> = { ...(p0.manaPool || {}) };
  untappedLandCards.forEach((land: any) => {
    getLandManaColors(land).forEach((color: string) => {
      colorPool[color] = (colorPool[color] || 0) + 1;
    });
  });

  function cardIsInstantSpeed(c: any): boolean {
    const tl = (c.type_line || '').toLowerCase();
    if (tl.includes('instant')) return true;
    const kws = (c.keywords || []).map((k: any) => (k || '').toLowerCase());
    if (kws.includes('flash')) return true;
    if ((c.oracle_text || '').toLowerCase().includes('flash')) return true;
    return false;
  }

  const playableSet = new Set<string>(
    humanHasPriority
      ? p0.hand
          .filter((c: any) => {
            const isLand = (c.type_line || '').toLowerCase().includes('land');
            if (isInstantPriorityHuman) {
              // During combat / stack priority: only instants and flash cards are playable
              if (!cardIsInstantSpeed(c)) return false;
              if ((c.cmc ?? 0) > totalAvailableMana) return false;
              const cost = c.mana_cost || '';
              return !cost || canPay(colorPool as ManaPool, cost, c.cmc ?? 0);
            }
            // Main phase: lands + affordable spells
            if (isLand) return !landPlayedThisTurn;
            if ((c.cmc ?? 0) > totalAvailableMana) return false;
            const cost = c.mana_cost || '';
            return !cost || canPay(colorPool as ManaPool, cost, c.cmc ?? 0);
          })
          .map((c: any) => c._uid)
      : []
  );

  // ── Game over ────────────────────────────────────────────────────────────────

  if (winner !== null) {
    return (
      <div className="game-over animate-fade-in">
        <div className="game-over-card glass">
          <h2 className={winner === 0 ? 'win' : 'lose'}>{winner === 0 ? 'You win! 🎉' : 'AI wins!'}</h2>
          <p>Turn {turn} · {p0.life} vs {p1.life} life</p>
          <div className="game-over-actions">
            <button className="btn btn-gold" onClick={() => actions.restartGame()}>Play Again</button>
            <button className="btn" onClick={() => setScreen('deckbuilder')}>Back to Deck</button>
            <button className="btn btn-muted" onClick={() => setScreen('home')}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Mulligan screen ──────────────────────────────────────────────────────────

  if (phase === 'mulligan' && !mulliganDone[0]) {
    const mulligansTaken = snap.mulliganCount[0] ?? 0;
    const bottomCount = mulligansTaken; // London rule: put N on bottom

    // Phase 2: select cards to put on bottom
    if (showingBottomSelect && bottomCount > 0) {
      function toggleMulliganCard(uid: string) {
        setMulliganBottomSelected(prev =>
          prev.includes(uid) ? prev.filter(x => x !== uid)
            : prev.length < bottomCount ? [...prev, uid] : prev
        );
      }
      return (
        <div className="game-screen animate-fade-in">
          <div className="game-mulligan-overlay glass">
            <h2>Put {bottomCount} Card{bottomCount !== 1 ? 's' : ''} on Bottom</h2>
            <p className="text-muted" style={{ marginBottom: 8 }}>
              Select {bottomCount} to put on the bottom ({mulliganBottomSelected.length}/{bottomCount})
            </p>
            <div className="game-mulligan-hand">
              {p0.hand.map((card: any) => (
                <div
                  key={card._uid}
                  className={`game-hand-card ${mulliganBottomSelected.includes(card._uid) ? 'mulligan-to-bottom' : ''}`}
                  onClick={() => toggleMulliganCard(card._uid)}
                  style={{ cursor: 'pointer' }}
                >
                  <CardImage card={card} size="small" />
                  {mulliganBottomSelected.includes(card._uid) && (
                    <div className="mulligan-bottom-badge">⬇ Bottom</div>
                  )}
                </div>
              ))}
            </div>
            <div className="game-mulligan-actions">
              <button
                className="btn btn-gold"
                disabled={mulliganBottomSelected.length < bottomCount}
                onClick={() => {
                  actions.keepHand(mulliganBottomSelected);
                  setShowingBottomSelect(false);
                  setMulliganBottomSelected([]);
                }}
              >Confirm ({mulliganBottomSelected.length}/{bottomCount}) (K)</button>
              <button className="btn btn-muted" onClick={() => {
                const sorted = [...p0.hand].sort((a: any, b: any) => (a.cmc || 0) - (b.cmc || 0));
                setMulliganBottomSelected(sorted.slice(0, bottomCount).map((c: any) => c._uid));
              }}>Auto-select Worst</button>
            </div>
          </div>
        </div>
      );
    }

    // Phase 1: view hand + keep/mulligan
    return (
      <div className="game-screen animate-fade-in">
        <div className="game-mulligan-overlay glass">
          <h2>Opening Hand{mulligansTaken > 0 ? ` (Mulligan #${mulligansTaken})` : ''}</h2>
          <div className="game-mulligan-hand">
            {p0.hand.map((card: any) => (
              <div key={card._uid} className="game-hand-card">
                <CardImage card={card} size="small" />
              </div>
            ))}
          </div>
          <div className="game-mulligan-actions">
            <button className="btn btn-gold" onClick={() => {
              if (bottomCount > 0) {
                setShowingBottomSelect(true); // Enter phase 2
              } else {
                actions.keepHand([]); // No mulligans taken, keep directly
              }
            }}>Keep (K)</button>
            <button className="btn" onClick={() => {
              actions.mulligan();
              setMulliganBottomSelected([]);
              setShowingBottomSelect(false);
            }}>Mulligan (M)</button>
          </div>
          <p className="text-muted" style={{ marginTop: 8 }}>{p0.hand.length} cards</p>
        </div>
      </div>
    );
  }

  // ── Main game UI ─────────────────────────────────────────────────────────────

  return (
    <div className="game-screen animate-fade-in">

      {/* ── Opponent bar ── */}
      <div className="game-opp-bar">
        <div className="game-player-info">
          <span
            data-player-id="p1"
            className={`game-life opp ${targeting && getValidTargets(targeting.card).some(t => t.type === 'player' && t.player === 1) ? 'life-targetable' : ''}`}
            onClick={() => handlePlayerTarget(1)}
          >{p1.life} ❤️</span>
          <span className="game-name">AI</span>
          <span className="game-counts">
            Hand: {p1.hand.length} · Library: {p1.libraryCount}
          </span>
          <span
            className="gy-click-zone"
            onClick={() => setGraveyardOpen({ pid: 1 })}
          >☠ GY: {p1.graveyard.length}</span>
          <span
            className="exile-click-zone"
            onClick={() => setExileOpen({ pid: 1 })}
          >✨ Ex: {p1.exile?.length || 0}</span>
        </div>
        {activePlayer === 1 && <div className="game-active-indicator">AI thinking...</div>}
      </div>

      {/* ── Opponent battlefield ── */}
      <div className="game-opp-bf">
        {p1.battlefield.length === 0
          ? <span className="game-bf-empty">Opponent battlefield</span>
          : (() => {
              // Sort: regular permanents first, planeswalkers last (right side)
              const nonLands = p1.battlefield
                .filter((c: any) => !c.type_line?.includes('Land'))
                .sort((a: any, b: any) => (a.type_line?.includes('Planeswalker') ? 1 : 0) - (b.type_line?.includes('Planeswalker') ? 1 : 0));
              const lands = p1.battlefield.filter((c: any) => c.type_line?.includes('Land'));
              const makeCard = (card: any) => {
                const validTgts = targeting ? getValidTargets(targeting.card) : [];
                const isTargetable = !!(targeting &&
                  validTgts.some((t: any) => (t.type === 'creature' || t.type === 'permanent') && t.uid === card._uid));
                const isBlockingTarget = !!(snap.waitingForInput?.type === 'declare_blockers' &&
                  blockingWith && card._attacking);
                // Show "being attacked" glow on a PW that is currently targeted by an attacker
                const isAttackTarget = !!(card.type_line?.includes('Planeswalker') &&
                  combat.attackers.some((a: any) => a.attackTarget === card._uid));
                return (
                  <BattlefieldCard
                    key={card._uid}
                    card={card}
                    isAttacking={combat.attackers.some((a: any) => a.uid === card._uid)}
                    isAttacker={false}
                    isTargetable={isTargetable || isAttackTarget}
                    isBlockingTarget={isBlockingTarget}
                    overrideArtUrl={getLandArtUrl(card)}
                    onClick={c => handleCardClick(c, 1)}
                    onRightClick={c => setZoom(c)}
                  />
                );
              };
              return (
                <>
                  <div className="bf-creatures-row">{nonLands.map(makeCard)}</div>
                  {lands.length > 0 && <div className="bf-lands-row">{lands.map(makeCard)}</div>}
                </>
              );
            })()
        }
      </div>

      {/* ── Center strip ── */}
      <div className="game-center-strip">
        {/* Phase strip */}
        <div className="game-phase-strip">
          {PHASES.map((p, i) => (
            <div
              key={p.key}
              className={`game-phase-step ${i === phaseIdx ? 'active' : ''} ${i < phaseIdx ? 'done' : ''}`}
            >
              {p.label}
            </div>
          ))}
        </div>

        {/* Turn/Stack info */}
        <div className="game-center-info">
          <span className="game-turn">Turn {turn}</span>
          {stackSize > 0 && (
            <div className="game-stack-indicator">Stack: {stackSize}</div>
          )}
          <div className="game-actions">
            {/* AI turn indicator */}
            {activePlayer === 1 && !snap.waitingForInput && (
              <span className="game-ai-thinking">⚙ Opponent playing...</span>
            )}

            {/* Opponent attacks — human must block */}
            {snap.waitingForInput?.type === 'declare_blockers' && snap.waitingForInput?.playerId === 0 && (
              <>
                <span className="game-action-hint urgent">⚔ Opponent attacks! Click your creature then click attacker to block</span>
                <button className="btn btn-gold" onClick={() => actions.confirmBlockers()}>
                  Confirm Blockers (Space)
                </button>
              </>
            )}

            {/* Human turn hints */}
            {activePlayer === 0 && (phase === 'main1' || phase === 'main2') && (
              <span className="game-action-hint">
                Play cards · Tap lands for mana
              </span>
            )}
            {activePlayer === 0 && phase === 'combat_begin' && (
              <span className="game-action-hint">Enter combat phase</span>
            )}
            {activePlayer === 0 && phase === 'combat_attackers' && (
              <span className="game-action-hint">Click creatures to attack</span>
            )}
            {activePlayer === 0 && phase === 'combat_blockers' && (
              <span className="game-action-hint">Click your creature → then click attacker to block</span>
            )}

            {/* Attack buttons */}
            {phase === 'combat_attackers' && activePlayer === 0 && (
              <>
                <button className="btn btn-muted" onClick={() => {
                  p0.battlefield
                    .filter((c: any) => {
                      if (!c.type_line?.includes('Creature') || c._tapped) return false;
                      const hasHaste = c._tempKeywords?.includes('Haste') ||
                        (c.keywords || []).some((k: string) => k?.toLowerCase() === 'haste') ||
                        (c.oracle_text || '').toLowerCase().includes('haste');
                      return !c._summoningSick || hasHaste;
                    })
                    .forEach((c: any) => actions.declareAttacker(c._uid));
                }}>Attack All (A)</button>
                <button className="btn btn-gold" onClick={() => actions.nextPhase()}>
                  {combat.attackers.length > 0 ? `Attack with ${combat.attackers.length} (Space)` : 'Skip Attack (Space)'}
                </button>
              </>
            )}

            {/* Main phase pass / other phase next — only when human is active and no blocker assignment needed */}
            {activePlayer === 0 && phase !== 'combat_attackers' && !(snap.waitingForInput?.type === 'declare_blockers') && !(snap.waitingForInput?.type === 'instant_priority') && (
              <button className="btn btn-gold" onClick={() => actions.nextPhase()}>
                {(phase === 'main1' || phase === 'main2') ? 'Pass Turn (Space)' :
                 phase === 'combat_begin' ? 'To Attack (Space)' :
                 phase === 'combat_blockers' ? 'No Blocks (Space)' :
                 'Next (Space)'}
              </button>
            )}

            <button className={`btn btn-muted ${showLog ? 'active' : ''}`} onClick={() => setShowLog(v => !v)}>
              Log (L)
            </button>
          </div>
        </div>

        {/* Mana pool */}
        {myMana.length > 0 && (
          <div className="game-mana-pool">
            {myMana.map(([color, count]) => (
              <div key={color} className="game-mana-pip">
                <div className={`mana-dot mana-${color}`} />{count as number}
              </div>
            ))}
            {canUndoMana && isMainPhaseHuman && (
              <button
                className="btn-undo-mana"
                onClick={() => actions.undoTapLand()}
                title="Desfazer último tap de mana"
              >↩ Desfazer</button>
            )}
          </div>
        )}
      </div>

      {/* ── My battlefield ── */}
      <div
        className={`game-my-bf playmat-${playmat}`}
        style={playmat === 'custom' && playmatArt ? {
          backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url('${playmatArt}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } : undefined}
      >
        {p0.battlefield.length === 0
          ? <span className="game-bf-empty">Your battlefield</span>
          : (() => {
              // Sort: regular permanents first, planeswalkers last (right side)
              const nonLands = p0.battlefield
                .filter((c: any) => !c.type_line?.includes('Land'))
                .sort((a: any, b: any) => (a.type_line?.includes('Planeswalker') ? 1 : 0) - (b.type_line?.includes('Planeswalker') ? 1 : 0));
              const lands = p0.battlefield.filter((c: any) => c.type_line?.includes('Land'));
              const makeCard = (card: any) => {
                const isTargetable = !!(targeting &&
                  getValidTargets(targeting.card).some((t: any) => (t.type === 'creature' || t.type === 'permanent') && t.uid === card._uid));
                const isAssignedBlocker = !!(card._blocking);
                const isSelectedBlocker = blockingWith === card._uid;
                const canActivatePW = !!(
                  card.type_line?.includes('Planeswalker') &&
                  isMainPhaseHuman &&
                  !card._loyaltyUsedThisTurn
                );
                return (
                  <BattlefieldCard
                    key={card._uid}
                    card={card}
                    isAttacking={combat.attackers.some((a: any) => a.uid === card._uid)}
                    isAttacker
                    isTargetable={isTargetable}
                    isAssignedBlocker={isAssignedBlocker}
                    isSelectedBlocker={isSelectedBlocker}
                    canActivate={canActivatePW}
                    overrideArtUrl={getLandArtUrl(card)}
                    onClick={c => handleCardClick(c, 0)}
                    onDoubleClick={c => handleDoubleClick(c)}
                    onRightClick={c => setZoom(c)}
                  />
                );
              };
              return (
                <>
                  <div className="bf-creatures-row">{nonLands.map(makeCard)}</div>
                  {lands.length > 0 && <div className="bf-lands-row">{lands.map(makeCard)}</div>}
                </>
              );
            })()
        }
      </div>

      {/* ── Player bar + hand (+ harmonize sidebar) ── */}
      <div className="game-bottom">
        <div className="game-my-bar">
          <span
            data-player-id="p0"
            className={`game-life mine ${targeting && getValidTargets(targeting.card).some(t => t.type === 'player' && t.player === 0) ? 'life-targetable' : ''}`}
            onClick={() => handlePlayerTarget(0)}
          >{p0.life} ❤️</span>
          <span className="game-name">You</span>
          <span className="game-counts">Hand: {p0.hand.length} · Lib: {p0.libraryCount}</span>
          <span
            className="gy-click-zone"
            onClick={() => setGraveyardOpen({ pid: 0 })}
          >☠ GY: {p0.graveyard.length}</span>
          <span
            className="exile-click-zone"
            onClick={() => setExileOpen({ pid: 0 })}
          >✨ Ex: {p0.exile?.length || 0}</span>
          {activePlayer === 0 && <div className="game-active-indicator mine">Your turn</div>}
        </div>
        {/* Hand + Harmonize sidebar in the same row */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div className="game-hand">
            {p0.hand.map((card: any) => (
              <div
                key={card._uid}
                className={`game-hand-card ${playableSet.has(card._uid) ? 'hand-playable' : humanHasPriority ? 'hand-unplayable' : ''}`}
                onClick={() => handleCardClick(card, 0)}
                onContextMenu={e => { e.preventDefault(); setZoom(card); }}
              >
                <CardImage card={card} size="small" overrideArtUrl={getLandArtUrl(card)} />
              </div>
            ))}
          </div>
          {/* ── Harmonize sidebar ── (beside hand, visible during main phase) */}
          {(phase === 'main1' || phase === 'main2') && activePlayer === 0 && (() => {
            const harmonizeCards = p0.graveyard.filter((c: any) => {
              const text = (c.oracle_text || '').toLowerCase();
              return text.includes('harmonize') || c._harmonizeGranted;
            });
            if (harmonizeCards.length === 0) return null;
            return (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: '4px',
                padding: '4px 6px', borderLeft: '1px solid rgba(78,205,196,0.4)',
                overflowY: 'auto', minWidth: '72px', maxWidth: '100px',
                background: 'rgba(0,0,0,0.25)',
              }}>
                <span style={{ fontSize: '9px', fontWeight: 700, color: '#4ecdc4', whiteSpace: 'nowrap', textAlign: 'center' }}>⚗ Harmonize</span>
                {harmonizeCards.map((card: any) => (
                  <div
                    key={card._uid}
                    className={`harmonize-card ${card._harmonizeCanCast !== false ? 'can-cast' : 'no-mana'}`}
                    onClick={() => actions.castHarmonize(card._uid)}
                    style={{ width: '64px' }}
                  >
                    <CardImage card={card} size="small" />
                    <div className="harmonize-card-name">{card.name}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Log overlay ── */}
      {showLog && (
        <div className="game-log glass" ref={logRef}>
          {log.map((entry: string, i: number) => <div key={i} className="game-log-entry">{entry}</div>)}
        </div>
      )}


      {/* ── Card zoom (right-click) ── */}
      {zoom && (
        <div className="game-zoom-overlay" onClick={() => setZoom(null)}>
          <img src={zoom.image_normal} alt={zoom.name} className="game-zoom-img" />
          <div className="game-zoom-info glass">
            <div className="game-zoom-name">{zoom.name}</div>
            <div className="game-zoom-type">{zoom.type_line}</div>
            {zoom.oracle_text && <div className="game-zoom-text">{zoom.oracle_text}</div>}
            {zoom.power && <div className="game-zoom-pt">{zoom.power}/{zoom.toughness}</div>}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ── OVERLAYS (conditionally rendered based on waitingForInput) ─── */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      {(() => {
        const wi = snap.waitingForInput;
        const gs = gsRef.current;
        if (!wi || wi.playerId !== 0) return null;

        switch (wi.type) {
          // ── Scry / Surveil ──────────────────────────────────────────────
          case 'scry':
          case 'surveil':
            return gs?._pendingScry ? (
              <ScryOverlay pendingScry={gs._pendingScry} onConfirm={actions.resolveScry} />
            ) : null;

          // ── Modal spell picker ──────────────────────────────────────────
          case 'modal_choice':
            return gs?._pendingModal ? (
              <ModalOverlay pendingModal={gs._pendingModal} onConfirm={actions.resolveModal} />
            ) : null;

          // ── Post-modal target selection banner ──────────────────────────
          case 'post_modal_target': {
            const labelMap: Record<string, string> = {
              creature: 'qualquer criatura',
              own_creature: 'uma das suas criaturas',
              opponent_creature: 'uma criatura do oponente',
              creature_with_flying: 'uma criatura com voar',
              artifact: 'um artefato',
              enchantment: 'um encantamento',
              permanent: 'uma permanente',
              nonland_permanent: 'uma permanente não-terreno',
              any: 'qualquer alvo',
            };
            const label = labelMap[wi.targetType] || wi.targetType;
            return (
              <div style={{
                position: 'fixed', bottom: 130, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(10, 10, 30, 0.95)', border: '2px solid #7c3aed',
                borderRadius: 12, padding: '12px 28px', zIndex: 9999, color: '#fff',
                fontSize: 15, fontWeight: 600, textAlign: 'center', pointerEvents: 'none',
                boxShadow: '0 0 20px rgba(124,58,237,0.5)',
              }}>
                🎯 {wi.cardName || 'Feitiço'}: escolha {label}
                <div style={{ fontSize: 12, color: '#a78bfa', marginTop: 4 }}>
                  Clique em um alvo válido no campo de batalha
                </div>
              </div>
            );
          }

          // ── Blocker declare banner ──────────────────────────────────────
          case 'declare_blockers':
            return (
              <BlockerConfirmBanner
                attackerCount={snap.combat.attackers.length}
                blockerCount={Object.keys(gs?.combat?.blockers || {}).length}
                onConfirm={actions.confirmBlockers}
              />
            );

          // ── Instant priority window ─────────────────────────────────────
          case 'instant_priority':
            return (
              <InstantPriorityBanner phase={wi.phase || ''} onPass={actions.nextPhase} />
            );

          // ── Stack priority (opponent can respond) ───────────────────────
          case 'stack_priority':
            return (
              <StackPriorityBanner
                spellName={gs?._pendingCastOnStack?.card?.name || 'Spell'}
                onPass={actions.nextPhase}
              />
            );

          // ── Mana color choice ───────────────────────────────────────────
          case 'mana_color_choice':
            return gs?._pendingManaChoice ? (
              <ManaColorOverlay
                colors={gs._pendingManaChoice.colors || ['W','U','B','R','G']}
                onConfirm={actions.resolveManaColor}
              />
            ) : null;

          // ── Discard overlays ────────────────────────────────────────────
          case 'discard':
            return (
              <DiscardOverlay
                hand={snap.players[0].hand}
                amount={wi.amount || 1}
                title="🗑 Discard to hand size"
                onConfirm={actions.resolveDiscard}
              />
            );
          case 'mandatory_discard':
            return gs?._pendingDiscard ? (
              <DiscardOverlay
                hand={snap.players[0].hand}
                amount={gs._pendingDiscard.amount || 1}
                optional={!!(gs._pendingDiscard.up_to || gs._pendingDiscard.optional)}
                title={gs._pendingDiscard.up_to ? '🗑 Discard (Optional — up to N)' : '🗑 Mandatory Discard'}
                onConfirm={actions.resolveMandatoryDiscard}
              />
            ) : null;
          case 'discard_for_loot':
            return (
              <DiscardOverlay
                hand={snap.players[0].hand}
                amount={1}
                title="🔄 Loot — Discard to Draw"
                hint="Discard a card, then draw a card."
                onConfirm={uids => actions.resolveLootDiscard(uids[0])}
              />
            );
          case 'rummage_discard':
            return gs?._pendingRummage ? (
              <DiscardOverlay
                hand={snap.players[0].hand}
                amount={gs._pendingRummage.amount || 1}
                optional={gs._pendingRummage.optional}
                title="♻ Rummage — Discard"
                onConfirm={actions.resolveRummage}
              />
            ) : null;
          case 'optional_discard_choice':
            return gs?._pendingOptionalDiscard ? (
              <DiscardOverlay
                hand={snap.players[0].hand}
                amount={gs._pendingOptionalDiscard.amount || 1}
                optional
                title="🗑 Optional Discard"
                onConfirm={uids => actions.resolveDiscard(uids)}
              />
            ) : null;

          // ── Search library / Ramp choice ────────────────────────────────
          case 'ramp_choice':
          case 'search_library':
          case 'search_library_choice': {
            const pending = gs?._pendingRamp || gs?._pendingSearch || gs?._pendingSearchChoice;
            const candidates = pending?.lands || pending?.candidates || [];
            return candidates.length > 0 ? (
              <SearchLibraryOverlay
                candidates={candidates}
                optional={pending?.optional}
                title={pending?.tapped ? '🌳 Search — Put Land into Play (Tapped)' : '📚 Search Library'}
                onConfirm={actions.resolveSearchLibrary}
              />
            ) : null;
          }

          // ── Blight choice (pick own creature for -1/-1) ──────────────────
          case 'blight_choice': {
            const bf0 = snap.players[0].battlefield.filter((c: any) => c.type_line?.includes('Creature'));
            return (
              <CreatureChoiceOverlay
                creatures={bf0}
                title="🩸 Blight — Choose Creature"
                hint="Put -1/-1 counters on this creature."
                onConfirm={uid => uid && actions.resolveBlight(uid)}
              />
            );
          }

          // ── Buff choice (pick own creature to buff) ──────────────────────
          case 'buff_choice': {
            const pending = gs?._pendingBuffChoice;
            const candidates = (pending?.candidates || [])
              .map((uid: string) => snap.players[0].battlefield.find((c: any) => c._uid === uid))
              .filter(Boolean);
            return (
              <CreatureChoiceOverlay
                creatures={candidates}
                title="⬆ Buff — Choose Creature"
                onConfirm={uid => uid && actions.resolveBuffChoiceAction(uid)}
              />
            );
          }

          // ── Distribute counters (pick creature to receive all counters) ──
          case 'distribute_counters': {
            const pending = gs?._pendingDistribute;
            const creatures = pending
              ? snap.players[0].battlefield.filter((c: any) => c.type_line?.includes('Creature'))
              : [];
            return (
              <CreatureChoiceOverlay
                creatures={creatures}
                title={`🎯 Distribute — Choose Creature (+${pending?.amount || 0} ${pending?.counter || '+1/+1'})`}
                onConfirm={uid => uid && actions.resolveDistributeCountersAction(uid)}
              />
            );
          }

          // ── Sacrifice choice ─────────────────────────────────────────────
          case 'sacrifice': {
            const choices = (wi as any).choices || [];
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="💀 Sacrifice — Choose Creature"
                optional={(wi as any).optional}
                onConfirm={uid => actions.resolveSacrifice(uid)}
              />
            );
          }

          // ── Look top cards ───────────────────────────────────────────────
          case 'look_top_choice':
          case 'look_top_land_choice':
          case 'look_top_permanent_choice': {
            const pending = gs?._pendingLookTop;
            return pending ? (
              <LookTopOverlay
                cards={pending.cards || []}
                pickCount={pending.pickCount}
                onConfirm={actions.resolveLookTop}
              />
            ) : null;
          }

          // ── Clash ────────────────────────────────────────────────────────
          case 'clash': {
            const pending = gs?._pendingClash;
            return pending ? (
              <ClashOverlay
                myCard={pending.myCard}
                oppCard={pending.oppCard}
                myCmc={pending.myCmc || 0}
                oppCmc={pending.oppCmc || 0}
                won={pending.won || false}
                cardName={pending.cardName || 'Clash'}
                onConfirm={actions.resolveClash}
              />
            ) : null;
          }

          // ── Confirm optional ─────────────────────────────────────────────
          case 'confirm_optional':
            return (
              <ConfirmOptionalOverlay
                message={wi.message as string || 'Activate this optional effect?'}
                onConfirm={actions.resolveConfirmOptional}
              />
            );

          // ── Unless pay ───────────────────────────────────────────────────
          case 'unless_pay_decision': {
            const pending = gs?._pendingUnlessPay;
            return pending ? (
              <UnlessPayOverlay
                spell={pending.spell}
                costStr={pending.costStr || '?'}
                onConfirm={actions.resolveUnlessPayAction}
              />
            ) : null;
          }

          // ── Mill land choice ─────────────────────────────────────────────
          case 'mill_land_choice': {
            const pending = gs?._pendingMillLandChoice;
            return (
              <MillLandChoiceOverlay
                landName={pending?.milledLands?.[0]?.name || 'Land'}
                onConfirm={actions.resolveMillLand}
              />
            );
          }

          // ── Endure choice ────────────────────────────────────────────────
          case 'endure_choice': {
            const pending = gs?._pendingEndure;
            return (
              <EndureChoiceOverlay
                amount={pending?.amount || 1}
                onConfirm={actions.resolveEndure}
              />
            );
          }

          // ── Trigger cost ─────────────────────────────────────────────────
          case 'trigger_cost': {
            const trigger = (wi as any).trigger;
            return (
              <TriggerCostOverlay
                triggerName={trigger?.cardName || 'Trigger'}
                costDesc={trigger?.costDescription}
                onConfirm={actions.resolveTriggerCostAction}
              />
            );
          }

          // ── Hand exile choice (behold / exile from hand) ──────────────────
          // ── Exile choose: pick which exiled cards to make playable ────
          case 'exile_choose': {
            const pending = gs?._pendingExileChoice;
            if (!pending) return null;
            return (
              <SearchLibraryOverlay
                candidates={pending.cards || []}
                title={`✨ Exile — Escolha ${pending.choose || 1} para jogar`}
                hint="Escolha qual carta exilada você pode jogar."
                onConfirm={uid => {
                  if (!uid) { actions.resolveUnknownInput(); return; }
                  actions.resolveExileChoice(uid);
                }}
              />
            );
          }

          case 'hand_exile_choice': {
            const pending = gs?._pendingHandExile;
            const cards = pending?.cards || snap.players[0].hand.filter((c: any) => !c.type_line?.includes('Land'));
            return (
              <SearchLibraryOverlay
                candidates={cards}
                title="✨ Exile from Hand"
                hint="Choose a card to exile (behold cost)."
                onConfirm={uid => uid && actions.resolveHandExile(uid)}
              />
            );
          }

          // ── Graveyard card choice ────────────────────────────────────────
          case 'graveyard_choice':
          case 'graveyard_card_choice': {
            const pending = gs?._pendingGraveyardChoice || gs?._pendingGraveyardCardChoice;
            const gy = snap.players[0].graveyard;
            return gy.length > 0 ? (
              <SearchLibraryOverlay
                candidates={gy}
                optional
                title="☠ Choose from Graveyard"
                onConfirm={uid => actions.resolveGraveyardCardChoice(uid ? [uid] : [])}
              />
            ) : null;
          }

          // ── Choose GY return ─────────────────────────────────────────────
          case 'choose_gy_return': {
            const pending = gs?._pendingGYReturn;
            const candidates = pending?.candidates || snap.players[0].graveyard;
            return (
              <SearchLibraryOverlay
                candidates={candidates}
                optional={(wi as any).optional}
                title="⬆ Return from Graveyard"
                hint="Choose a card to return to hand."
                onConfirm={uid => actions.resolveGYReturn(uid ? [uid] : [])}
              />
            );
          }

          // ── Traveling Botanist: hand vs graveyard choice ──────────────
          case 'traveling_botanist_choice': {
            const pending = gs?._pendingTravelingBotanist;
            if (!pending) return null;
            const cardName = pending.card?.name || 'terreno';
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8000 }}>
                <div className="glass overlay-panel" style={{ maxWidth: 360, padding: 20, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--gold)' }}>Traveling Botanist</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    {cardName} está no topo. O que fazer?
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <button className="btn btn-gold" onClick={() => actions.resolveTravelingBotanist(true)}>
                      📤 Colocar na mão
                    </button>
                    <button className="btn btn-muted" onClick={() => actions.resolveTravelingBotanist(false)}>
                      ☠ Cemitério
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Multi-buff choice: select up to N creatures ────────────────
          case 'multi_buff_choice': {
            const pending = gs?._pendingMultiBuffChoice;
            if (!pending) return null;
            const candidates = snap.players[0].battlefield.filter((c: any) =>
              c.type_line?.includes('Creature') && pending.candidates?.includes(c._uid)
            );
            return (
              <CreatureChoiceOverlay
                creatures={candidates}
                title={`💪 Buff até ${pending.maxTargets || 1} Criatura(s)`}
                hint={`Escolha uma criatura para receber o bônus`}
                optional
                onConfirm={uid => actions.resolveMultiBuffChoiceAction(uid ? [uid] : [])}
              />
            );
          }

          // ── Normal gameplay states — no overlay, player acts on board ──
          case 'main_phase':
          case 'declare_attackers':
          case 'mulligan':
            return null;

          // ── Blocker damage order — auto-resolve using AI heuristic ───
          case 'order_blockers': {
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 7000 }}>
                <div className="glass overlay-panel" style={{ maxWidth: 320, padding: 16, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Ordem dos Bloqueadores</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Múltiplos bloqueadores — confirme a ordem de atribuição de dano.
                  </div>
                  <button className="btn btn-gold" onClick={() => actions.resolveOrderBlockers()}>
                    Confirmar Ordem
                  </button>
                </div>
              </div>
            );
          }

          // ── Legendary rule: cast new (sacrifice old) or cancel ───────
          case 'legendary_choice_pre_cast': {
            const pending = gs?._pendingLegendaryChoice;
            if (!pending) return null;
            const existingName = pending.existingCards?.[0]?.name ?? 'lendária existente';
            const newName = pending.cardToCast?.name ?? 'nova carta';
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 7000 }}>
                <div className="glass overlay-panel" style={{ maxWidth: 340, padding: 20, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Regra Lendária</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                    Você já controla <strong>{existingName}</strong>.<br />
                    Conjurar <strong>{newName}</strong> vai sacrificar a existente.
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button className="btn btn-gold" onClick={() => actions.resolveLegendaryChoice('keep_new')}>
                      Conjurar (sacrificar antiga)
                    </button>
                    <button className="btn btn-muted" onClick={() => actions.resolveLegendaryChoice('cancel')}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── target_choice_single: pick one creature from pending targets ──
          case 'target_choice_single': {
            const pending = gs?._pendingTargetChoice;
            if (!pending || !pending.targets?.length) return null;
            return (
              <CreatureChoiceOverlay
                creatures={pending.targets}
                title={`🎯 ${pending.effectType === 'tap' ? 'Virar' : 'Escolher'} — Escolha uma criatura`}
                optional={false}
                onConfirm={uid => uid && actions.resolveTargetChoiceSingle(uid)}
              />
            );
          }

          // ── Behold: reveal a dragon from hand ───────────────────────
          case 'behold_choice_multiple':
          case 'behold_choice_optional': {
            const pending = gs?._pendingBeholdChoice;
            if (!pending) return null;
            return (
              <SearchLibraryOverlay
                candidates={pending.cards || []}
                title="🐉 Behold — Revele um Dragão da sua mão"
                hint="Escolha qual Dragão revelar."
                optional={pending.isOptional === true}
                onConfirm={uid => actions.resolveBeholdChoice(uid ?? null)}
              />
            );
          }

          // ── Hideaway: pick 1 of 4 top cards to exile face-down ────────
          case 'hideaway': {
            const pending = gs?._pendingHideaway;
            if (!pending) return null;
            return (
              <SearchLibraryOverlay
                candidates={pending.cards || []}
                title={`🏔️ ${pending.landName} — Esconder`}
                hint="Escolha uma carta para exilar com a terra (ativável depois)."
                optional={false}
                onConfirm={uid => {
                  if (uid) actions.resolveHideaway(uid);
                }}
              />
            );
          }

          // ── Fallback for unhandled types: show a skip button ──────────
          default:
            if (wi && wi.playerId === 0) {
              return (
                <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 7000 }}>
                  <div className="glass overlay-panel" style={{ maxWidth: 300, padding: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                      {(wi as any).type?.replace(/_/g, ' ')}
                    </div>
                    <button className="btn btn-gold" onClick={() => actions.resolveUnknownInput()}>
                      Continuar
                    </button>
                  </div>
                </div>
              );
            }
            return null;
        }
      })()}

      {/* ── Targeting prompt banner (player-initiated) ── */}
      {targeting && (
        <TargetingPrompt
          spell={targeting.card}
          validTargets={getValidTargets(targeting.card)}
          onTarget={() => {}}
          onCancel={() => setTargeting(null)}
        />
      )}

      {/* ── choose_target engine waiting (saga chapters etc.) ── */}
      {snap.waitingForInput?.type === 'choose_target' &&
       snap.waitingForInput.playerId === 0 && (
        <TargetingPrompt
          spell={gsRef.current?._pendingTargetSpell || { name: 'Choose Target' }}
          validTargets={[]}
          onTarget={() => {}}
          onCancel={() => actions.resolveChooseTarget([])}
        />
      )}

      {/* ── Graveyard overlay ── */}
      {graveyardOpen && (
        <GraveyardOverlay
          cards={snap.players[graveyardOpen.pid].graveyard}
          playerId={graveyardOpen.pid}
          onActivate={graveyardOpen.pid === 0 ? actions.activateGraveyardAbility : undefined}
          onClose={() => setGraveyardOpen(null)}
        />
      )}

      {/* ── Ability modal (double-click) ── */}
      {abilityModal && (
        <AbilityModal
          card={abilityModal.card}
          abilities={abilityModal.abilities}
          onActivate={idx => handleActivateAbility(abilityModal.card._uid, idx, abilityModal.card)}
          onClose={() => setAbilityModal(null)}
        />
      )}

      {/* ── Equipment: pick creature to attach to ── */}
      {equipModal && (() => {
        const myCreatures = snap.players[0].battlefield.filter(
          (c: any) => (c.type_line || '').includes('Creature') && !c._tapped
        );
        return (
          <div
            className="overlay-backdrop"
            onClick={() => setEquipModal(null)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}
          >
            <div
              className="glass overlay-panel"
              style={{ maxWidth: 400, padding: 20 }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 15 }}>
                ⚔️ Equipar {equipModal.equipName}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Escolha uma criatura para equipar:
              </div>
              {myCreatures.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nenhuma criatura disponível.</div>
              ) : (
                myCreatures.map((c: any) => (
                  <button
                    key={c._uid}
                    className="btn btn-muted"
                    style={{ display: 'block', width: '100%', marginBottom: 8, textAlign: 'left' }}
                    onClick={() => {
                      actions.equipCreature(equipModal.equipUid, c._uid);
                      setEquipModal(null);
                    }}
                  >
                    {c.name} ({c.power}/{c.toughness})
                  </button>
                ))
              )}
              <button className="btn" style={{ marginTop: 8 }} onClick={() => setEquipModal(null)}>
                Cancelar
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Attack target picker (choose player or planeswalker to attack) ── */}
      {attackTargetPicker && snap && (() => {
        const oppPlaneswalkers = snap.players[1].battlefield.filter(
          (c: any) => c.type_line?.includes('Planeswalker')
        );
        return (
          <div
            className="overlay-backdrop"
            onClick={() => setAttackTargetPicker(null)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9100 }}
          >
            <div
              className="glass overlay-panel"
              style={{ maxWidth: 380, padding: 20 }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 15 }}>
                ⚔️ Quem atacar?
              </div>
              {/* Attack player button */}
              <button
                className="btn btn-gold"
                style={{ display: 'block', width: '100%', marginBottom: 8, textAlign: 'left' }}
                onClick={() => {
                  actions.declareAttacker(attackTargetPicker.attackerUid);
                  setAttackTargetPicker(null);
                }}
              >
                👤 Atacar o jogador
              </button>
              {/* One button per opponent planeswalker */}
              {oppPlaneswalkers.map((pw: any) => (
                <button
                  key={pw._uid}
                  className="btn btn-muted"
                  style={{ display: 'block', width: '100%', marginBottom: 8, textAlign: 'left' }}
                  onClick={() => {
                    actions.declareAttacker(attackTargetPicker.attackerUid, pw._uid);
                    setAttackTargetPicker(null);
                  }}
                >
                  🌟 Atacar {pw.name} <span style={{ color: 'rgba(230,120,0,0.9)', fontWeight: 800 }}>★{pw._loyalty ?? '?'}</span>
                </button>
              ))}
              <button
                className="btn btn-muted"
                style={{ marginTop: 4, width: '100%' }}
                onClick={() => setAttackTargetPicker(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Conditional cost confirmation (e.g. Dragon's Prey targeting a Dragon) ── */}
      {conditionalCostConfirm && (
        <div
          className="overlay-backdrop"
          onClick={() => setConditionalCostConfirm(null)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9100 }}
        >
          <div
            className="glass"
            style={{ padding: '20px', borderRadius: '12px', minWidth: '300px', textAlign: 'center' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '10px', color: 'var(--gold)' }}>
              Custo Adicional
            </div>
            <div style={{ fontSize: '13px', marginBottom: '8px' }}>
              <strong>{conditionalCostConfirm.card.name}</strong> custa{' '}
              <span style={{ color: '#f88', fontWeight: 700 }}>{conditionalCostConfirm.extraCost} a mais</span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              {conditionalCostConfirm.targetName} é um Dragão.
              <br />
              Custo total: {conditionalCostConfirm.card.cmc + conditionalCostConfirm.extraAmount} mana.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                className="btn btn-gold"
                onClick={() => {
                  actions.castSpell(conditionalCostConfirm.cardUid, conditionalCostConfirm.targets);
                  setConditionalCostConfirm(null);
                }}
              >Confirmar</button>
              <button
                className="btn btn-muted"
                onClick={() => setConditionalCostConfirm(null)}
              >Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Adventure / Omen modal ── */}
      {adventureModal && (() => {
        const card = adventureModal.card;
        const adv = card.back_face; // adventure/omen data lives in back_face for layout='adventure'
        const isOmen = adv?.type_line?.toLowerCase().includes('omen');
        const advLabel = isOmen ? 'Omen' : 'Adventure';
        return (
          <div
            className="overlay-backdrop"
            onClick={() => setAdventureModal(null)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}
          >
            <div
              className="glass"
              style={{ padding: '20px', borderRadius: '12px', minWidth: '320px', textAlign: 'center' }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '12px', color: 'var(--gold)' }}>
                {card.name}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Como deseja conjurar esta carta?
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                {/* Cast as creature */}
                <button
                  className="btn btn-muted"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setAdventureModal(null);
                    if (spellNeedsTargeting(card)) {
                      setTargeting({ cardUid: card._uid, card });
                    } else {
                      actions.castSpell(card._uid);
                    }
                  }}
                >
                  🐉 {card.name}<br/>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{card.mana_cost}</span>
                </button>
                {/* Cast as adventure/omen */}
                <button
                  className="btn btn-gold"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setAdventureModal(null);
                    // Use adventure face type_line so spellNeedsTargeting doesn't short-circuit
                    // on "creature" from the combined "Creature // Sorcery — Omen" type_line
                    const advFaceCard = { ...card, oracle_text: adv?.oracle_text ?? '', type_line: adv?.type_line ?? card.type_line };
                    if (spellNeedsTargeting(advFaceCard)) {
                      // Show targeting UI, pass castAdventure when target selected
                      setTargeting({ cardUid: card._uid, card: { ...card, oracle_text: adv?.oracle_text ?? '', type_line: adv?.type_line ?? card.type_line, _isAdventure: true } });
                    } else {
                      actions.castAdventure(card._uid);
                    }
                  }}
                >
                  ✨ {adv?.name}<br/>
                  <span style={{ fontSize: '11px' }}>{adv?.mana_cost} · {advLabel}</span>
                </button>
              </div>
              <button
                className="btn btn-muted"
                style={{ marginTop: '10px', width: '100%', fontSize: '11px' }}
                onClick={() => setAdventureModal(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Stack overlay (Tab key) ── */}
      {showStack && (
        <div className="overlay-backdrop" onClick={() => setShowStack(false)}>
          <div className="overlay-panel glass" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="overlay-header">
              <h3 className="overlay-title">📚 Stack ({snap.stackSize})</h3>
              <button className="btn btn-muted btn-sm" onClick={() => setShowStack(false)}>✕ (Tab)</button>
            </div>
            {snap.stackSize === 0 && <p className="overlay-hint">Stack is empty.</p>}
            <div className="modal-modes">
              {(gsRef.current?.stack?.items || []).slice().reverse().map((item: any, i: number) => (
                <div key={i} className="modal-mode-btn" style={{ cursor: 'default' }}>
                  <span className="modal-mode-num">{i + 1}</span>
                  <span className="modal-mode-desc">
                    {item.card?.name || item.spell?.name || item.type || 'Effect'}
                    {item.controller !== undefined ? ` (P${item.controller})` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Turn banner ── */}
      {turnBanner && (
        <div className={`turn-banner ${snap.activePlayer === 0 ? 'my-turn' : 'opp-turn'}`}>
          {turnBanner}
        </div>
      )}

      {/* ── Auto-pass indicator ── */}
      {autoPass && (
        <div className="auto-pass-indicator">
          ⏩ Auto-pass (F to stop)
        </div>
      )}

      {/* ── Full Control Mode indicator ── */}
      {fullControl && (
        <div className="auto-pass-indicator" style={{ bottom: 100, background: 'rgba(108,92,231,0.85)', color: 'white' }}>
          🎮 Full Control (Ctrl to disable)
        </div>
      )}

      {/* ── Combat arrows SVG ── */}
      {(snap.phase === 'combat_blockers' || snap.phase === 'combat_damage') && (
        <CombatArrows blockers={snap.combat.blockers} />
      )}

      {/* ── Exile overlay ── */}
      {exileOpen && (
        <ExileOverlay
          cards={snap.players[exileOpen.pid].exile || []}
          playerId={exileOpen.pid}
          onClose={() => setExileOpen(null)}
        />
      )}

      {/* ── Toast notifications ── */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
        ))}
      </div>

      {/* ── VFX sprite layer ── */}
      <VfxLayer />
    </div>
  );
}

// ── BattlefieldCard ───────────────────────────────────────────────────────────

interface BFCardProps {
  card: any;
  isAttacking: boolean;
  isAttacker: boolean;
  isTargetable?: boolean;
  isBlockingTarget?: boolean;
  isAssignedBlocker?: boolean;
  isSelectedBlocker?: boolean;
  canActivate?: boolean; // planeswalker: can use loyalty ability this turn
  overrideArtUrl?: string; // For land art override
  onClick?: (card: any) => void;
  onDoubleClick?: (card: any) => void;
  onRightClick: (card: any) => void;
}

function BattlefieldCard({ card, isAttacking, isAttacker, isTargetable, isBlockingTarget, isAssignedBlocker, isSelectedBlocker, canActivate, overrideArtUrl, onClick, onDoubleClick, onRightClick }: BFCardProps) {
  const isLand = card.type_line?.includes('Land');
  const isCreature = card.type_line?.includes('Creature');
  const isPlaneswalkerCard = card.type_line?.includes('Planeswalker');
  const counters = Object.entries(card._counters || {}).filter(([, v]) => (v as number) > 0);
  const mod = (card._counters?.['+1/+1'] ?? 0) - (card._counters?.['-1/-1'] ?? 0);
  const rawPow = parseInt(card.power);
  const basePow = isNaN(rawPow)
    ? (card._vividPower ? (card._vividPowerValue ?? 0) : (card._dynamicPower ?? null))
    : rawPow;
  const power = basePow != null ? basePow + (card._powerMod ?? 0) + mod : null;
  const toughness = card.toughness ? parseInt(card.toughness) + (card._toughnessMod ?? 0) + mod : null;

  return (
    <div
      data-uid={card._uid}
      className={`
        bf-card
        ${isLand ? 'bf-land' : 'bf-spell'}
        ${isPlaneswalkerCard ? 'bf-planeswalker' : ''}
        ${canActivate ? 'can-activate' : ''}
        ${card._tapped ? 'tapped' : ''}
        ${isAttacking ? 'attacking' : ''}
        ${card._summoningSick ? 'sick' : ''}
        ${isTargetable ? 'targetable' : ''}
        ${isBlockingTarget ? 'blocking-target' : ''}
        ${isAssignedBlocker ? 'assigned-blocker' : ''}
        ${isSelectedBlocker ? 'targetable' : ''}
      `}
      onClick={() => onClick?.(card)}
      onDoubleClick={() => onDoubleClick?.(card)}
      onContextMenu={e => { e.preventDefault(); onRightClick(card); }}
    >
      <img src={overrideArtUrl || card.image_normal || card.image_small || undefined} alt={card.name} loading="lazy" />
      {isCreature && power !== null && (
        <div className="bf-pt">{power}/{toughness}</div>
      )}
      {card._damage > 0 && <div className="bf-damage">💥{card._damage}</div>}
      {counters.map(([type, n]) => (
        <div key={type} className={`bf-counter ${type.includes('+') ? 'positive' : 'negative'}`}>
          {n as number}
        </div>
      ))}
      {isAttacking && <div className="bf-attacking-indicator">⚔</div>}

      {/* ── Keyword badges ── */}
      {isCreature && (() => {
        const kws = card.keywords || [];
        const text = (card.oracle_text || '').toLowerCase();
        const badges: string[] = [];
        if (kws.includes('Flying') || text.includes('flying')) badges.push('✈');
        if (kws.includes('First Strike') || text.includes('first strike')) badges.push('FS');
        if (kws.includes('Double Strike') || text.includes('double strike')) badges.push('DS');
        if (kws.includes('Deathtouch') || text.includes('deathtouch')) badges.push('☠');
        if (kws.includes('Lifelink') || text.includes('lifelink')) badges.push('♥');
        if (kws.includes('Trample') || text.includes('trample')) badges.push('Tpl');
        if (kws.includes('Haste') || text.includes('haste')) badges.push('H');
        if (kws.includes('Reach') || text.includes('reach')) badges.push('Rch');
        if (kws.includes('Hexproof') || text.includes('hexproof')) badges.push('Hex');
        if (kws.includes('Indestructible') || text.includes('indestructible')) badges.push('Ind');
        if (kws.includes('Menace') || text.includes('menace')) badges.push('Men');
        if (kws.includes('Vigilance') || text.includes('vigilance')) badges.push('Vig');
        if (kws.includes('Flash') || text.includes('flash')) badges.push('⚡');
        if (badges.length === 0) return null;
        return (
          <div className="bf-keyword-badges">
            {badges.map(b => <span key={b} className="kw-badge">{b}</span>)}
          </div>
        );
      })()}
      {/* ── Saga badge ── */}
      {card._isSaga && (
        <div className="bf-saga-badge">
          CH {card._sagaChapter || 1}/{card._sagaMaxChapter || '?'}
        </div>
      )}
      {/* ── Stun badge ── */}
      {(card._stunCounters || 0) > 0 && (
        <div className="bf-stun-badge">STUN</div>
      )}
      {/* ── Transform badge ── */}
      {card._canTransform && (
        <div className="bf-transform-badge">↔</div>
      )}
      {/* ── Planeswalker loyalty badge ── */}
      {isPlaneswalkerCard && card._loyalty !== undefined && (
        <div className="bf-loyalty-badge">{card._loyalty}</div>
      )}
    </div>
  );
}
