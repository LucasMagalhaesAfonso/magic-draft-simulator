// GameScreen.tsx — Game UI connected to the real engine via useGameEngine hook

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import ringBearerImg from '../assets/ring-bearer.png';
import cardBackImg from '../assets/mtg-card-back.jpg';
import { SoundManager } from '../engine/sound-manager';
import { useAppStore } from '../store/useAppStore';
import type { Card } from '../lib/types';
import { CardImage } from './card/CardImage';
import { useGameEngine } from '../hooks/useGameEngine';
import type { TriggerToastItem } from '../hooks/useGameEngine';
import { useMultiplayerHost, useMultiplayerGuest } from '../hooks/useGameEngineMultiplayer';
import { ChatSidebar } from './online/ChatSidebar';
import { buildDeck as botBuildDeck } from '../draft/bot-ai';
import {
  ScryOverlay, ModalOverlay, TargetingPrompt, GraveyardOverlay,
  InstantPriorityBanner, StackPriorityBanner, BlockerConfirmBanner,
  DiscardOverlay, ManaColorOverlay, SearchLibraryOverlay, CreatureChoiceOverlay,
  LookTopOverlay, RevealPickOverlay, ClashOverlay, ConfirmOptionalOverlay, UnlessPayOverlay, TriggerOrderOverlay,
  MillLandChoiceOverlay, EndureChoiceOverlay, TriggerCostOverlay,
  AbilityModal, ExileOverlay, CombatArrows, GraveyardMultiSelectOverlay,
  BounceMultiOverlay, CrewOverlay, DistributeCountersOverlay, ManaCostPips, ManaText, MANA_IMAGES,
  KeyboardHelpOverlay, DistributeDamageOverlay, OrderBlockersOverlay,
  UginUltimateOverlay,
} from './game/GameOverlays';
import { VfxLayer, VfxManager } from './game/VfxLayer';
import { SettingsScreen } from './SettingsScreen';
import { getLandManaColors, canPay } from '../engine/mana';
import { getPreprocessedEffects, parseCyclingAbility } from '../engine/cards';
import type { ManaPool } from '../engine/engine-types';
import { getTokenImageUrl, preloadTokenImage } from '../engine/token-images';
import './GameScreen.css';

// ── Token icons ──────────────────────────────────────────────────────────────
const TOKEN_ICONS: Record<string, string> = {
  Dragon:'🐉', Spirit:'👻', Warrior:'⚔️', Treasure:'💎', Soldier:'🛡',
  Goblin:'👹', Zombie:'🧟', Monk:'🥋', Bird:'🦅', Elephant:'🐘',
  Wolf:'🐺', Faerie:'🧚', Snake:'🐍',
};

// ── Color-aware gradient for token placeholders ─────────────────────────────
const TOKEN_GRADIENTS: Record<string, string> = {
  W: 'linear-gradient(160deg, #8a9aaa, #c8d8e8, #6a7a8a)',  // white/silver
  U: 'linear-gradient(160deg, #1a3a6a, #2a5aaa, #0a2050)',  // blue
  B: 'linear-gradient(160deg, #1a0a2a, #3a1a5a, #0a0a1a)',  // black/purple
  R: 'linear-gradient(160deg, #6a1a0a, #c03020, #3a0a00)',  // red
  G: 'linear-gradient(160deg, #0a3a1a, #2a6a2a, #003010)',  // green
  GOLD: 'linear-gradient(160deg, #5a4a0a, #c8a020, #3a2a00)', // multicolor
  C: 'linear-gradient(160deg, #3a3a3a, #5a5a5a, #1a1a1a)',  // colorless
};
function getTokenBg(colors: string[] | undefined): string {
  if (!colors || colors.length === 0) return TOKEN_GRADIENTS.C;
  if (colors.length > 1) return TOKEN_GRADIENTS.GOLD;
  return TOKEN_GRADIENTS[colors[0]] || TOKEN_GRADIENTS.C;
}

/** Converts a raw mana string like "1G", "WU", "XB", "2" into "{1}{G}", "{W}{U}", "{X}{B}", "{2}" */
function formatRawMana(raw: string): string {
  if (!raw) return '';
  if (raw.includes('{')) return raw; // already brace-formatted
  let result = '';
  let i = 0;
  while (i < raw.length) {
    let digits = '';
    while (i < raw.length && /\d/.test(raw[i])) digits += raw[i++];
    if (digits) result += `{${digits}}`;
    if (i < raw.length && /[A-Za-z]/i.test(raw[i])) result += `{${raw[i++].toUpperCase()}}`;
  }
  return result || `{${raw}}`;
}

// ── Battlefield token renderer (fetches real image from Scryfall) ─────────────
function BfToken({ card, power, toughness }: { card: any; power: number | null; toughness: number | null }) {
  const tokenSet = card.set_code || card._set || card.set || 'TDM';
  const [imgUrl, setImgUrl] = useState<string | null>(() => {
    const cached = getTokenImageUrl(card.name, tokenSet);
    if (cached) card.image_normal = cached; // sync cache hit: write immediately
    return cached;
  });
  useEffect(() => {
    if (imgUrl) return;
    preloadTokenImage(card.name, card.colors || [], tokenSet).then(url => {
      if (url) {
        setImgUrl(url);
        card.image_normal = url; // Write back so right-click zoom finds the image
      }
    });
  }, [card.name, imgUrl]);

  if (imgUrl) {
    // Scryfall image already includes P/T printed on the card — no badge needed
    return <img src={imgUrl} alt={card.name} loading="lazy" className="token-scryfall-img" />;
  }
  return (
    <div className="bf-token-placeholder" style={{ background: getTokenBg(card.colors) }}>
      <span className="bf-token-icon">
        {TOKEN_ICONS[card.name] || TOKEN_ICONS[(card.name || '').split(' ')[0]] || '★'}
      </span>
      <span className="bf-token-name">{card.name}</span>
    </div>
  );
}

// ── Phase strip config ─────────────────────────────────────────────────────────

const PHASES = [
  { key: 'mulligan',           label: 'Mulligan',  tip: 'Choose to keep or mulligan your hand' },
  { key: 'untap',              label: 'Untap',     tip: 'Untap all your permanents' },
  { key: 'upkeep',             label: 'Upkeep',    tip: 'Upkeep triggers resolve here' },
  { key: 'draw',               label: 'Draw',      tip: 'Draw a card for the turn' },
  { key: 'main1',              label: 'Main 1',    tip: 'Play lands, cast creatures & sorceries' },
  { key: 'combat_begin',       label: 'Combat',    tip: 'Beginning of combat — last chance for instants' },
  { key: 'combat_attackers',   label: 'Attack',    tip: 'Declare attackers — click creatures to attack' },
  { key: 'combat_blockers',    label: 'Block',     tip: 'Declare blockers — click your creature then the attacker' },
  { key: 'combat_damage',      label: 'Damage',    tip: 'Combat damage is dealt' },
  { key: 'combat_end',         label: 'C.End',     tip: 'End of combat — damage dealt, creatures survive or die' },
  { key: 'main2',              label: 'Main 2',    tip: 'Second main phase — play lands & cast spells' },
  { key: 'end',                label: 'End',       tip: 'End step — last chance to cast instants' },
  { key: 'cleanup',            label: 'Cleanup',   tip: 'Discard to hand size, remove damage' },
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

interface GameScreenProps {
  multiplayerMode?: boolean;
}


// Returns CSS filter string to colorize sprites by MTG color identity.
// Technique: saturate(0) → sepia(1) gives a warm ~35° base, then hue-rotate shifts to target color.
// Target hue → rotation needed: R=0° → 325deg, Y/Gold=50° → 15deg, G=120° → 85deg,
//              U=240° → 205deg, V/Purple=280° → 245deg
function _colorHue(colors: string[]): string {
  const sat = 'saturate(0) sepia(1)';
  const r = colors.includes('R'), g = colors.includes('G'),
        w = colors.includes('W'), u = colors.includes('U'), b = colors.includes('B');
  if (colors.length === 0)  return `${sat} saturate(0.3) brightness(1.3)`;           // colorless → silver
  if (colors.length >= 3)   return `${sat} hue-rotate(15deg) saturate(3) brightness(1.3)`;  // gold
  if (r && b)               return `${sat} hue-rotate(245deg) saturate(3) brightness(1.0)`; // purple
  if (r && g)               return `${sat} hue-rotate(50deg) saturate(3) brightness(1.1)`;  // Gruul green-red
  if (r)                    return `${sat} hue-rotate(325deg) saturate(3) brightness(1.1)`; // red
  if (g)                    return `${sat} hue-rotate(85deg) saturate(3) brightness(1.1)`;  // green
  if (w)                    return `${sat} hue-rotate(15deg) saturate(2) brightness(1.4)`;  // white → gold
  if (b)                    return `${sat} hue-rotate(245deg) saturate(2) brightness(0.8)`; // black → dark purple
  if (u)                    return `${sat} hue-rotate(205deg) saturate(3) brightness(1.1)`; // blue
  return `${sat} hue-rotate(205deg) saturate(2)`;
}

export function GameScreen({ multiplayerMode = false }: GameScreenProps) {
  const { deck, draftPool, aiDraftPool, setScreen, playmat, playmatArt, playmatPosition, playmatSize, landArts, sleeveArt,
    currentUser, mpRole, mpOpponentName, mpConnected, onlineDeck } = useAppStore();

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
  const [, forceUpdate] = useState(0);
  const [zoomModified, setZoomModified] = useState(false);
  const [myStopPhases, setMyStopPhases] = useState<Set<string>>(new Set());
  const [oppStopPhases, setOppStopPhases] = useState<Set<string>>(new Set());
  const [overlayMinimized, setOverlayMinimized] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Reset modified view when zoom target changes
  useEffect(() => setZoomModified(false), [zoom]);

  // ── Overlay states ────────────────────────────────────────────────────────
  const [graveyardOpen, setGraveyardOpen] = useState<{ pid: number } | null>(null);
  const [graveyardLandsOpen, setGraveyardLandsOpen] = useState(false);
  const [exileOpen, setExileOpen] = useState<{ pid: number } | null>(null);
  const [libraryOrderUids, setLibraryOrderUids] = useState<string[]>([]);
  // Targeting: pending spell waiting for player to click a target
  // Multi-step targeting: step/steps/collectedTargets for spells that need multiple sequential targets
  const [targeting, setTargeting] = useState<{
    cardUid: string;
    card: any;
    step?: number;
    steps?: Array<{ side: 'own' | 'opponent' | 'any_permanent' | 'any_target'; prompt: string }>;
    collectedTargets?: any[];
    optionalTarget?: boolean;  // True when targeting is optional — shows "No target" button
    isHarmonize?: boolean;     // True when targeting is for harmonize (calls castHarmonize instead of castSpell)
    harmonizeTappedUid?: string | null; // The tapped creature UID for harmonize discount
  } | null>(null);
  // Blocking: selected own creatures waiting to be assigned to an attacker (array = gang-block)
  const [blockingWith, setBlockingWith] = useState<string[]>([]);
  // Ability modal: double-click on creature/planeswalker
  const [abilityModal, setAbilityModal] = useState<{ card: any; abilities: any[]; isGranted?: boolean } | null>(null);
  // Equipment modal: double-click on equipment to pick which creature to attach
  const [equipModal, setEquipModal] = useState<{ equipUid: string; equipName: string; equipCost?: string } | null>(null);
  // Attack target picker: when declaring an attacker and opponent has planeswalkers
  // isToken: true when picking target for an already-attacking token (mobilize etc.)
  const [attackTargetPicker, setAttackTargetPicker] = useState<{ attackerUid: string; isToken?: boolean; tokenName?: string } | null>(null);
  // Adventure modal: choose between casting as creature or adventure/omen
  const [adventureModal, setAdventureModal] = useState<{ card: any } | null>(null);
  const [cycleOrCastModal, setCycleOrCastModal] = useState<{ card: any; cyclingAbility: any } | null>(null);
  // Conditional cost confirmation (e.g. Dragon's Prey costs {2} more when targeting a Dragon)
  const [conditionalCostConfirm, setConditionalCostConfirm] = useState<{
    cardUid: string; card: any; targets: any[]; extraCost: string; extraAmount: number; targetName: string;
  } | null>(null);
  // London mulligan: phase 2 - selecting cards to put on bottom
  const [showingBottomSelect, setShowingBottomSelect] = useState(false);
  const [mulliganBottomSelected, setMulliganBottomSelected] = useState<string[]>([]);
  // Mana autopay preview: which lands will be auto-tapped when this hand card is hovered
  const [hoveredHandCard, setHoveredHandCard] = useState<string | null>(null);
  const [hoveredBfCard, setHoveredBfCard] = useState<string | null>(null);

  // Toast / banner / auto-pass states
  const [toasts, setToasts] = useState<{id: number; msg: string; type: string}[]>([]);
  const toastIdRef = useRef(0);
  const [showStack, setShowStack] = useState(false);
  const [turnBanner, setTurnBanner] = useState<string | null>(null);
  const [autoPass, setAutoPass] = useState(false);
  const autoPassRef = useRef(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [viewingBattlefield, setViewingBattlefield] = useState(false);
  const [showOppTooltip, setShowOppTooltip] = useState(false);
  const [sparedCreatureUids, setSparedCreatureUids] = useState<string[]>([]);
  // Harmonize: waiting for player to pick a creature to tap for discount (null = not active)
  // tappedUid: the creature the player chose to tap (set after phase 1, used in phase 2 targeting)
  const [harmonizePending, setHarmonizePending] = useState<{ cardUid: string; tappedUid?: string | null } | null>(null);
  // Full Control Mode: pause at every phase transition (like Arena Ctrl)
  const [fullControl, setFullControl] = useState(false);
  const fullControlRef = useRef(false);
  const prevLifeRef = useRef<[number, number] | null>(null);
  const prevActivePlayerRef = useRef<number | null>(null);
  // Delayed winner: wait for life-counter animation before showing game-over screen
  const [displayWinner, setDisplayWinner] = useState<number | null>(null);
  const winnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Arena-like animation states ──────────────────────────────────────────
  // Battlefield enter/exit
  const [recentlyEntered, setRecentlyEntered] = useState<Set<string>>(new Set());
  const [ghosts, setGhosts] = useState<Array<{id: number; imgSrc: string; x: number; y: number; w: number; h: number; fadeDelay: number}>>([]);
  const ghostIdRef = useRef(0);
  // Captures card positions BEFORE React removes them from the DOM (useLayoutEffect fires before paint)
  const cardPosSnapRef = useRef<Map<string, { x: number; y: number; w: number; h: number; imgSrc: string }>>(new Map());
  // Floating damage/life numbers
  const [floats, setFloats] = useState<Array<{id: number; value: string; x: number; y: number; type: string}>>([]);
  const floatIdRef = useRef(0);
  // Spell cast center zoom
  const [castingCard, setCastingCard] = useState<any>(null);
  // Hand draw tracking
  const prevHandUidsRef = useRef<Set<string>>(new Set());
  const [newHandUids, setNewHandUids] = useState<Set<string>>(new Set());
  // Trigger pulse
  const [triggerPulseUids, setTriggerPulseUids] = useState<Set<string>>(new Set());
  const prevLogLenRef = useRef(0);
  // Trigger stack panel (Arena-style persistent)
  const [triggerPanelItems, setTriggerPanelItems] = useState<import('../hooks/useGameEngine').TriggerToastItem[]>([]);
  const lastSeenTriggerIdRef = useRef(0);
  // AI action overlay (opponent spell cast display)
  const [aiCastOverlay, setAiCastOverlay] = useState<{ card: any; description: string; targetDesc?: string } | null>(null);
  const aiCastQueueRef = useRef<Array<{ card: any; description: string; targetDesc?: string }>>([]);
  const aiCastBusyRef = useRef(false);
  const lastAiActionsLenRef = useRef(0);
  const [slowTriggers, setSlowTriggers] = useState(true); // Show trigger notifications
  const [showQuickSettings, setShowQuickSettings] = useState(false);
  const [showFullSettings, setShowFullSettings] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(SoundManager.enabled);
  const [soundVolume, setSoundVolume] = useState(Math.round(SoundManager.volume * 100));
  // Combat edge flash
  const [combatFlash, setCombatFlash] = useState(false);
  const prevPhaseRef = useRef<string | null>(null);
  // Target arrow
  const targetArrowRef = useRef<SVGLineElement>(null);
  // Floating mana pip animations (on land tap)
  const [floatingManas, setFloatingManas] = useState<{ id: string; color: string; x: number; y: number }[]>([]);
  const [multiTapSelected, setMultiTapSelected] = useState<string[]>([]);

  // Build decks for the engine (memoized — only recompute when deck/pool changes)
  const playerDeck = useMemo(() => {
    const spells = deck?.mainboard ?? draftPool.slice(0, 23);
    const lands  = deck?.lands    ?? { W: 9, U: 8, B: 0, R: 0, G: 0 };
    return buildFullDeck(spells, lands);
  }, [deck, draftPool]);

  const aiDeck = useMemo(() => {
    // Use the bot's actual draft picks (aiDraftPool) — not the human's pool (prevents mirror match)
    const aiPool = aiDraftPool.filter(c => !c.type_line?.includes('Land'));
    if (aiPool.length >= 10) {
      const aiDeckData = botBuildDeck(aiPool);
      return buildFullDeck(aiDeckData.deck, aiDeckData.lands);
    }
    // Fallback: use cards from draftPool that are NOT in the player's mainboard (sideboard effect)
    const playerMainboard = deck?.mainboard ?? draftPool.slice(0, 23);
    const mainboardIds = new Set(playerMainboard.map((c: any) => c.id || c.oracle_id));
    const sideboardPool = draftPool.filter(c => !mainboardIds.has(c.id || c.oracle_id) && !c.type_line?.includes('Land'));
    const fallbackPool = sideboardPool.length >= 10 ? sideboardPool : draftPool.filter(c => !c.type_line?.includes('Land'));
    const aiDeckData = fallbackPool.length >= 10
      ? botBuildDeck(fallbackPool)
      : { deck: playerMainboard.slice(0, 23), lands: { W: 9, U: 8 } as Record<string, number>, sideboard: [] as any[] };
    return buildFullDeck(aiDeckData.deck, aiDeckData.lands);
  }, [deck, draftPool, aiDraftPool]);

  // ── Guest mode: receive snap from host via WebSocket ─────────────────────
  const isGuest = multiplayerMode && mpRole === 'guest';
  const isHost  = multiplayerMode && mpRole === 'host';
  const { snap: guestSnap, actions: guestActions } = useMultiplayerGuest(isGuest);

  // ── Local engine (single-player or host mode) ─────────────────────────────
  const { snap: localSnap, loading, error, actions: localActions, gsRef, canUndoMana, undoManaCount } = useGameEngine(
    isGuest ? [] : playerDeck,
    isGuest ? [] : (multiplayerMode ? [] : aiDeck),
  );

  // Host: broadcast state to guest after every action
  useMultiplayerHost(localActions, localSnap, gsRef, isHost);

  // Resolve which snap/actions to use
  const snap = isGuest ? guestSnap : localSnap;
  const actions = isGuest ? guestActions! : localActions;

  // ── Chat sidebar state ────────────────────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [snap?.log]);

  // Sync stop-at-phases to engine state
  useEffect(() => {
    actions.setStopAtPhases(Array.from(oppStopPhases));
  }, [oppStopPhases]);

  useEffect(() => {
    actions.setMyStopPhases(Array.from(myStopPhases));
  }, [myStopPhases]);

  function toggleMyStopPhase(phaseKey: string) {
    setMyStopPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseKey)) next.delete(phaseKey);
      else next.add(phaseKey);
      return next;
    });
  }

  function toggleOppStopPhase(phaseKey: string) {
    setOppStopPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseKey)) next.delete(phaseKey);
      else next.add(phaseKey);
      return next;
    });
  }

  function addToast(msg: string, type: string = 'info') {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev.slice(-4), { id, msg, type }]); // max 5 toasts
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2500);
  }
  // Expose toast globally so useGameEngine can show restricted mana warnings
  (window as any).__gameToast = addToast;

  function addFloat(value: string, x: number, y: number, type: string) {
    const id = ++floatIdRef.current;
    setFloats(prev => [...prev.slice(-8), { id, value, x, y, type }]);
    setTimeout(() => setFloats(prev => prev.filter(f => f.id !== id)), 800);
  }

  function showCastAnimation(card: any) {
    if (!card?.image_normal && !card?.image_small) return;
    setCastingCard(card);
    SoundManager.play('spell_cast');
    setTimeout(() => setCastingCard(null), 900);
  }

  // Life change toasts + flash + floating numbers
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
      // Floating numbers near life totals
      if (d0 !== 0) {
        const el = document.querySelector('[data-player-id="p0"]');
        if (el) {
          const rect = el.getBoundingClientRect();
          addFloat(d0 > 0 ? `+${d0}` : `${d0}`, rect.left + rect.width / 2, rect.top, d0 > 0 ? 'heal' : 'damage');
        }
      }
      if (d1 !== 0) {
        const el = document.querySelector('[data-player-id="p1"]');
        if (el) {
          const rect = el.getBoundingClientRect();
          addFloat(d1 > 0 ? `+${d1}` : `${d1}`, rect.left + rect.width / 2, rect.top, d1 > 0 ? 'heal' : 'damage');
        }
      }
    }
    prevLifeRef.current = [p0life, p1life];
  }, [snap?.players[0].life, snap?.players[1].life]); // eslint-disable-line

  // Counter spell feedback toast
  const prevCounterRef = useRef<string | null>(null);
  useEffect(() => {
    const countered = (snap as any)?._lastCounteredSpell;
    if (countered && countered !== prevCounterRef.current) {
      prevCounterRef.current = countered;
      addToast(`✨ Countered: ${countered}`, 'cast');
    }
  }, [(snap as any)?._lastCounteredSpell]); // eslint-disable-line

  // Behold reveal toast
  const prevBeholdRef = useRef<string | null>(null);
  useEffect(() => {
    const reveal = (snap as any)?._lastBeholdReveal;
    if (reveal && reveal !== prevBeholdRef.current) {
      prevBeholdRef.current = reveal;
      addToast(`🐉 Revealed: ${reveal} (stays in hand)`, 'cast');
    }
  }, [(snap as any)?._lastBeholdReveal]); // eslint-disable-line

  // Hand size warning (8+ cards → reminder to discard at cleanup)
  const prevHandSizeRef = useRef<number>(0);
  useEffect(() => {
    if (!snap) return;
    const handSize = snap.players[0].hand.length;
    const phase = snap.phase;
    const activePlayer = snap.activePlayer;
    // Sound: card draw
    if (handSize > prevHandSizeRef.current) SoundManager.play('card_draw');
    // Warn when hand reaches 8 during player's own turn (before cleanup)
    if (handSize >= 8 && handSize > prevHandSizeRef.current && activePlayer === 0 && phase !== 'cleanup') {
      addToast(`⚠ Hand full (${handSize}) — discard during cleanup!`, 'damage');
    }
    prevHandSizeRef.current = handSize;
  }, [snap?.players[0].hand.length]); // eslint-disable-line

  // Turn banner
  useEffect(() => {
    if (!snap || snap.phase === 'mulligan') return;
    const prev = prevActivePlayerRef.current;
    if (prev !== null && prev !== snap.activePlayer) {
      setTurnBanner(snap.activePlayer === 0 ? 'Your Turn' : "Opponent's Turn");
      setTimeout(() => setTurnBanner(null), 1800);
    }
    prevActivePlayerRef.current = snap.activePlayer;
  }, [snap?.turn, snap?.activePlayer]); // eslint-disable-line

  // Keep refs in sync
  useEffect(() => { autoPassRef.current = autoPass; }, [autoPass]);
  useEffect(() => {
    fullControlRef.current = fullControl;
    if (gsRef.current) gsRef.current._fullControl = fullControl;
  }, [fullControl]);

  // Reset "view battlefield" mode when overlay changes or is dismissed
  const wiType = snap?.waitingForInput?.type;
  useEffect(() => { setViewingBattlefield(false); }, [wiType]);

  // Init sound on first render (unlocks audio context after user interaction)
  useEffect(() => {
    const unlock = () => { SoundManager.init(); };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Delayed winner: wait after life hits 0 so player sees the lethal damage land
  const snapWinner = snap?.winner ?? null;
  useEffect(() => {
    if (snapWinner !== null && displayWinner === null) {
      if (winnerTimerRef.current) clearTimeout(winnerTimerRef.current);
      winnerTimerRef.current = setTimeout(() => {
        setDisplayWinner(snapWinner);
        SoundManager.play(snapWinner === 0 ? 'game_win' : 'game_lose');
      }, 1800);
    } else if (snapWinner === null && displayWinner !== null) {
      if (winnerTimerRef.current) clearTimeout(winnerTimerRef.current);
      winnerTimerRef.current = null;
      setDisplayWinner(null);
    }
    return () => { if (winnerTimerRef.current) clearTimeout(winnerTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapWinner]);

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
      if (d1 < 0) VfxManager.play('playerDamage', 'p1');
    }
    prevLifeVfxRef.current = [p0life, p1life];
  }, [snap?.players[0].life, snap?.players[1].life]); // eslint-disable-line

  // AI action overlay: detect new _aiActions and queue them for sequential display
  useEffect(() => {
    if (!snap?._aiActions) return;
    const all = snap._aiActions as any[];
    const startIdx = all.length < lastAiActionsLenRef.current ? 0 : lastAiActionsLenRef.current;
    lastAiActionsLenRef.current = all.length;
    const newCasts = all.slice(startIdx).filter((a: any) => a.type === 'cast' && (a.card?.image_normal || a.card?.image_small));
    if (newCasts.length === 0) return;
    aiCastQueueRef.current.push(...newCasts);
    // Kick off processing if not already running
    if (!aiCastBusyRef.current) processAiCastQueue();
  }, [(snap?._aiActions as any)?.length]); // eslint-disable-line

  function processAiCastQueue() {
    const next = aiCastQueueRef.current.shift();
    if (!next) { aiCastBusyRef.current = false; return; }
    aiCastBusyRef.current = true;
    setAiCastOverlay(next);
    setTimeout(() => {
      setAiCastOverlay(null);
      setTimeout(processAiCastQueue, 100);
    }, 1800);
  }

  // Capture all [data-uid] card positions BEFORE React updates the DOM
  // This runs synchronously after DOM mutation but before paint — so removed cards are still queryable
  useLayoutEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-uid]');
    els.forEach(el => {
      const uid = el.dataset.uid;
      if (!uid) return;
      const rect = el.getBoundingClientRect();
      const img = el.querySelector('img') as HTMLImageElement | null;
      cardPosSnapRef.current.set(uid, {
        x: rect.left, y: rect.top, w: rect.width, h: rect.height,
        imgSrc: img?.src || '',
      });
    });
  });

  // VFX: creature enters/leaves battlefield + Arena-like enter/exit animations
  const prevBfUidsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!snap) return;
    const allBfNow = [
      ...snap.players[0].battlefield.map((c: any) => c._uid),
      ...snap.players[1].battlefield.map((c: any) => c._uid),
    ];
    const nowSet = new Set<string>(allBfNow);
    const prev = prevBfUidsRef.current;

    // Entering battlefield — VFX
    const allBfCards = [...snap.players[0].battlefield, ...snap.players[1].battlefield];
    const newEntries = new Set<string>();
    for (const uid of nowSet) {
      if (!prev.has(uid)) {
        newEntries.add(uid);
        const card = allBfCards.find((c: any) => c._uid === uid);
        const typeLine = (card?.type_line || '').toLowerCase();
        const isLand = typeLine.includes('land');
        if (isLand) {
          setTimeout(() => VfxManager.play('landEtb', uid), 80);
        } else {
          const colors: string[] = card?.colors || card?.color_identity || [];
          const hueFilter = _colorHue(colors);
          setTimeout(() => VfxManager.play('creatureEtb', uid, undefined, undefined, hueFilter), 80);
        }
      }
    }
    // card-entering animation removed — WebView2 white GPU layer flash

    // Leaving battlefield — ghost fade-out
    // Positions captured from cache (set synchronously during combat bridge, before DOM update)
    const newGhosts: typeof ghosts = [];
    for (const uid of prev) {
      if (!nowSet.has(uid)) {
        // Priority: combat cache → pre-render layout snapshot → live DOM (fallback)
        const cached   = VfxManager.getCachedCardPos(uid);
        const snapped  = cardPosSnapRef.current.get(uid);
        const el       = (!cached && !snapped) ? document.querySelector(`[data-uid="${uid}"]`) : null;
        const pos      = cached ?? snapped ?? (el ? (() => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })() : null);
        const imgSrc   = cached?.imgSrc ?? snapped?.imgSrc ?? (el as HTMLElement | null)?.querySelector('img')?.getAttribute('src') ?? '';
        if (pos && imgSrc) {
          const remaining = VfxManager.combatAnimRemainingMs();
          const fadeDelay = remaining > 0 ? Math.max(0, remaining - 200) : 0;
          newGhosts.push({
            id: ++ghostIdRef.current,
            imgSrc,
            x: pos.x, y: pos.y,
            w: pos.w, h: pos.h,
            fadeDelay,
          });
        }
      }
    }
    if (newGhosts.length > 0) {
      setGhosts(g => [...g, ...newGhosts].slice(-10));
      const ids = newGhosts.map(g => g.id);
      // Fire death VFX at each ghost's position (after combat animation delay)
      for (const g of newGhosts) {
        const cx = g.x + g.w / 2;
        const cy = g.y + g.h / 2;
        setTimeout(() => VfxManager.play('death', undefined, cx, cy), g.fadeDelay);
      }
      // Remove ghost after death animation completes (death_3 finishes at 280+480=760ms) + fade
      const DEATH_ANIM_MS = 800; // death_2 grows 600ms, death_3 finishes at 760ms
      const maxFadeDelay = Math.max(...newGhosts.map(g => g.fadeDelay), 0);
      const ghostDuration = maxFadeDelay + DEATH_ANIM_MS;
      setTimeout(() => setGhosts(g => g.filter(ghost => !ids.includes(ghost.id))), ghostDuration);
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
    if (wi && wi.type !== 'main_phase' && wi.type !== 'instant_priority' && wi.type !== 'trigger_priority') {
      setAutoPass(false);
      return;
    }
    // Auto advance after short delay
    const timer = setTimeout(() => {
      if (autoPassRef.current) actions.nextPhase();
    }, 120);
    return () => clearTimeout(timer);
  }, [snap?.phase, snap?.waitingForInput?.type, autoPass]); // eslint-disable-line

  // ── Arena animations: hand draw detection ──────────────────────────────
  useEffect(() => {
    if (!snap) return;
    const currentUids = new Set<string>(snap.players[0].hand.map((c: any) => c._uid as string));
    const prev = prevHandUidsRef.current;
    if (prev.size > 0) {
      const justDrawn = new Set<string>();
      for (const uid of currentUids) {
        if (!prev.has(uid)) justDrawn.add(uid);
      }
      if (justDrawn.size > 0) {
        setNewHandUids(justDrawn);
        setTimeout(() => setNewHandUids(new Set()), 500);
      }
    }
    prevHandUidsRef.current = currentUids;
  }, [snap?.players[0]?.hand?.length]); // eslint-disable-line

  // ── Arena animations: trigger pulse detection (from log) ───────────────
  useEffect(() => {
    if (!snap) return;
    const newLen = snap.log.length;
    const prev = prevLogLenRef.current;
    prevLogLenRef.current = newLen;
    if (newLen <= prev) return;
    const newEntries = snap.log.slice(prev);
    const allBf = [...snap.players[0].battlefield, ...snap.players[1].battlefield];
    const pulseUids = new Set<string>();
    for (const entry of newEntries) {
      if (entry.includes('trigger') || entry.includes('Trigger') || entry.includes('fires')) {
        for (const card of allBf) {
          if (entry.includes(card.name)) {
            pulseUids.add(card._uid);
          }
        }
      }
    }
    if (pulseUids.size > 0) {
      setTriggerPulseUids(pulseUids);
      setTimeout(() => setTriggerPulseUids(new Set()), 600);
    }
  }, [snap?.log?.length]); // eslint-disable-line

  // ── Trigger stack panel (Arena-style) ────────────────────────────────────
  useEffect(() => {
    if (!snap || !slowTriggers) return;
    const queue = snap.triggerToastQueue || [];
    if (!queue.length) return;
    const lastId = lastSeenTriggerIdRef.current;
    const newToasts = queue.filter((t: any) => t.id > lastId);
    if (!newToasts.length) return;
    lastSeenTriggerIdRef.current = newToasts[newToasts.length - 1].id;
    // Add new items to the panel (keep up to 8 visible)
    setTriggerPanelItems(prev => [...prev, ...newToasts].slice(-8));
  }, [snap?.triggerToastQueue?.length, slowTriggers]); // eslint-disable-line

  // Sync: remove panel items that are no longer in engine's toast queue (resolved)
  useEffect(() => {
    if (!snap) return;
    const engineIds = new Set((snap.triggerToastQueue || []).map((t: any) => t.id));
    setTriggerPanelItems(prev => {
      const filtered = prev.filter(t => engineIds.has(t.id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [snap?.triggerToastQueue]); // eslint-disable-line

  // Async preload images for token trigger toasts that lack an image URL
  useEffect(() => {
    const tokenToasts = triggerPanelItems.filter(t => t.isToken && !t.imageUrl && !t.imageUrlLarge);
    if (!tokenToasts.length) return;
    let cancelled = false;
    Promise.all(tokenToasts.map(t =>
      preloadTokenImage(t.cardName, t.tokenColors || []).then(url => ({ id: t.id, url }))
    )).then(results => {
      if (cancelled) return;
      setTriggerPanelItems(prev => prev.map(item => {
        const r = results.find(r => r.id === item.id && r.url);
        return r ? { ...item, imageUrl: r.url, imageUrlLarge: r.url } : item;
      }));
    });
    return () => { cancelled = true; };
  }, [triggerPanelItems.map(t => t.id).join(',')]); // eslint-disable-line

  // Detect active trigger (waitingForInput caused by a trigger)
  const activeTriggerWfiTypes = ['confirm_optional', 'trigger_cost', 'scry', 'surveil', 'graveyard_cast_choice', 'graveyard_card_choice', 'graveyard_choice', 'modal_choice', 'post_modal_target', 'buff_choice', 'distribute_counters', 'trigger_priority'];
  const hasActiveTrigger = snap?.waitingForInput && activeTriggerWfiTypes.includes(snap.waitingForInput.type);
  // Keep the most recent item alive while waiting for input
  useEffect(() => {
    if (!hasActiveTrigger) return;
    // While a trigger is active, prevent auto-dismiss of the latest item
    setTriggerPanelItems(prev => {
      if (prev.length === 0) return prev;
      return prev; // just keep them all
    });
  }, [hasActiveTrigger]);

  // ── Arena animations: phase glow + combat flash ────────────────────────
  useEffect(() => {
    if (!snap) return;
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = snap.phase;
    if (prev && !prev.startsWith('combat') && snap.phase === 'combat_begin') {
      setCombatFlash(true);
      setTimeout(() => setCombatFlash(false), 400);
    }
  }, [snap?.phase]); // eslint-disable-line

  // ── Arena animations: targeting arrow mouse tracking ───────────────────
  useEffect(() => {
    if (!targeting) return;
    function handleMouseMove(e: MouseEvent) {
      const line = targetArrowRef.current;
      if (!line) return;
      const sourceEl = document.querySelector(`[data-uid="${targeting!.cardUid}"]`);
      if (sourceEl) {
        const rect = sourceEl.getBoundingClientRect();
        line.setAttribute('x1', String(rect.left + rect.width / 2));
        line.setAttribute('y1', String(rect.top));
      }
      line.setAttribute('x2', String(e.clientX));
      line.setAttribute('y2', String(e.clientY));
    }
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [targeting]);

  // ── Auto-set targeting arrow when entering post_modal_target mode ────────
  // Also auto-fizzle if no valid targets exist (skip the OK button)
  useEffect(() => {
    const wi = snap?.waitingForInput;
    if (wi?.type === 'post_modal_target' && wi.playerId === 0) {
      // Check if there are valid targets — if not, auto-fizzle immediately
      const allBF = snap ? [...snap.players[0].battlefield, ...snap.players[1].battlefield] : [];
      const tt = wi.targetType;
      const hasValid = (() => {
        if (tt === 'creature' || tt === 'any') return allBF.some((c: any) => c.type_line?.includes('Creature'));
        if (tt === 'own_creature') return snap!.players[0].battlefield.some((c: any) => c.type_line?.includes('Creature'));
        if (tt === 'own_nonlegendary_creature') return snap!.players[0].battlefield.some((c: any) => c.type_line?.includes('Creature') && !c.type_line?.includes('Legendary'));
        if (tt === 'opponent_creature') return snap!.players[1].battlefield.some((c: any) => c.type_line?.includes('Creature'));
        if (tt === 'creature_with_flying') return allBF.some((c: any) => c.type_line?.includes('Creature') && ((c.keywords || []).map((k: string) => (k || '').toLowerCase()).includes('flying') || (c.oracle_text || '').toLowerCase().includes('flying')));
        if (tt === 'creature_without_flying') return allBF.some((c: any) => c.type_line?.includes('Creature') && !((c.keywords || []).map((k: string) => (k || '').toLowerCase()).includes('flying')));
        if (tt === 'creature_or_planeswalker') return allBF.some((c: any) => c.type_line?.includes('Creature') || c.type_line?.includes('Planeswalker'));
        if (tt === 'opponent_creature_or_planeswalker') return snap!.players[1].battlefield.some((c: any) => c.type_line?.includes('Creature') || c.type_line?.includes('Planeswalker'));
        if (tt === 'artifact') return allBF.some((c: any) => c.type_line?.includes('Artifact'));
        if (tt === 'enchantment') return allBF.some((c: any) => c.type_line?.includes('Enchantment'));
        if (tt === 'permanent') return allBF.length > 0;
        if (tt === 'nonland_permanent') return allBF.some((c: any) => !c.type_line?.includes('Land'));
        if (tt === 'creature_power4+') return allBF.some((c: any) => c.type_line?.includes('Creature') && parseInt(c.power || '0', 10) >= 4);
        if (tt === 'artifact_or_enchantment' || tt === 'opponent_artifact_or_enchantment') {
          const pool = tt === 'opponent_artifact_or_enchantment' ? snap!.players[1].battlefield : allBF;
          return (pool as any[]).some((c: any) => c.type_line?.includes('Artifact') || c.type_line?.includes('Enchantment'));
        }
        if (tt === 'artifact_or_enchantment_or_flyer') {
          const hasFly = (c: any) => (c.keywords || []).some((k: any) => (typeof k === 'string' ? k : k?.keyword || '').toLowerCase() === 'flying');
          return allBF.some((c: any) => c.type_line?.includes('Artifact') || c.type_line?.includes('Enchantment') || (c.type_line?.includes('Creature') && hasFly(c)));
        }
        if (tt === 'opponent_artifact_or_creature') {
          return (snap!.players[1].battlefield as any[]).some((c: any) => c.type_line?.includes('Artifact') || c.type_line?.includes('Creature'));
        }
        if (tt === 'opponent_nonland') {
          return (snap!.players[1].battlefield as any[]).some((c: any) => !c.type_line?.includes('Land'));
        }
        if (tt === 'noncreature_artifact') return allBF.some((c: any) => c.type_line?.includes('Artifact') && !c.type_line?.includes('Creature'));
        if (tt === 'creature_or_artifact') return allBF.some((c: any) => c.type_line?.includes('Creature') || c.type_line?.includes('Artifact'));
        if (tt === 'creature_or_enchantment') return allBF.some((c: any) => c.type_line?.includes('Creature') || c.type_line?.includes('Enchantment'));
        return true;
      })();

      if (!hasValid) {
        // No valid targets — auto-fizzle with brief toast message
        setTargeting(null);
        actions.resolvePostModalTarget(null);
        // Show brief floating message
        const toast = document.createElement('div');
        toast.textContent = '⚠ Sem alvos válidos — mágica cancelada';
        Object.assign(toast.style, {
          position: 'fixed', bottom: '140px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(231,76,60,0.92)', color: '#fff', padding: '10px 24px',
          borderRadius: '10px', fontSize: '14px', fontWeight: '600', zIndex: '99999',
          pointerEvents: 'none', transition: 'opacity 0.5s',
        });
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; }, 1500);
        setTimeout(() => { toast.remove(); }, 2100);
        return;
      }

      const gs = gsRef.current;
      const pendingCard = gs?._pendingModalResolution?.card;
      if (pendingCard?._uid) {
        setTargeting({ cardUid: pendingCard._uid, card: pendingCard, _fromModal: true } as any);
      }
    } else {
      // If we leave post_modal_target, clear any modal-set targeting arrow
      setTargeting(prev => (prev && (prev as any)._fromModal ? null : prev));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.waitingForInput?.type]);

  // ── Auto-set targeting arrow for etb_any_damage_target (Sonic Shrieker etc.) ─
  useEffect(() => {
    const wi = snap?.waitingForInput;
    if (wi?.type === 'etb_any_damage_target' && wi.playerId === 0) {
      const gs = gsRef.current;
      const pending = gs?._pendingEtbAnyDamage;
      if (pending?.sourceUid) {
        const sourceCard = gs?.players[0]?.zones?.battlefield?.cards?.find((c: any) => c._uid === pending.sourceUid);
        if (sourceCard) {
          setTargeting({ cardUid: sourceCard._uid, card: sourceCard, _fromEtbDamage: true } as any);
        }
      }
    } else {
      setTargeting(prev => (prev && (prev as any)._fromEtbDamage ? null : prev));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.waitingForInput?.type]);

  // ── Auto-set targeting arrow for choose_target (saga chapters) ─
  useEffect(() => {
    const wi = snap?.waitingForInput;
    if (wi?.type === 'choose_target' && wi.playerId === 0) {
      const gs = gsRef.current;
      const sagaCard = gs?._pendingSagaChapter?.saga;
      if (sagaCard?._uid) {
        setTargeting({ cardUid: sagaCard._uid, card: sagaCard, _fromSaga: true } as any);
      }
    } else {
      setTargeting(prev => (prev && (prev as any)?._fromSaga ? null : prev));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.waitingForInput?.type]);

  // Keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't fire game shortcuts when typing in input/textarea fields
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (snap?.phase === 'mulligan') break; // Mulligan uses K/M keys, not Space
          if (targeting) { setTargeting(null); break; }
          if (blockingWith.length > 0) { setBlockingWith([]); break; }
          {
            // Block Space from skipping mandatory-input states (including trigger choices)
            const blockingInputTypes = [
              // Original
              'discard', 'sacrifice', 'scry', 'surveil', 'search_library',
              'modal', 'order_blockers', 'order_library_top',
              // Trigger target choices — can't skip
              'damage_creature_target', 'move_counters_target',
              'etb_any_damage_target', 'etb_remove_counters_target',
              // Other mandatory trigger choices
              'choose_gy_bottom_library', 'choose_creature_type',
              'choose_spared_creatures', 'trigger_cost',
              'choose_opponent_discard',
            ];
            const wiType = snap?.waitingForInput?.type;
            // Also block choose_gy_return when NOT optional
            if (wiType === 'choose_gy_return' && !snap?.waitingForInput?.optional && snap?.waitingForInput?.playerId === 0) break;
            if (wiType && blockingInputTypes.includes(wiType) && snap?.waitingForInput?.playerId === 0) break;
          }
          if (snap?.waitingForInput?.type === 'declare_blockers' && snap.waitingForInput.playerId === 0) {
            actions.confirmBlockers();
          } else {
            actions.nextPhase();
          }
          break;
        case 'Escape':
          if (viewingBattlefield) { setViewingBattlefield(false); break; }
          if (showHelpModal) { setShowHelpModal(false); break; }
          // Cancel modal choice (Heritage Reclamation etc.) — undo spell
          if (snap?.waitingForInput?.type === 'modal_choice') {
            actions.cancelModal?.();
            break;
          }
          // Cancel post_modal_target (Heritage Reclamation target selection) — undo spell
          if (snap?.waitingForInput?.type === 'post_modal_target' || gsRef.current?.waitingForInput?.type === 'post_modal_target') {
            setTargeting(null);
            actions.resolvePostModalTarget(null);
            break;
          }
          if (targeting) {
            setTargeting(null);
            break;
          }
          if (blockingWith.length > 0) { setBlockingWith([]); break; }
          if (graveyardOpen) { setGraveyardOpen(null); break; }
          if (exileOpen) { setExileOpen(null); break; }
          if (abilityModal) { setAbilityModal(null); break; }
          if (equipModal) { setEquipModal(null); break; }
          if (attackTargetPicker) { setAttackTargetPicker(null); break; }
          if (adventureModal) { setAdventureModal(null); break; }
          if (cycleOrCastModal) { setCycleOrCastModal(null); break; }
          if (conditionalCostConfirm) { setConditionalCostConfirm(null); break; }
          // Escape on interactive fight/attach/free-cast overlays → skip/cancel
          if (wi?.type === 'fight_choose_target') { actions.resolveFightTarget(null); break; }
          if (wi?.type === 'free_cast_from_hand') { actions.resolveFreeCastFromHand(null); break; }
          if (wi?.type === 'free_cast_from_exile') { actions.resolveFreeCastFromExile(null); break; }
          if (wi?.type === 'attach_own_creature') { actions.resolveAttachOwnCreature(null); break; }
          if (wi?.type === 'attach_equipment_choice') { actions.resolveAttachEquipmentChoice(null); break; }
          if (wi?.type === 'damage_creature_target') { break; } // can't skip — must choose
          if (wi?.type === 'move_counters_target') { break; } // can't skip — must choose target
          if (showStack) { setShowStack(false); break; }
          break;
        case 'Enter': {
          // Confirm scry/surveil if waiting
          const wi = snap?.waitingForInput;
          if (wi?.type === 'scry' || wi?.type === 'surveil') {
            const pending = (snap as any)?._pendingScry;
            if (pending) actions.resolveScry(pending.choices, pending.topOrder);
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
                if ((!c.type_line?.includes('Creature') && !(c as any)._vehicleActive) || c._tapped) return false;
                const hasHaste = c._tempKeywords?.includes('Haste') ||
                  (c.keywords || []).some((k: string) => k?.toLowerCase() === 'haste') ||
                  (c.oracle_text || '').toLowerCase().includes('haste');
                return !c._summoningSick || hasHaste;
              })
              .forEach((c: any) => actions.declareAttacker(c._uid));
          }
          break;
        case 'p': case 'P': {
          // DEBUG: spawn Elspeth planeswalker on opponent's battlefield
          const gs = (window as any).__gsRef?.current;
          if (gs) {
            const pw = {
              _uid: 'debug-pw-' + Date.now(),
              name: 'Elspeth, Storm Slayer',
              type_line: 'Legendary Planeswalker — Elspeth',
              mana_cost: '{3}{W}{W}',
              oracle_text: '+1: Create a 1/1 white Soldier creature token.\n0: Put a +1/+1 counter on each creature you control.\n−3: Destroy target creature an opponent controls with mana value 3 or greater.',
              image_small: '', image_normal: '',
              _tapped: false, _loyalty: 4, _loyaltyUsedThisTurn: false,
              _summoningSick: false, _powerMod: 0, _toughnessMod: 0,
              _tempPowerMod: 0, _tempToughnessMod: 0, _damage: 0, _counters: {},
            };
            gs.players[1].zones.battlefield.add(pw);
            gs.log.push('[DEBUG] Elspeth spawned com 4 loyalty no campo do oponente.');
            const ref = (window as any).__gsRefresh;
            if (ref) ref();
          }
          break;
        }
        case 'w': case 'W': {
          // DEBUG: spawn a creature with Ward 2 on opponent's battlefield
          const gs2 = (window as any).__gsRef?.current;
          if (gs2) {
            const wardCreature = {
              _uid: 'debug-ward-' + Date.now(),
              name: 'Ward Sentinel',
              type_line: 'Creature — Human Knight',
              mana_cost: '{2}{W}',
              oracle_text: 'Ward {2}',
              power: '3', toughness: '4',
              keywords: ['Ward'],
              cmc: 3,
              image_small: '', image_normal: '',
              _tapped: false, _summoningSick: false,
              _powerMod: 0, _toughnessMod: 0,
              _tempPowerMod: 0, _tempToughnessMod: 0,
              _damage: 0, _counters: {},
            };
            gs2.players[1].zones.battlefield.add(wardCreature);
            gs2.log.push('[DEBUG] Ward Sentinel (3/4 Ward {2}) spawned no campo do oponente.');
            const ref2 = (window as any).__gsRefresh;
            if (ref2) ref2();
          }
          break;
        }
        case 'q': case 'Q': {
          // DEBUG: spawn a creature with Ward—Pay 2 life on opponent's battlefield
          const gsQ = (window as any).__gsRef?.current;
          if (gsQ) {
            const wardLifeCreature = {
              _uid: 'debug-ward-life-' + Date.now(),
              name: 'Ward Life Golem',
              type_line: 'Creature — Golem',
              mana_cost: '{3}',
              oracle_text: 'Ward—Pay 2 life.',
              power: '3', toughness: '4',
              keywords: ['Ward'],
              cmc: 3,
              image_small: '', image_normal: '',
              _tapped: false, _summoningSick: false,
              _powerMod: 0, _toughnessMod: 0,
              _tempPowerMod: 0, _tempToughnessMod: 0,
              _damage: 0, _counters: {},
            };
            gsQ.players[1].zones.battlefield.add(wardLifeCreature);
            gsQ.log.push('[DEBUG] Ward Life Golem (3/4 Ward—Pay 2 life) spawned no campo do oponente.');
            const refQ = (window as any).__gsRefresh;
            if (refQ) refQ();
          }
          break;
        }
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
            const gs2 = (window as any).__gsRef?.current;
            const mode = gs2?._pendingModal?.modes?.[idx];
            if (!mode?.disabled) actions.resolveModal([idx]);
          }
          break;
        }
        case 'f': case 'F': {
          const next = !autoPassRef.current;
          setAutoPass(next);
          addToast(next ? '⏩ Auto-pass ativado' : '⏹ Auto-pass desativado', next ? 'info' : 'cast');
          break;
        }
        case '?':
          setShowHelpModal(v => !v);
          break;
        case 'Tab':
          e.preventDefault();
          setShowStack(v => !v);
          break;
        case 'x': case 'X':
          // Full Control Mode toggle: pause at every phase like Arena Ctrl
          fullControlRef.current = !fullControlRef.current;
          setFullControl(v => !v);
          break;
        case 'z': case 'Z':
          // Undo last land tap
          actions.undoTapLand();
          break;
        case 'g': case 'G':
          // Toggle own graveyard
          setGraveyardOpen(prev => prev ? null : { pid: 0 });
          break;
        case 'e': case 'E':
          // Open exile zone
          setExileOpen(prev => prev ? null : { pid: 0 });
          break;
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [snap, actions, targeting, graveyardOpen, blockingWith, showStack, autoPass, exileOpen, abilityModal, equipModal, attackTargetPicker, adventureModal, conditionalCostConfirm, showHelpModal, viewingBattlefield]);

  // ── Pending attack target tokens (mobilize etc. entering attacking when PW on field) ──
  // Pop next token from queue and show attackTargetPicker
  function _popNextPendingToken() {
    const gs = (window as any).__gsRef?.current;
    if (!gs || !gs._pendingAttackTargetTokens || gs._pendingAttackTargetTokens.length === 0) {
      setAttackTargetPicker(null);
      if (gs) delete gs._pendingAttackTargetTokens;
      return;
    }
    const nextUid = gs._pendingAttackTargetTokens.shift();
    if (gs._pendingAttackTargetTokens.length === 0) delete gs._pendingAttackTargetTokens;
    // Find the token card on battlefield
    const tokenCard = gs.players[0].zones.battlefield.get(nextUid);
    setAttackTargetPicker({
      attackerUid: nextUid,
      isToken: true,
      tokenName: tokenCard?.name || 'Token',
    });
    const ref = (window as any).__gsRefresh;
    if (ref) ref();
  }
  function _clearPendingTokens() {
    const gs = (window as any).__gsRef?.current;
    if (gs) delete gs._pendingAttackTargetTokens;
  }

  // Auto-open attack target picker for pending tokens after refresh
  useEffect(() => {
    const gs = (window as any).__gsRef?.current;
    if (gs && gs._pendingAttackTargetTokens && gs._pendingAttackTargetTokens.length > 0 && !attackTargetPicker) {
      // Small delay so the token appears on BF first
      setTimeout(() => _popNextPendingToken(), 100);
    }
  }, [snap, attackTargetPicker]);

  // Helper: does this spell need interactive targeting?
  // Strips activated ability lines (e.g. "{1}, {T}: Target creature...") to avoid
  // false positives for creatures with targeted activated abilities.
  // Modal spells (Choose one/two) should never enter targeting mode before the modal;
  // the chosen mode handles targeting during resolution.
  function isModalSpell(card: any): boolean {
    // Siege-style enchantments (chooseOnETB): not spells per se but their oracle text
    // contains "target" inside mode descriptions — must be excluded from targeting UI
    const db = getPreprocessedEffects(card as any);
    if ((db as any)?.modal?.chooseOnETB) return true;
    // DB-registered modal spells: cast: [{type:'modal',...}] or old modal: {modes:[...]}
    if ((db as any)?.modal?.modes) return true;
    if (db?.cast && (db.cast as any[]).some((e: any) => e.type === 'modal')) return true;
    // Oracle text heuristics for non-DB cards
    const text = (card?.oracle_text || '').trim().toLowerCase();
    // Normalize: strip leading cost-reduction text (e.g. "This spell costs ... \nChoose one")
    const normalizedText = text.replace(/^this spell costs[^.]*\.\n?/, '').trimStart();
    return normalizedText.startsWith('choose one') || normalizedText.startsWith('choose two') ||
           normalizedText.startsWith('choose a mode') || /\n—\s*•/.test(card?.oracle_text || '') ||
           /—\s*\n\s*•/.test(card?.oracle_text || '');
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
    // Sagas never need targets at cast time — chapter effects are resolved during upkeep
    if (typeLineLower.includes('saga')) return false;
    // Planeswalkers never need targets at cast time — loyalty abilities are activated after ETB
    if (typeLineLower.includes('planeswalker')) return false;
    // Equipment never needs targets at cast time — equip is an activated ability after ETB
    if (typeLineLower.includes('equipment')) return false;

    // GY-return spells, optional_discard spells: targeting handled during resolution, not at cast time
    const db = getPreprocessedEffects(card as any);
    if (db && db.cast && db.cast.length > 0 && db.cast.every((e: any) =>
      e.type === 'return_from_graveyard' || e.type === 'shuffle_gy_to_library' ||
      e.type === 'draw' ||
      e.type === 'gain_life' || e.type === 'scry' || e.type === 'surveil' ||
      e.type === 'mill' || e.type === 'create_token' || e.type === 'counter_self' ||
      e.type === 'reveal_hand' || e.type === 'optional_discard' ||
      e.type === 'optional_discard_draw' || e.type === 'loot' ||
      e.type === 'strategic_betrayal' || e.type === 'ring_tempts' ||
      e.type === 'put_creatures_from_hand' ||
      (e.type === 'bounce' && e.target === 'any_creature') ||
      (e.type === 'exile' && (e.target === 'opponent_hand_nonland' || e.target === 'opponent_hand')) ||
      (e.type === 'counter' && e.target === 'own_creature' && e.optional)
    )) {
      return false;
    }

    const isPermSpell = (card.type_line || '').match(/Artifact|Enchantment|Planeswalker|Land/);
    let text = (card.oracle_text || '').toLowerCase();
    if (isPermSpell) {
      // Remove activated ability lines: lines starting with a mana-cost pattern like {1}, {T}:
      text = text.split('\n').filter((line: string) => {
        return !/^\{[^}]+\}[^:]*:/.test(line.trim());
      }).join('\n');
      // Remove non-ETB triggered ability lines (upkeep/whenever/etc.)
      // These targets are resolved at trigger time, not cast time (e.g. Smile at Death)
      const cardNameLower = (card.name || '').toLowerCase();
      text = text.split('\n').filter((line: string) => {
        const l = line.trim();
        if (l.startsWith('at the beginning')) return false;       // upkeep/end step triggers
        if (l.startsWith('whenever')) return false;                // recurring triggers
        return true;
      }).join('\n');
    }

    // Modal spells handle targeting AFTER mode selection via post_modal_target — skip pre-cast targeting
    if (db && (db as any).modal?.modes && !(db as any).modal?.chooseOnETB) return false;

    // Check if card's effect DB has prevent_damage_shield with explicit targeting (New Way Forward)
    if (db && db.cast && db.cast.some((e: any) => e.type === 'prevent_damage_shield' && e.target)) {
      return true;
    }
    // Aura enchantments always need an enchant target on cast
    if (typeLineLower.includes('aura') && text.includes('enchant ')) return true;
    // Attacking/blocking creature targeting: valid only during combat, handle in getValidTargets
    // Still show targeting UI but getValidTargets will restrict to combat creatures
    // Divided damage spells (Twin Bolt) need targeting even though oracle says "one or two targets"
    if (text.includes('divided as you choose') || text.includes('damage divided')) return true;
    return text.includes('target creature') || text.includes('target player') ||
           text.includes('target opponent') || text.includes('target permanent') ||
           text.includes('target land') || text.includes('target artifact') ||
           text.includes('target enchantment') || text.includes('target planeswalker') ||
           text.includes('target nonland') || text.includes('any target') ||
           text.includes('target attacking') || text.includes('target blocking');
  }

  // Returns true if all targeting effects in the cast DB are optional (e.g. Feral Deathgorger omen)
  // In that case, targeting UI should show a "No target" skip button
  function spellHasOnlyOptionalTargets(card: any): boolean {
    // "up to one target" in oracle text means targeting is optional
    const oracleText = (card.oracle_text || '').toLowerCase();
    if (oracleText.includes('up to one target')) return true;
    const db = getPreprocessedEffects(card as any);
    if (!db || !db.cast || db.cast.length === 0) return false;
    const targetingEffects = db.cast.filter((e: any) =>
      e.target && e.target !== 'self' &&
      !['draw', 'gainLife', 'scry', 'surveil', 'mill', 'create_token', 'counter_self'].includes(e.type)
    );
    return targetingEffects.length > 0 && targetingEffects.every((e: any) => e.optional === true);
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

  // Detect cards that need sequential multi-step targeting (own creature first, then opponent).
  // Covered patterns:
  //   A) "buff/double target creature you control ... fights target creature" (Dragonclaw Strike)
  //   B) "put a counter on target creature you control, then it deals damage to target creature" (Knockout Maneuver)
  //   C) "target creature you control deals damage equal to its power to target creature" (Piercing Exhale)
  //   D) "return target spell or permanent... deals damage to any target" (Jeskai Revelation)
  function getMultiTargetSteps(card: any): Array<{ side: 'own' | 'opponent' | 'any_permanent' | 'any_target'; prompt: string }> | null {
    const text = (card?.oracle_text || '').toLowerCase();

    // Pattern E: Twin Bolt — 2 damage divided among one or two targets
    if (text.includes('damage divided as you choose among one or two targets') ||
        text.includes('2 damage divided') || card.name === 'Twin Bolt') {
      return [
        { side: 'any_target', prompt: 'Choose first target (creature or player)' },
        { side: 'any_target', prompt: 'Choose second target (optional — can skip)', optional: true } as any
      ];
    }

    // Pattern D: Jeskai Revelation — bounce any spell/permanent + damage any target
    if (text.includes('return target') && (text.includes('spell or permanent') || text.includes('target permanent')) &&
        text.includes('deals') && text.includes('damage') && (text.includes('any target') || text.includes('target creature'))) {
      return [
        { side: 'any_permanent', prompt: 'Choose a spell or permanent to return' },
        { side: 'any_target', prompt: 'Choose a target for the damage' }
      ];
    }

    if (!text.includes('target creature you control')) return null;

    // Pattern A: ... then that creature fights target creature (Dragonclaw Strike)
    // Oracle: "...then it fights up to one target creature an opponent controls."
    if ((text.includes('fights') || text.includes('fight')) && text.includes('target creature') && !text.includes('deals damage equal to its power to target')) {
      const buffVerb = text.includes('double') ? 'to double' : text.includes('counter') ? 'for the counter' : 'to buff';
      return [
        { side: 'own', prompt: `Choose a creature you control ${buffVerb}` },
        { side: 'opponent', prompt: 'Choose a creature to fight' }
      ];
    }

    // Pattern B: "put a counter on target creature you control, then it deals damage to target creature"
    // (Knockout Maneuver)
    if (text.includes('then it deals damage') && text.includes('target creature')) {
      return [
        { side: 'own', prompt: 'Choose a creature you control (deals damage)' },
        { side: 'opponent', prompt: 'Choose a creature to deal damage to' }
      ];
    }

    // Pattern C: "target creature you control deals damage equal to its power to target creature or planeswalker"
    // (Piercing Exhale)
    if (/target creature you control deals damage.*to target (creature|permanent|planeswalker)/.test(text)) {
      return [
        { side: 'own', prompt: 'Choose a creature you control (deals damage)' },
        { side: 'opponent', prompt: 'Choose a target to deal damage to' }
      ];
    }

    return null;
  }

  // Build valid targets for current targeting spell
  // stepFilter: if provided, restrict valid targets for multi-step targeting
  function getValidTargets(card: any, stepFilter?: 'own' | 'opponent' | 'any_permanent' | 'any_target') {
    if (!snap) return [];
    const text = (card?.oracle_text || '').toLowerCase();
    const targets: any[] = [];

    // Multi-step targeting: restrict valid targets to the appropriate side for the current step
    if (stepFilter === 'own') {
      snap.players[0].battlefield
        .filter((c: any) => c.type_line?.includes('Creature'))
        .forEach((c: any) => targets.push({ type: 'creature', uid: c._uid, player: 0, card: c }));
      return targets;
    }
    if (stepFilter === 'opponent') {
      snap.players[1].battlefield
        .filter((c: any) => c.type_line?.includes('Creature'))
        .forEach((c: any) => targets.push({ type: 'creature', uid: c._uid, player: 1, card: c }));
      // Include planeswalkers if the spell can target them (e.g. "creature or planeswalker")
      if (text.includes('planeswalker') || text.includes('or planeswalker')) {
        snap.players[1].battlefield
          .filter((c: any) => c.type_line?.includes('Planeswalker'))
          .forEach((c: any) => targets.push({ type: 'permanent', uid: c._uid, player: 1, card: c }));
      }
      return targets;
    }
    // any_permanent: all permanents on both battlefields (for bounce/return effects)
    if (stepFilter === 'any_permanent') {
      [0, 1].forEach(pid => {
        snap.players[pid].battlefield
          .forEach((c: any) => targets.push({ type: 'permanent', uid: c._uid, player: pid, card: c }));
      });
      return targets;
    }
    // any_target: all creatures, planeswalkers on both sides (player clicks handled in handlePlayerTarget)
    if (stepFilter === 'any_target') {
      [0, 1].forEach(pid => {
        snap.players[pid].battlefield
          .filter((c: any) => c.type_line?.includes('Creature') || c.type_line?.includes('Planeswalker'))
          .forEach((c: any) => targets.push({ type: 'creature', uid: c._uid, player: pid, card: c }));
      });
      return targets; // Player targets handled separately via handlePlayerTarget
    }

    // prevent_damage_shield with target in effect DB (New Way Forward): target any creature on either side
    const db2 = getPreprocessedEffects(card as any);
    if (db2?.cast?.some((e: any) => e.type === 'prevent_damage_shield' && e.target)) {
      [0, 1].forEach(pid => {
        snap.players[pid].battlefield
          .filter((c: any) => c.type_line?.includes('Creature') || c.type_line?.includes('Planeswalker'))
          .forEach((c: any) => targets.push({ type: 'creature', uid: c._uid, player: pid, card: c }));
      });
      return targets;
    }

    // Restrict to attacking/blocking creatures when oracle text specifies it
    if (text.includes('attacking or blocking') || (text.includes('attacking') && text.includes('blocking') && text.includes('creature'))) {
      const allBF = [...snap.players[0].battlefield, ...snap.players[1].battlefield];
      allBF.forEach((c: any) => {
        if (c.type_line?.includes('Creature') && (c._attacking || c._blocking)) {
          const pid = snap.players[0].battlefield.includes(c) ? 0 : 1;
          targets.push({ type: 'creature', uid: c._uid, player: pid, card: c });
        }
      });
      return targets;
    }

    // Aura enchantments: "enchant creature" means we want any creature
    if ((card?.type_line || '').toLowerCase().includes('aura') && text.includes('enchant creature')) {
      [0, 1].forEach(pid => {
        snap.players[pid].battlefield
          .filter((c: any) => c.type_line?.includes('Creature'))
          .forEach((c: any) => targets.push({ type: 'creature', uid: c._uid, player: pid, card: c }));
      });
      return targets;
    }
    // "target creature with flying" — only flying creatures are valid (e.g. Shower of Arrows)
    const wantsOnlyFlyingCreature = !!(text.match(/target creature[s]? with flying/) && !text.match(/target creature(?! with flying)/));
    const wantsCreature = (text.includes('target creature') || text.includes('target permanent') || text.includes('target nonland')) && !wantsOnlyFlyingCreature;
    // "target player" / "target opponent" / "player or planeswalker" are explicitly player-targeting.
    // Do NOT include generic 'damage'/'deals' here — that's too broad and wrongly targets players
    // for cards like "deals 5 damage to target creature". 'any target' is handled via wantsAny below.
    const wantsPlayer = text.includes('target player') || text.includes('target opponent') ||
      text.includes('target player or planeswalker') || text.includes('target opponent or planeswalker');
    const wantsEnemy = text.includes('target opponent') || text.includes('target opponent\'s') || text.includes('an opponent controls');
    const wantsAny = text.includes('target creature or player') || text.includes('any target');
    // Planeswalkers are valid targets for: "planeswalker", "target permanent", "target nonland permanent", "any target"
    const wantsPlaneswalker = text.includes('planeswalker') || text.includes('target permanent') || text.includes('target nonland') || wantsAny;
    const wantsArtifact = text.includes('target artifact') || text.includes('target permanent') || text.includes('target nonland') || wantsAny;
    // Also match "target artifact, enchantment, or ..." comma-list patterns (e.g. Shower of Arrows)
    const wantsEnchantment = text.includes('target enchantment') || text.includes('target permanent') || text.includes('target nonland') || wantsAny
      || (wantsArtifact && (text.includes(', enchantment') || text.includes('or enchantment')));
    // Flying creatures also valid for "target artifact, enchantment, or creature with flying" patterns
    const wantsCreatureWithFlyingAlso = !wantsCreature && wantsArtifact && text.includes('flying')
      && (text.includes(', enchantment') || text.includes('or enchantment'));

    // Add creatures (all) or only flying if "target creature with flying"
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
    // "target artifact, enchantment, or creature with flying" — add flying creatures from both sides
    if (wantsCreatureWithFlyingAlso && !wantsOnlyFlyingCreature) {
      const hasFlyingKwA = (c: any) => {
        const kws = [...(c.keywords || []), ...(c._tempKeywords || []), ...(c._grantedKeywords || [])];
        return kws.some((k: any) => (typeof k === 'string' ? k : k?.keyword || '').toLowerCase() === 'flying');
      };
      [0, 1].forEach(pid => {
        snap.players[pid].battlefield
          .filter((c: any) => c.type_line?.includes('Creature') && hasFlyingKwA(c))
          .forEach((c: any) => {
            if (!targets.find((t: any) => t.uid === c._uid))
              targets.push({ type: 'creature', uid: c._uid, player: pid, card: c });
          });
      });
    }
    // "target creature with flying" — add only flying creatures from both sides
    if (wantsOnlyFlyingCreature) {
      const hasFlyingKw = (c: any) => {
        const kws = [...(c.keywords || []), ...(c._tempKeywords || []), ...(c._grantedKeywords || [])];
        return kws.some((k: any) => (typeof k === 'string' ? k : k?.keyword || '').toLowerCase() === 'flying');
      };
      [0, 1].forEach(pid => {
        snap.players[pid].battlefield
          .filter((c: any) => c.type_line?.includes('Creature') && hasFlyingKw(c))
          .forEach((c: any) => targets.push({ type: 'creature', uid: c._uid, player: pid, card: c }));
      });
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
    // Add lands (for "target land" or "target artifact or land")
    const wantsLand = text.includes('target land') || (text.includes('target artifact') && text.includes('or land'));
    if (wantsLand) {
      [0, 1].forEach(pid => {
        snap.players[pid].battlefield
          .filter((c: any) => c.type_line?.includes('Land'))
          .forEach((c: any) => targets.push({ type: 'permanent', uid: c._uid, player: pid, card: c }));
      });
    }
    // Add players
    if (wantsPlayer || wantsAny) {
      targets.push({ type: 'player', player: 1, name: 'Opponent' });
      if (!wantsEnemy) targets.push({ type: 'player', player: 0, name: 'You' });
    }

    // Filter out opponent's hexproof/shroud/protection creatures (player 0 = human, can't target opponent's protected)
    const filteredTargets = targets.filter((t: any) => {
      if (t.type === 'player') return true;
      if (!t.card) return true;
      // Hexproof/shroud only blocks OPPONENT's targeting (own creatures are fine)
      if (t.player !== 0) {
        const kws = (t.card.keywords || []).map((k: string) => (k || '').toLowerCase());
        const tempKws = (t.card._tempKeywords || []).map((tk: any) => (typeof tk === 'string' ? tk : tk.keyword || '').toLowerCase());
        const grantedKws = (t.card._grantedKeywords || []).map((g: string) => (g || '').toLowerCase());
        const hasHexproof = kws.includes('hexproof') || tempKws.includes('hexproof') || grantedKws.includes('hexproof') ||
          (t.card._counters?.hexproof > 0) || (t.card._counters?.Hexproof > 0) ||
          (t.card._hexproofUntilDamage && !t.card._hasDealtDamage);
        const hasShroud = kws.includes('shroud') || tempKws.includes('shroud') || grantedKws.includes('shroud');
        if (hasHexproof || hasShroud) return false;
      }
      // Protection from color blocks targeting from ANY source (including own spells!)
      const allKws = [
        ...(t.card.keywords || []).map((k: string) => (k || '').toLowerCase()),
        ...(t.card._tempKeywords || []).map((tk: any) => (typeof tk === 'string' ? tk : tk.keyword || '').toLowerCase()),
        ...(t.card._grantedKeywords || []).map((g: string) => (g || '').toLowerCase()),
      ];
      const colorMap: Record<string, string> = { 'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G' };
      const protectedColors: string[] = [];
      for (const kw of allKws) {
        const protMatch = kw.match(/protection from (.+)/);
        if (protMatch) {
          const parts = protMatch[1].split(/\s+and\s+(?:from\s+)?/);
          for (const part of parts) {
            const color = colorMap[part.trim()];
            if (color && !protectedColors.includes(color)) protectedColors.push(color);
          }
        }
      }
      if (protectedColors.length > 0) {
        // Check if source spell's colors match any protection color
        console.log(`[PROTECTION] Target ${t.card.name} has protection from ${protectedColors.join(',')}. Source spell: ${card?.name}, mana_cost: ${card?.mana_cost}, colors: ${card?.colors}, color_identity: ${card?.color_identity}`);
        const srcManaCost = card?.mana_cost || '';
        const srcColors: string[] = [];
        if (srcManaCost.includes('W')) srcColors.push('W');
        if (srcManaCost.includes('U')) srcColors.push('U');
        if (srcManaCost.includes('B')) srcColors.push('B');
        if (srcManaCost.includes('R')) srcColors.push('R');
        if (srcManaCost.includes('G')) srcColors.push('G');
        // Also check color_identity/colors arrays
        const colorLine = card?.color_identity || card?.colors || [];
        if (Array.isArray(colorLine)) {
          for (const c of colorLine) {
            if (['W', 'U', 'B', 'R', 'G'].includes(c) && !srcColors.includes(c)) srcColors.push(c);
          }
        }
        if (srcColors.some(c => protectedColors.includes(c))) return false;
      }
      return true;
    });

    // Filter by mana value if oracle text specifies it (e.g. "mana value 3 or greater")
    const mvMatch = text.match(/mana value (\d+) or greater/);
    if (mvMatch) {
      const minMV = parseInt(mvMatch[1], 10);
      return filteredTargets.filter((t: any) => t.type === 'player' || (t.card?.cmc ?? 0) >= minMV);
    }

    return filteredTargets;
  }

  function handleCardClick(card: any, pid: number) {
    if (!snap) return;
    const wi = snap.waitingForInput;
    console.log(`[CLICK] ${card.name}, pid=${pid}, wfi=${wi?.type}, phase=${snap.phase}, targeting=${!!targeting}, inHand=${snap.players[0].hand.some((c:any) => c._uid === card._uid)}`);

    // ── tap_or_untap_choose: click any battlefield card directly (Gandalf the Grey) ──
    if (wi?.type === 'tap_or_untap_choose' && wi.playerId === 0) {
      const validUids: string[] = (wi.choices || []).map((c: any) => c._uid);
      if (validUids.includes(card._uid)) {
        actions.resolveTapOrUntap(card._uid);
        return;
      }
      return;
    }

    // ── post_modal_target: pick a creature/permanent after modal mode chosen ──
    // Must be checked BEFORE the targeting block so modal target clicks aren't
    // intercepted by the generic targeting handler.
    if (wi?.type === 'post_modal_target' && wi.playerId === 0) {
      const targetType = wi.targetType;
      let isValid = false;
      const tl = (card.type_line || '').toLowerCase();
      const kws = ((card.keywords || []) as string[]).map(k => (k || '').toLowerCase());

      if (targetType === 'creature' || targetType === 'any') {
        isValid = tl.includes('creature');
      } else if (targetType === 'own_creature') {
        isValid = pid === 0 && tl.includes('creature');
      } else if (targetType === 'own_nonlegendary_creature') {
        isValid = pid === 0 && tl.includes('creature') && !tl.includes('legendary');
      } else if (targetType === 'opponent_creature') {
        isValid = pid === 1 && tl.includes('creature');
      } else if (targetType === 'creature_or_planeswalker') {
        isValid = tl.includes('creature') || tl.includes('planeswalker');
      } else if (targetType === 'opponent_creature_or_planeswalker') {
        isValid = pid === 1 && (tl.includes('creature') || tl.includes('planeswalker'));
      } else if (targetType === 'creature_with_flying') {
        isValid = tl.includes('creature') && (kws.includes('flying') || (card.oracle_text || '').toLowerCase().includes('flying'));
      } else if (targetType === 'creature_without_flying') {
        isValid = tl.includes('creature') && !kws.includes('flying');
      } else if (targetType === 'artifact') {
        isValid = tl.includes('artifact');
      } else if (targetType === 'enchantment') {
        isValid = tl.includes('enchantment');
      } else if (targetType === 'permanent') {
        isValid = !tl.includes('instant') && !tl.includes('sorcery');
      } else if (targetType === 'nonland_permanent') {
        isValid = !tl.includes('land') && !tl.includes('instant') && !tl.includes('sorcery');
      } else if (targetType === 'creature_power4+') {
        const pow = parseInt(card.power || '0', 10);
        isValid = tl.includes('creature') && pow >= 4;
      } else if (targetType === 'artifact_or_enchantment' || targetType === 'opponent_artifact_or_enchantment') {
        isValid = tl.includes('artifact') || tl.includes('enchantment');
        if (targetType === 'opponent_artifact_or_enchantment') isValid = isValid && pid === 1;
      } else if (targetType === 'artifact_or_enchantment_or_flyer') {
        const hasFly2 = (card.keywords || []).some((k: any) => (typeof k === 'string' ? k : k?.keyword || '').toLowerCase() === 'flying');
        isValid = tl.includes('artifact') || tl.includes('enchantment') || (tl.includes('creature') && hasFly2);
      } else if (targetType === 'opponent_artifact_or_creature') {
        isValid = (tl.includes('artifact') || tl.includes('creature')) && pid === 1;
      } else if (targetType === 'opponent_nonland') {
        isValid = !tl.includes('land') && pid === 1;
      } else if (targetType === 'noncreature_artifact') {
        isValid = tl.includes('artifact') && !tl.includes('creature');
      } else if (targetType === 'creature_or_artifact') {
        isValid = tl.includes('creature') || tl.includes('artifact');
      } else if (targetType === 'creature_or_enchantment') {
        isValid = tl.includes('creature') || tl.includes('enchantment');
      }

      // Check hexproof/shroud (opponent only) and protection (all creatures)
      if (isValid) {
        const cKws = ((card.keywords || []) as string[]).map(k => (k || '').toLowerCase());
        const cTempKws = ((card._tempKeywords || []) as any[]).map((tk: any) => (typeof tk === 'string' ? tk : tk.keyword || '').toLowerCase());
        const cGrantedKws = ((card._grantedKeywords || []) as string[]).map((g: string) => (g || '').toLowerCase());
        // Hexproof/shroud only blocks opponent's targeting
        if (pid === 1) {
          const hex = cKws.includes('hexproof') || cTempKws.includes('hexproof') || cGrantedKws.includes('hexproof') ||
            (card._counters?.hexproof > 0) || (card._counters?.Hexproof > 0) ||
            (card._hexproofUntilDamage && !card._hasDealtDamage);
          const shr = cKws.includes('shroud') || cTempKws.includes('shroud') || cGrantedKws.includes('shroud');
          if (hex || shr) isValid = false;
        }
        // Protection from color: blocks ALL sources (own and opponent's)
        if (isValid) {
          const allCKws = [...cKws, ...cTempKws, ...cGrantedKws];
          const _colorMap: Record<string, string> = { 'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G' };
          const _protColors: string[] = [];
          for (const kw of allCKws) {
            const pm = kw.match(/protection from (.+)/);
            if (pm) {
              for (const part of pm[1].split(/\s+and\s+(?:from\s+)?/)) {
                const clr = _colorMap[part.trim()];
                if (clr && !_protColors.includes(clr)) _protColors.push(clr);
              }
            }
          }
          if (_protColors.length > 0) {
            const srcCard = gsRef.current?._pendingModalResolution?.card;
            const srcMana = srcCard?.mana_cost || '';
            const srcClrs: string[] = [];
            if (srcMana.includes('W')) srcClrs.push('W');
            if (srcMana.includes('U')) srcClrs.push('U');
            if (srcMana.includes('B')) srcClrs.push('B');
            if (srcMana.includes('R')) srcClrs.push('R');
            if (srcMana.includes('G')) srcClrs.push('G');
            if (srcClrs.some(c => _protColors.includes(c))) isValid = false;
          }
        }
      }

      if (isValid) {
        setTargeting(null); // clear the modal targeting arrow
        actions.resolvePostModalTarget({ type: 'creature', uid: card._uid, player: pid });
      }
      return;
    }

    // ── Targeting mode: clicking a creature/permanent to target it ──────────
    if (targeting) {
      // ETB damage targeting (Sonic Shrieker etc.): arrow leads here, resolve directly
      if ((targeting as any)._fromEtbDamage) {
        if (wi?.type === 'etb_any_damage_target' && wi.playerId === 0) {
          const isCreatureTarget = card.type_line?.includes('Creature') || card._isToken || card.power != null;
          const isPWTarget = card.type_line?.includes('Planeswalker');
          if (isCreatureTarget) {
            actions.resolveETBDamageTarget({ type: 'creature', uid: card._uid, player: pid });
            setTargeting(null);
          } else if (isPWTarget) {
            actions.resolveETBDamageTarget({ type: 'permanent', uid: card._uid, player: pid });
            setTargeting(null);
          }
        }
        return;
      }

      // Multi-step targeting (e.g. Dragonclaw Strike: step 1 = own creature, step 2 = opp creature)
      if (targeting.steps && targeting.step) {
        const currentStep = targeting.steps[targeting.step - 1];
        const stepTargets = getValidTargets(targeting.card, currentStep.side);
        const hit = stepTargets.find((x: any) => x.uid === card._uid);
        if (hit) {
          const collected = [...(targeting.collectedTargets || []), { type: 'creature', uid: card._uid, player: hit.player }];
          if (targeting.step < targeting.steps.length) {
            // Advance to next step
            setTargeting({ ...targeting, step: targeting.step + 1, collectedTargets: collected });
          } else {
            // All steps done — cast with all collected targets
            showCastAnimation(targeting.card);
            actions.castSpell(targeting.cardUid, collected);
            setTargeting(null);
          }
        }
        return;
      }

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
            addToast(`Insufficient mana — need ${condCost.extraCost} more to target a Dragon`, 'damage');
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

        showCastAnimation(targeting.card);
        if (targeting.isHarmonize) {
          actions.castHarmonize(targeting.cardUid, tgt, targeting.harmonizeTappedUid ?? undefined);
          setHarmonizePending(null);
        } else if (targeting.card._isAdventure) {
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
      const isMyCreature = myBF.some((c: any) => c._uid === card._uid) && !card._tapped && !card._cantBlockThisTurn && !card._cantBlockSagaUid && card.type_line?.includes('Creature');
      const isOppAttacker = oppBF.some((c: any) => c._uid === card._uid) && card._attacking;

      if (isMyCreature) {
        // Toggle creature in/out of selected blockers (Arena-style gang-block)
        const blockers = gsRef.current?.combat?.blockers || {};
        const alreadyAssigned = Object.values(blockers).some(
          (arr: any) => Array.isArray(arr) && arr.some((b: any) => b.uid === card._uid)
        );
        if (alreadyAssigned) {
          // Already assigned — unassign it
          actions.unassignBlocker(card._uid);
          setBlockingWith(prev => prev.filter(uid => uid !== card._uid));
        } else if (blockingWith.includes(card._uid)) {
          // Already selected — deselect it
          setBlockingWith(prev => prev.filter(uid => uid !== card._uid));
        } else {
          // Add to selected blockers
          setBlockingWith(prev => [...prev, card._uid]);
        }
        return;
      }
      if (isOppAttacker && blockingWith.length > 0) {
        // Click attacker to assign ALL selected blockers to it
        // Only assign blockers that can legally block this attacker (flying/reach check)
        const gs = gsRef.current;
        const validBlockers = blockingWith.filter(bUid => {
          const blocker = gs?.players[0].zones.battlefield.get(bUid);
          if (!blocker) return false;
          const attacker = gs?.players[1].zones.battlefield.get(card._uid);
          if (!attacker) return false; // can't confirm attacker exists → deny block
          // Check flying: attacker has flying, blocker needs flying or reach
          const attackerKws = (attacker.keywords || []).map((k: any) => (k || '').toLowerCase());
          const blockerKws = (blocker.keywords || []).map((k: any) => (k || '').toLowerCase());
          const attackerText = (attacker.oracle_text || '').toLowerCase();
          const blockerText = (blocker.oracle_text || '').toLowerCase();
          const attackerFlying = attackerKws.includes('flying') || attackerText.includes('\nflying');
          if (attackerFlying) {
            const hasFlying = blockerKws.includes('flying') || blockerText.includes('\nflying');
            const hasReach = blockerKws.includes('reach') || blockerText.includes('\nreach');
            if (!hasFlying && !hasReach) return false;
          }
          return true;
        });
        if (validBlockers.length === 0) {
          addToast('Essa criatura não pode bloquear esse atacante', 'warning');
          setBlockingWith([]);
          return;
        }
        for (const bUid of validBlockers) {
          actions.declareBlocker(bUid, card._uid);
        }
        if (validBlockers.length < blockingWith.length) {
          addToast('Algumas criaturas não podem bloquear (voar/alcance)', 'warning');
        }
        setBlockingWith([]);
        return;
      }
      // Cancel blocker selection if clicking elsewhere
      setBlockingWith([]);
      return;
    }

    // ── etb_any_damage_target: pick a creature or player for ETB damage ──────
    if (wi?.type === 'etb_any_damage_target' && wi.playerId === 0) {
      const isCreatureTarget = card.type_line?.includes('Creature') || card._isToken || card.power != null;
      const isPWTarget = card.type_line?.includes('Planeswalker');
      if (isCreatureTarget) {
        actions.resolveETBDamageTarget({ type: 'creature', uid: card._uid, player: pid });
      } else if (isPWTarget) {
        actions.resolveETBDamageTarget({ type: 'permanent', uid: card._uid, player: pid });
      }
      return;
    }

    // ── choose_target engine waiting (saga chapters) ──────────────────────
    if (wi?.type === 'choose_target') {
      // Only accept battlefield cards as targets (not hand/exile cards)
      const onBF0 = snap.players[0].battlefield.some((c: any) => c._uid === card._uid);
      const onBF1 = snap.players[1].battlefield.some((c: any) => c._uid === card._uid);
      if (onBF0 || onBF1) {
        actions.resolveChooseTarget([{ type: 'permanent', uid: card._uid, player: pid }]);
      }
      return; // Always return during choose_target — block other clicks
    }

    const phase = snap.phase;
    const isInstantPriority = wi?.type === 'instant_priority' && wi.playerId === 0;
    const isStackPriority = wi?.type === 'stack_priority' && wi.playerId === 0;
    const isTriggerPriority = wi?.type === 'trigger_priority' && wi.playerId === 0;
    const isMainPhase = phase === 'main1' || phase === 'main2';
    const canPlaySpells = isMainPhase || isInstantPriority || isStackPriority || isTriggerPriority;

    if (pid !== 0) return; // clicking opp cards handled by targeting/blocking above

    const inHand = snap.players[0].hand.some((c: any) => c._uid === card._uid);
    const inBF   = snap.players[0].battlefield.some((c: any) => c._uid === card._uid);
    const inExiledPlayable = (snap.exiledPlayable?.[0] || []).some((c: any) => c._uid === card._uid);
    const isLand = card.type_line?.includes('Land');
    // A card is "instant-speed" if it's an Instant, has flash, OR has a back/adventure face that's an Instant
    const backFaceIsInstant = card.back_face?.type_line?.includes('Instant') ||
      card.card_faces?.some((f: any) => f.type_line?.includes('Instant'));
    const isInstant = card.type_line?.includes('Instant') ||
      card.oracle_text?.toLowerCase().includes('flash') ||
      backFaceIsInstant;

    // Exiled playable cards (Breaching Dragonstorm, Riverwheel Sweep, Tersa, etc.)
    // Allow main phase for any card, or instant-speed during priority windows
    if (inExiledPlayable && (isMainPhase || ((isInstantPriority || isStackPriority) && isInstant))) {
      if (isLand) {
        actions.playLand(card._uid);
      } else if (spellNeedsTargeting(card)) {
        setTargeting({ cardUid: card._uid, card });
      } else {
        showCastAnimation(card);
        actions.castSpell(card._uid);
      }
      return;
    }
    // Exiled playable clicked outside valid window — show hint
    if (inExiledPlayable && !isMainPhase) {
      addToast('You can cast this card during your main phase', 'info');
      return;
    }

    if (inHand) {
      // Lands only in main phase
      if (isLand) {
        if (!isMainPhase) return;
        SoundManager.play('land_tap');
        actions.playLand(card._uid);
        return;
      }

      // Cards with cycling: show cast/cycle choice modal in main phase
      if (isMainPhase && wi?.type === 'main_phase') {
        const cardCycling = parseCyclingAbility(card as any);
        if (cardCycling) {
          setCycleOrCastModal({ card, cyclingAbility: cardCycling });
          return;
        }
      }

      // Instants/flash anytime during instant/stack priority, sorceries only in main
      if (!canPlaySpells && !isInstant) return;
      if (!canPlaySpells && !isInstantPriority && !isStackPriority) return;
      // During stack priority, only instants/flash cards are allowed
      // Exception: cards made playable by grant_flash (e.g. legendary/artifact with Gandalf the White)
      if (isStackPriority && !isInstant && !playableSet.has(card._uid)) return;

      // If card has adventure/omen mode (layout='adventure', data in back_face), show choice modal
      // During stack_priority, only show the adventure modal (user can pick the instant face)
      if (card.layout === 'adventure' && card.back_face?.name) {
        setAdventureModal({ card });
        return;
      }

      // Counter spells: auto-target opponent's topmost stack spell
      // Skip for creatures — their counter ability is in ETB modal, not a cast effect
      const cardText = (card.oracle_text || '').toLowerCase();
      const isCreatureCard = (card.type_line || '').includes('Creature');
      const isCounterSpell = !isCreatureCard && (cardText.includes('counter target spell') ||
                              cardText.includes('counter target creature spell') ||
                              cardText.includes('counter target instant') ||
                              cardText.includes('counter target sorcery'));
      if (isCounterSpell) {
        const gs = gsRef.current;
        // Check both stack.items AND _pendingCastOnStack for the target spell
        const stackItems: any[] = gs?.stack?.items || [];
        const oppSpells = stackItems.filter((item: any) => item.controller !== 0);
        const pending = gs?._pendingCastOnStack;

        let targetCard: any = null;
        if (oppSpells.length > 0) {
          targetCard = oppSpells[oppSpells.length - 1].card;
        } else if (pending?.card && pending.playerId !== 0) {
          targetCard = pending.card;
        }

        if (!targetCard) {
          addToast('Nenhum spell do oponente na stack para anular', 'warning');
          return;
        }
        showCastAnimation(card);
        actions.castSpell(card._uid, [targetCard]);
        return;
      }

      // Detect cards that need two sequential targets (e.g. Dragonclaw Strike: buff own then fight opp)
      const multiSteps = getMultiTargetSteps(card);
      if (spellNeedsTargeting(card)) {
        const optionalOnly = spellHasOnlyOptionalTargets(card);
        if (multiSteps) {
          setTargeting({ cardUid: card._uid, card, step: 1, steps: multiSteps, collectedTargets: [] });
        } else {
          setTargeting({ cardUid: card._uid, card, optionalTarget: optionalOnly });
        }
      } else {
        showCastAnimation(card);
        actions.castSpell(card._uid);
      }
    } else if (inBF) {
      if (phase === 'combat_attackers' && snap.activePlayer === 0 && (card.type_line?.includes('Creature') || (card as any)._vehicleActive)) {
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
          // If the land also has a mana ability (e.g. Shire Terrace: {T}: Add {C}), show ability modal
          import('../engine/cards').then(({ getActivatedAbilities, getManaAbilities }) => {
            const allAbilities = getActivatedAbilities(card);
            const manaAbilities = getManaAbilities(card);
            if (manaAbilities.length > 0 && canPlaySpells) {
              setAbilityModal({ card, abilities: allAbilities });
            } else {
              actions.activateFetchLand(card._uid);
            }
          });
        } else {
          // Check if this land has non-mana activated abilities (e.g., Cori Mountain Monastery {3R}: exile top)
          import('../engine/cards').then(({ getActivatedAbilities, getManaAbilities }) => {
            const allAbilities = getActivatedAbilities(card);
            const manaAbilities = getManaAbilities(card);
            const hasNonMana = allAbilities.some(a => !manaAbilities.includes(a));
            if (hasNonMana && canPlaySpells) {
              setAbilityModal({ card, abilities: allAbilities });
            } else {
              actions.tapLand(card._uid);
              spawnManaFloat(card);
            }
          }).catch(() => {
            actions.tapLand(card._uid);
            spawnManaFloat(card);
          });
        }
      } else if (!isLand && canPlaySpells) {
        // Single-click opens ability/equip modal for non-land permanents in main phase or any priority window
        handleDoubleClick(card);
      }
    }
  }

  // Handle clicking on a player life total as a target
  function handlePlayerTarget(pid: number) {
    if (!snap) return;
    if (targeting) {
      // ETB damage targeting (Reliquary Dragon etc.): allow player targeting (unless creatureOnly)
      if ((targeting as any)._fromEtbDamage) {
        if (snap.waitingForInput?.type === 'etb_any_damage_target' && snap.waitingForInput.playerId === 0) {
          const pendingDmg = gsRef.current?._pendingEtbAnyDamage;
          if (!pendingDmg?.creatureOnly) {
            actions.resolveETBDamageTarget({ type: 'player', player: pid });
            setTargeting(null);
          }
        }
        return;
      }
      // Multi-step targeting: handle player as a target in any_target steps
      if (targeting.steps && targeting.step) {
        const currentStep = targeting.steps[targeting.step - 1];
        if (currentStep.side === 'any_target') {
          const collected = [...(targeting.collectedTargets || []), { type: 'player', player: pid }];
          if (targeting.step < targeting.steps.length) {
            setTargeting({ ...targeting, step: targeting.step + 1, collectedTargets: collected });
          } else {
            showCastAnimation(targeting.card);
            actions.castSpell(targeting.cardUid, collected);
            setTargeting(null);
          }
          return;
        }
      }
      const t = getValidTargets(targeting.card);
      const hit = t.find(x => x.type === 'player' && x.player === pid);
      if (hit) {
        const tgt = [{ type: 'player', player: pid }];
        showCastAnimation(targeting.card);
        if (targeting.isHarmonize) {
          actions.castHarmonize(targeting.cardUid, tgt, targeting.harmonizeTappedUid ?? undefined);
          setHarmonizePending(null);
        } else if (targeting.card._isAdventure) {
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
    // etb_any_damage_target: player targeting for ETB damage (unless creatureOnly)
    if (snap.waitingForInput?.type === 'etb_any_damage_target' && snap.waitingForInput.playerId === 0) {
      const pendingDmg2 = gsRef.current?._pendingEtbAnyDamage;
      if (pendingDmg2?.creatureOnly) return; // block player targeting
      actions.resolveETBDamageTarget({ type: 'player', player: pid });
    }
    // post_modal_target: allow player targeting for damage/drain-type modes
    if (snap.waitingForInput?.type === 'post_modal_target' && snap.waitingForInput.playerId === 0) {
      const targetType = snap.waitingForInput.targetType;
      if (targetType === 'any' || targetType === 'player' || targetType === 'opponent') {
        setTargeting(null); // clear modal targeting arrow
        actions.resolvePostModalTarget({ type: 'player', player: pid });
      }
    }
  }

  // Handle double-click on battlefield cards → show ability modal or equip modal
  function handleDoubleClick(card: any) {
    if (!snap) return;
    const phase = snap.phase;
    const wiType = snap.waitingForInput?.type;
    const isInstantWindow = wiType === 'instant_priority' || wiType === 'stack_priority' || wiType === 'trigger_priority';
    // Allow activation on your turn (main phases) OR during instant windows (even on opponent's turn)
    if (snap.activePlayer !== 0 && !isInstantWindow) return;
    if (phase !== 'main1' && phase !== 'main2' && !isInstantWindow) return;
    const gs = gsRef.current;
    if (!gs) return;

    // Clarion Conqueror: block activation of artifacts/creatures/planeswalkers while lock is active
    const tl = (card.type_line || '').toLowerCase();
    const isLockableType = tl.includes('artifact') || tl.includes('creature') || tl.includes('planeswalker');
    if (isLockableType) {
      const locked = gs.players?.some((p: any) =>
        p.zones.battlefield.cards.some((c: any) => c._preventActivatedAbilities)
      );
      if (locked) {
        addToast('Habilidades ativadas estão bloqueadas (Clarion Conqueror)', 'warning');
        return;
      }
    }

    // Equipment: show creature picker to attach to
    if ((card.type_line || '').includes('Equipment')) {
      // Extract equip cost from oracle text (e.g. "Equip {1}{R}")
      const equipMatch = (card.oracle_text || '').match(/[Ee]quip\s+((?:\{[^}]+\})+)/);
      const equipCost = equipMatch ? equipMatch[1] : '';
      setEquipModal({ equipUid: card._uid, equipName: card.name, equipCost });
      return;
    }

    // Granted activated abilities (e.g. "{5}: Untap this creature" from aura)
    if (card._grantedActivated && card._grantedActivated.length > 0) {
      const grantedAbilities = card._grantedActivated.map((ab: any, idx: number) => ({
        cost: `{${ab.cost}}`,
        text: ab.effect === 'untap_self' ? `{${ab.cost}}: Untap this creature` : `{${ab.cost}}: Activate ability`,
        _grantedIdx: idx,
      }));
      setAbilityModal({ card, abilities: grantedAbilities, isGranted: true });
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
      const harmonizeCost = (card as any)._harmonizeGranted || /[Hh]armonize\s+\{/.test(card.oracle_text || '');
      if (harmonizeCost) actions.castHarmonize(card._uid);
    });
  }

  // Handle activating an ability from the ability modal
  function handleActivateAbility(cardUid: string, abilityIdx: number, card: any, xValue?: number) {
    if ((abilityModal as any)?.isGranted) {
      const ab = card._grantedActivated?.[abilityIdx];
      if (ab) actions.activateGrantedAbility(cardUid, abilityIdx);
      setAbilityModal(null);
      return;
    }
    const isPlaneswalker = card.type_line?.includes('Planeswalker');
    if (isPlaneswalker) {
      actions.activateLoyaltyAbility(cardUid, abilityIdx);
    } else {
      actions.activateBattlefieldAbility(cardUid, abilityIdx, xValue);
    }
  }

  // ── Floating mana pip on land tap / auto-tap ────────────────────────────────
  function spawnManaFloat(landCard: any) {
    const colors = getLandManaColors(landCard);
    const color = colors[0] || 'C';
    _spawnManaFloatAt(landCard._uid, color);
  }

  function _spawnManaFloatAt(uid: string, color: string) {
    const el = document.querySelector(`[data-uid="${uid}"]`) as HTMLElement | null;
    let x = window.innerWidth * 0.5 + (Math.random() - 0.5) * 120;
    let y = window.innerHeight * 0.72;
    if (el) {
      const rect = el.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }
    const id = uid + '_' + Date.now() + '_' + Math.random();
    setFloatingManas(prev => [...prev, { id, color, x, y }]);
    setTimeout(() => setFloatingManas(prev => prev.filter(f => f.id !== id)), 850);
  }

  // Listen for auto-tap mana:float events from the engine
  useEffect(() => {
    const handler = (e: Event) => {
      const { uid, color } = (e as CustomEvent).detail;
      if (uid && color) _spawnManaFloatAt(uid, color);
    };
    window.addEventListener('mana:float', handler);
    return () => window.removeEventListener('mana:float', handler);
  }, []);

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
  const isInstantPriorityHuman = wi?.playerId === 0 && (wi?.type === 'instant_priority' || wi?.type === 'stack_priority' || wi?.type === 'trigger_priority');
  // humanHasPriority: only show playable glow when spells can actually be cast
  // (main phase or instant/stack/trigger priority window — NOT during declare_blockers, scry, discard, etc.)
  const humanHasPriority = isMainPhaseHuman || isInstantPriorityHuman;
  // humanIsActive: broader flag — any state where the human must interact (used to dim unplayable cards)
  // This includes declare_attackers, declare_blockers, scry, etc. so hand cards always appear dimmed
  // instead of neutral (neutral looks "playable" to the user)
  const humanIsActive = isMainPhaseHuman || wi?.playerId === 0;
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

  // Always use the engine's getPlayableCards result (via humanPlayableUids in snapshot).
  // It handles ALL conditions: target validation, behold requirements, conditional flash,
  // attacking/blocking targets, cost reductions (Bell-Ringer, etc.), phase gating.
  const engineDataAvailable = (snap as any).humanPlayableUids !== undefined;
  const enginePlayableUids: Set<string> = (snap as any).humanPlayableUids || new Set();

  const playableSet = new Set<string>(
    humanHasPriority
      ? p0.hand
          .filter((c: any) => {
            // Prefer engine result — handles ALL edge cases correctly
            if (engineDataAvailable) return enginePlayableUids.has(c._uid);
            // Fallback if engine hasn't computed (should not normally happen)
            const isLand = (c.type_line || '').toLowerCase().includes('land');
            if (isInstantPriorityHuman) {
              if (!cardIsInstantSpeed(c)) return false;
              if ((c.cmc ?? 0) > totalAvailableMana) return false;
              const cost = c.mana_cost || '';
              return !cost || canPay(colorPool as ManaPool, cost, c.cmc ?? 0);
            }
            if (isLand) return !landPlayedThisTurn;
            const cost = c.mana_cost || '';
            const mainAffordable = (c.cmc ?? 0) <= totalAvailableMana && (!cost || canPay(colorPool as ManaPool, cost, c.cmc ?? 0));
            if (mainAffordable) return true;
            if (c.layout === 'adventure' && c.back_face?.mana_cost) {
              const advCost = c.back_face.mana_cost;
              const advCmc = (advCost.match(/\{[^}]+\}/g) || []).reduce((s: number, t: string) => {
                const sym = t.slice(1, -1);
                return s + (/^\d+$/.test(sym) ? parseInt(sym, 10) : sym === 'X' ? 0 : 1);
              }, 0);
              if (advCmc <= totalAvailableMana && canPay(colorPool as ManaPool, advCost, advCmc)) return true;
            }
            return false;
          })
          .map((c: any) => c._uid)
      : []
  );

  // Track which cards are omen/adventure playable only (not main face)
  const omenOnlyPlayable = new Set<string>(
    humanHasPriority && !isInstantPriorityHuman
      ? p0.hand
          .filter((c: any) => {
            if (!playableSet.has(c._uid)) return false;
            if (c.layout !== 'adventure' || !c.back_face?.mana_cost) return false;
            // Is the main face NOT affordable?
            const cost = c.mana_cost || '';
            const mainAffordable = (c.cmc ?? 0) <= totalAvailableMana && (!cost || canPay(colorPool as ManaPool, cost, c.cmc ?? 0));
            return !mainAffordable;
          })
          .map((c: any) => c._uid)
      : []
  );

  // ── Mana autopay preview: compute which lands would be tapped for hovered card ──
  // Pure computation based on hand card cost vs available lands + pool.
  const autoTapPreviewUids = (() => {
    const wiType = snap?.waitingForInput?.type || '';
    if (!isMainPhaseHuman && !wiType.includes('priority')) return new Set<string>();

    let cost = '';
    let cmc = 0;

    if (hoveredHandCard) {
      const card = p0.hand.find((c: any) => c._uid === hoveredHandCard);
      if (!card || (card.type_line || '').toLowerCase().includes('land')) return new Set<string>();
      cost = card.mana_cost || '';
      cmc = card._effectiveCmc ?? card.cmc ?? 0;
    } else if (hoveredBfCard) {
      // For battlefield cards with activated abilities, preview the cheapest ability cost
      const card = p0.battlefield.find((c: any) => c._uid === hoveredBfCard);
      if (!card) return new Set<string>();
      const db = getPreprocessedEffects(card as any) || {};
      const abilities = db.activated || [];
      if (abilities.length === 0) return new Set<string>();
      // Find cheapest non-mana ability cost
      let cheapestCost = '';
      let cheapestCmc = Infinity;
      for (const ab of abilities) {
        const abCostStr = typeof ab.cost === 'string' ? ab.cost : String((ab.cost as any)?.mana || '');
        const abCmc = (abCostStr.match(/\{[^}]+\}/g) || []).reduce((sum: number, s: string) => {
          const inner = s.replace(/[{}]/g, '');
          if (/^\d+$/.test(inner)) return sum + parseInt(inner);
          if (/^[WUBRG]$/.test(inner)) return sum + 1;
          return sum;
        }, 0);
        if (abCmc > 0 && abCmc < cheapestCmc) { cheapestCost = abCostStr; cheapestCmc = abCmc; }
      }
      if (!cheapestCost) return new Set<string>();
      cost = cheapestCost;
      cmc = cheapestCmc;
    } else {
      return new Set<string>();
    }

    if (!cost || cmc === 0) return new Set<string>();

    // Build what's already in the pool
    const pool: Record<string, number> = { ...(p0.manaPool || {}) };

    // Parse colored and generic needs
    const colorNeeds: Record<string, number> = {};
    for (const m of cost.matchAll(/\{([WUBRG])\}/g)) {
      colorNeeds[m[1]] = (colorNeeds[m[1]] || 0) + 1;
    }
    let genericNeeded = cmc - Object.values(colorNeeds).reduce((s, v) => s + v, 0);

    // Subtract what pool already covers
    for (const color of Object.keys(colorNeeds)) {
      const fromPool = Math.min(pool[color] || 0, colorNeeds[color]);
      colorNeeds[color] -= fromPool;
      pool[color] = (pool[color] || 0) - fromPool;
    }
    const poolRemainder = Object.values(pool).reduce((s, v) => s + v, 0);
    genericNeeded = Math.max(0, genericNeeded - poolRemainder);

    const untapped = p0.battlefield.filter((c: any) =>
      (c.type_line || '').toLowerCase().includes('land') && !c._tapped
    );
    const willTap = new Set<string>();

    // First pass: tap for colored needs
    for (const [color, needed] of Object.entries(colorNeeds)) {
      let remaining = needed;
      for (const land of untapped) {
        if (remaining <= 0) break;
        if (willTap.has(land._uid)) continue;
        const colors = getLandManaColors(land);
        if (colors.includes(color)) { willTap.add(land._uid); remaining--; }
      }
    }

    // Second pass: tap for generic needs
    for (const land of untapped) {
      if (genericNeeded <= 0) break;
      if (willTap.has(land._uid)) continue;
      willTap.add(land._uid);
      genericNeeded--;
    }

    return willTap;
  })();

  // ── Game over ────────────────────────────────────────────────────────────────

  if (displayWinner !== null) {
    const opponentLabel = multiplayerMode ? (mpOpponentName || 'Oponente') : 'AI';
    const winnerMsg = displayWinner === 0 ? 'You win! 🎉' : `${opponentLabel} wins!`;
    return (
      <div className="game-over animate-fade-in">
        <div className="game-over-card glass">
          <h2 className={displayWinner === 0 ? 'win' : 'lose'}>{winnerMsg}</h2>
          <p>Turn {turn} · {p0.life} vs {p1.life} life</p>
          <div className="game-over-actions">
            {multiplayerMode ? (
              <button className="btn btn-gold" onClick={() => setScreen('online_lobby')}>Voltar ao Lobby</button>
            ) : (
              <button className="btn btn-gold" onClick={() => actions.restartGame()}>Play Again</button>
            )}
            <button className="btn" onClick={() => setScreen(multiplayerMode ? 'online_lobby' : 'deckbuilder')}>
              {multiplayerMode ? 'Trocar Deck' : 'Back to Deck'}
            </button>
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
          <div className="game-mulligan-overlay">
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
                  <CardImage card={card} size="large" />
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
    const youGoFirst = snap.startingPlayer === 0;
    return (
      <div className="game-screen animate-fade-in">
        <div className="game-mulligan-overlay">
          <h2>Opening Hand{mulligansTaken > 0 ? ` (Mulligan #${mulligansTaken})` : ''}</h2>
          <p style={{ marginBottom: 8, fontSize: '1.05em', color: youGoFirst ? '#ffd700' : '#aab' }}>
            {youGoFirst ? '🪙 You won the coin flip — you go first!' : '🪙 Opponent won the coin flip — they go first.'}
          </p>
          <div className="game-mulligan-hand">
            {p0.hand.map((card: any) => (
              <div key={card._uid} className="game-hand-card">
                <CardImage card={card} size="large" />
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
    <div className={`game-screen animate-fade-in${overlayMinimized ? ' overlay-minimized' : ''}`}>

      {/* ── Multiplayer: opponent disconnected overlay ── */}
      {multiplayerMode && !mpConnected && (
        <div className="mp-disconnect-overlay">
          <div className="mp-disconnect-panel glass">
            <div className="mp-disconnect-icon">⏳</div>
            <div className="mp-disconnect-title">Oponente desconectou</div>
            <div className="mp-disconnect-hint">Aguardando reconexão de {mpOpponentName || 'oponente'}...</div>
          </div>
        </div>
      )}

      {/* ── Multiplayer: chat sidebar ── */}
      {multiplayerMode && (
        <ChatSidebar
          myName={currentUser?.displayName || 'Você'}
          opponentName={mpOpponentName || 'Oponente'}
          isOpen={chatOpen}
          onToggle={() => { setChatOpen(v => !v); setUnreadChat(0); }}
          unreadCount={unreadChat}
          onRead={() => setUnreadChat(0)}
        />
      )}

      {/* ── Overlay minimize/restore floating button ── */}
      {overlayMinimized && (
        <button
          className="overlay-restore-btn"
          onClick={() => setOverlayMinimized(false)}
          title="Voltar ao modal"
        >↩ Voltar ao Modal</button>
      )}

      {/* ── Suspended Spells floating panel (right-center) ── */}
      {(() => {
        const suspended = snap.suspendedSpells || [];
        if (suspended.length === 0) return null;
        return (
          <div style={{
            position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
            zIndex: 50, display: 'flex', flexDirection: 'column', gap: '8px',
            padding: '8px', borderRadius: '8px',
            background: 'rgba(30,25,15,0.85)', border: '1px solid rgba(240,160,40,0.4)',
            backdropFilter: 'blur(4px)',
          }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(240,180,60,0.9)', textAlign: 'center', letterSpacing: '1px' }}>
              SUSPEND
            </div>
            {suspended.map((s: any, idx: number) => (
              <div key={idx} title={`${s.name} — ${s.timeCounters} turn(s) remaining`}
                style={{ position: 'relative', flexShrink: 0 }}>
                <img src={s.imageUrl} alt={s.name}
                  style={{
                    width: '68px', height: '95px', objectFit: 'cover', borderRadius: '5px', display: 'block',
                    boxShadow: '0 0 8px 2px rgba(240,160,40,0.5)',
                    border: `2px solid ${s.controllerId === 0 ? 'rgba(40,200,120,0.7)' : 'rgba(220,60,60,0.7)'}`,
                    filter: 'brightness(0.65)',
                  }}
                />
                <div style={{
                  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                  fontSize: '24px', fontWeight: 900, color: '#fff',
                  textShadow: '0 0 10px rgba(240,160,40,0.9), 0 2px 4px #000',
                }}>{s.timeCounters}</div>
                <div style={{
                  position: 'absolute', bottom: '2px', left: 0, right: 0,
                  textAlign: 'center', fontSize: '7px', fontWeight: 800,
                  color: '#fff', background: 'rgba(200,140,20,0.85)',
                  borderRadius: '0 0 4px 4px', padding: '1px 2px',
                }}>⏳ {s.timeCounters}T</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Opponent bar ── */}
      <div
        className="game-opp-bar"
        onMouseEnter={() => setShowOppTooltip(true)}
        onMouseLeave={() => setShowOppTooltip(false)}
        style={{ position: 'relative' }}
      >
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
          >☠ Graveyard: {p1.graveyard.length}</span>
          <span
            className="exile-click-zone"
            onClick={() => setExileOpen({ pid: 1 })}
          >✨ Ex: {p1.exile?.length || 0}</span>
          {(snap?.ringLevel?.[1] ?? 0) > 0 && (
            <span className="ring-level-badge" title={[
              'Lvl 1: Ring-bearer is legendary, can\'t be blocked by greater power',
              'Lvl 2: Ring-bearer has Menace',
              'Lvl 3: Ring-bearer has Ward {1}',
              'Lvl 4: Ring-bearer has Deathtouch',
            ].slice(0, snap!.ringLevel[1]).join(' · ')}>
              <img src={ringBearerImg} alt="Ring" style={{width:14,height:13,objectFit:'contain',verticalAlign:'middle',marginRight:3}} /> {snap!.ringLevel[1]}/4
            </span>
          )}
        </div>
        {activePlayer === 1 && <div className="game-active-indicator">AI thinking...</div>}
        {/* Opponent info tooltip */}
        {showOppTooltip && (() => {
          const oppLands = p1.battlefield.filter((c: any) => c.type_line?.includes('Land'));
          const oppUntappedLands = oppLands.filter((c: any) => !c._tapped).length;
          const oppCreatures = p1.battlefield.filter((c: any) => c.type_line?.includes('Creature')).length;
          const oppOther = p1.battlefield.filter((c: any) => !c.type_line?.includes('Land') && !c.type_line?.includes('Creature')).length;
          return (
            <div className="opp-info-tooltip">
              <div className="oit-row"><span className="oit-label">❤️ Life</span><span className="oit-val">{p1.life}</span></div>
              <div className="oit-row"><span className="oit-label">🃏 Hand</span><span className="oit-val">{p1.hand.length} cards</span></div>
              <div className="oit-row"><span className="oit-label">📚 Deck</span><span className="oit-val">{p1.libraryCount} cards</span></div>
              <div className="oit-row"><span className="oit-label">☠ Graveyard</span><span className="oit-val">{p1.graveyard.length} cards</span></div>
              <div className="oit-row"><span className="oit-label">🐉 Creatures</span><span className="oit-val">{oppCreatures}</span></div>
              <div className="oit-row"><span className="oit-label">🌲 Lands</span><span className="oit-val">{oppLands.length} ({oppUntappedLands} untapped)</span></div>
              {oppOther > 0 && <div className="oit-row"><span className="oit-label">✨ Other</span><span className="oit-val">{oppOther}</span></div>}
              {(snap?.ringLevel?.[1] ?? 0) > 0 && (() => {
                const lvl = snap!.ringLevel[1];
                const bearer = p1.battlefield.find((c: any) => c._uid === snap!.ringBearer[1]);
                const abilities = [
                  'Legendary, can\'t be blocked by greater power',
                  '+ Menace',
                  '+ Ward {1}',
                  '+ Deathtouch',
                ].slice(0, lvl).join(', ');
                return (
                  <>
                    <div className="oit-row"><span className="oit-label"><img src={ringBearerImg} alt="Ring" style={{width:12,height:11,objectFit:'contain',verticalAlign:'middle',marginRight:2}} /> Ring Lvl</span><span className="oit-val">{lvl}/4</span></div>
                    {bearer && <div className="oit-row"><span className="oit-label"><img src={ringBearerImg} alt="Ring" style={{width:12,height:11,objectFit:'contain',verticalAlign:'middle',marginRight:2}} /> Bearer</span><span className="oit-val">{bearer.name}</span></div>}
                    <div className="oit-row"><span className="oit-label" style={{fontSize:10}}>Ring</span><span className="oit-val" style={{fontSize:10,color:'#fcd34d'}}>{abilities}</span></div>
                  </>
                );
              })()}
            </div>
          );
        })()}
      </div>

      {/* ── Opponent battlefield ── */}
      <div className="game-opp-bf">
        {/* ── Zone cluster do oponente: Grimório + Cemitério ── */}
        {(() => {
          const CARD_BACK = sleeveArt || 'https://backs.scryfall.io/large/59/482d0001-547e-4a13-a0f7-451e2a1b5940.jpg';
          const gyCards: any[] = p1.graveyard || [];
          const topGyCard = gyCards.length > 0 ? gyCards[gyCards.length - 1] : null;
          return (
            <div className="zone-cluster zone-cluster-opp">
              {/* Opponent library — top-left corner */}
              <div className="library-zone-visual" title={`Library: ${p1.libraryCount} cards`}>
                <span className="zone-count-badge">{p1.libraryCount}</span>
                <div className="library-card-stack">
                  <img className="lib-card lib-card-3" src={CARD_BACK} alt="deck" />
                  <img className="lib-card lib-card-2" src={CARD_BACK} alt="deck" />
                  <img className="lib-card lib-card-1" src={CARD_BACK} alt="deck" />
                </div>
              </div>
              {/* Opponent graveyard */}
              <div
                className="gy-zone-visual"
                onClick={() => setGraveyardOpen({ pid: 1 })}
                title={`Graveyard: ${gyCards.length} card${gyCards.length !== 1 ? 's' : ''}`}
              >
                <span className="zone-count-badge">{gyCards.length}</span>
                {topGyCard ? (
                  <>
                    <img
                      className="gy-zone-card"
                      src={getLandArtUrl(topGyCard) || topGyCard.image_normal || topGyCard.image_small}
                      alt={topGyCard.name}
                      onError={e => { (e.currentTarget as HTMLImageElement).src = CARD_BACK; }}
                    />
                    {gyCards.length > 1 && <div className="gy-zone-stack-hint" />}
                  </>
                ) : (
                  <div className="gy-zone-empty">
                    <span className="gy-zone-empty-icon">☠</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {p1.battlefield.length === 0
          ? <span className="game-bf-empty">Opponent battlefield</span>
          : (() => {
              // Sort: regular permanents first, planeswalkers last (right side)
              const nonLands = p1.battlefield
                .filter((c: any) => !c.type_line?.includes('Land') && !c._attachedTo)
                .sort((a: any, b: any) => {
                  // Creatures → Planeswalkers → Artifacts → Enchantments → other
                  const typeOrder = (c: any) => {
                    const tl = (c.type_line || '').toLowerCase();
                    if (tl.includes('creature')) return 0;
                    if (tl.includes('planeswalker')) return 1;
                    if (tl.includes('artifact')) return 2;
                    if (tl.includes('enchantment')) return 3;
                    return 4;
                  };
                  return typeOrder(a) - typeOrder(b);
                });
              const lands = p1.battlefield.filter((c: any) => c.type_line?.includes('Land') && !c._attachedTo);
              // Build uid→card map for resolving attachment UIDs
              const p1BfMap = new Map(p1.battlefield.map((c: any) => [c._uid, c]));
              const makeCard = (card: any) => {
                const _stepFilter = targeting?.steps && targeting.step ? targeting.steps[targeting.step - 1]?.side : undefined;
                const validTgts = targeting ? getValidTargets(targeting.card, _stepFilter) : [];
                // Saga choose_target: highlight valid targets
                const isSagaChoose = snap.waitingForInput?.type === 'choose_target' && snap.waitingForInput.playerId === 0;
                const sagaPending = isSagaChoose ? gsRef.current?._pendingSagaChapter : null;
                const isSagaTarget = !!(sagaPending && sagaPending.effects?.some((eff: any) => {
                  const t = (eff.target || '') as string;
                  if (t === 'nonland_permanent') return !card.type_line?.includes('Land');
                  if (t === 'creature') return card.type_line?.includes('Creature');
                  if (t === 'opponent_creature') return card.type_line?.includes('Creature');
                  if (t === 'own_creature') return card.type_line?.includes('Creature');
                  if (t === 'artifact') return card.type_line?.includes('Artifact');
                  if (t === 'enchantment') return card.type_line?.includes('Enchantment');
                  return false;
                }));
                // post_modal_target: highlight valid targets on opponent battlefield
                const isPostModalTgt = wi?.type === 'post_modal_target' && wi.playerId === 0;
                const isPostModalValidOpp = (() => {
                  if (!isPostModalTgt) return false;
                  // Hexproof/shroud/protection: opponent's protected creatures can't be targeted
                  const _ckws = ((card.keywords || []) as string[]).map(k => (k || '').toLowerCase());
                  const _ctKws = ((card._tempKeywords || []) as any[]).map((tk: any) => (typeof tk === 'string' ? tk : tk.keyword || '').toLowerCase());
                  const _cgKws = ((card._grantedKeywords || []) as string[]).map((g: string) => (g || '').toLowerCase());
                  const _hex = _ckws.includes('hexproof') || (card._hexproofUntilDamage && !card._hasDealtDamage) ||
                    (card._counters?.hexproof > 0) || (card._counters?.Hexproof > 0) ||
                    _ctKws.includes('hexproof') || _cgKws.includes('hexproof');
                  if (_hex || _ckws.includes('shroud')) return false;
                  // Protection from color
                  const _allKws2 = [..._ckws, ..._ctKws, ..._cgKws];
                  const _cm2: Record<string, string> = { 'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G' };
                  const _pc2: string[] = [];
                  for (const kw of _allKws2) { const pm = kw.match(/protection from (.+)/); if (pm) { for (const pt of pm[1].split(/\s+and\s+(?:from\s+)?/)) { const cl = _cm2[pt.trim()]; if (cl && !_pc2.includes(cl)) _pc2.push(cl); } } }
                  if (_pc2.length > 0) {
                    const _sc = gsRef.current?._pendingModalResolution?.card;
                    const _sm = _sc?.mana_cost || '';
                    const _sclrs: string[] = [];
                    if (_sm.includes('W')) _sclrs.push('W'); if (_sm.includes('U')) _sclrs.push('U');
                    if (_sm.includes('B')) _sclrs.push('B'); if (_sm.includes('R')) _sclrs.push('R');
                    if (_sm.includes('G')) _sclrs.push('G');
                    if (_sclrs.some(c => _pc2.includes(c))) return false;
                  }
                  const tt = wi.targetType;
                  const tl = (card.type_line || '').toLowerCase();
                  if (tt === 'opponent_creature') return tl.includes('creature');
                  if (tt === 'creature' || tt === 'any') return tl.includes('creature');
                  if (tt === 'creature_or_planeswalker' || tt === 'opponent_creature_or_planeswalker') return tl.includes('creature') || tl.includes('planeswalker');
                  if (tt === 'enchantment') return tl.includes('enchantment');
                  if (tt === 'artifact') return tl.includes('artifact');
                  if (tt === 'artifact_or_enchantment' || tt === 'opponent_artifact_or_enchantment') return tl.includes('artifact') || tl.includes('enchantment');
                  if (tt === 'artifact_or_enchantment_or_flyer') { const hf = (card.keywords || []).some((k: any) => (typeof k === 'string' ? k : k?.keyword || '').toLowerCase() === 'flying'); return tl.includes('artifact') || tl.includes('enchantment') || (tl.includes('creature') && hf); }
                  if (tt === 'opponent_artifact_or_creature') return tl.includes('artifact') || tl.includes('creature');
                  if (tt === 'opponent_nonland') return !tl.includes('land');
                  if (tt === 'permanent') return !tl.includes('instant') && !tl.includes('sorcery');
                  if (tt === 'nonland_permanent') return !tl.includes('land');
                  if (tt === 'creature_with_flying') return tl.includes('creature') && ((card.keywords || []) as string[]).some(k => (k || '').toLowerCase() === 'flying');
                  if (tt === 'creature_without_flying') return tl.includes('creature') && !((card.keywords || []) as string[]).some(k => (k || '').toLowerCase() === 'flying');
                  if (tt === 'creature_power4+') return tl.includes('creature') && parseInt(card.power || '0', 10) >= 4;
                  if (tt === 'creature_or_enchantment') return tl.includes('creature') || tl.includes('enchantment');
                  if (tt === 'creature_or_artifact') return tl.includes('creature') || tl.includes('artifact');
                  // own_creature targets should NOT highlight opponent's creatures
                  if (tt === 'own_creature' || tt === 'own_nonlegendary_creature') return false;
                  return false;
                })();
                // etb_any_damage_target: highlight creatures as valid targets
                const isEtbDmgTarget = wi?.type === 'etb_any_damage_target' && wi.playerId === 0;
                const isEtbDmgValid = isEtbDmgTarget && (card.type_line || '').toLowerCase().includes('creature');
                const isTapUntapChoose = wi?.type === 'tap_or_untap_choose' && (wi.choices || []).some((c: any) => c._uid === card._uid);
                const isTargetable = !!(targeting &&
                  validTgts.some((t: any) => (t.type === 'creature' || t.type === 'permanent') && t.uid === card._uid)) || !!isSagaTarget || isPostModalValidOpp || !!isEtbDmgValid || isTapUntapChoose;
                const isNotTargetable = !!(targeting && !isTargetable && validTgts.length > 0) || !!(isSagaChoose && !isSagaTarget) || !!(isPostModalTgt && !isPostModalValidOpp) || !!(isEtbDmgTarget && !isEtbDmgValid);
                const isBlockingTarget = !!(snap.waitingForInput?.type === 'declare_blockers' &&
                  blockingWith.length > 0 && card._attacking);
                // Show "being attacked" glow on a PW that is currently targeted by an attacker
                const isAttackTarget = !!(card.type_line?.includes('Planeswalker') &&
                  combat.attackers.some((a: any) => a.attackTarget === card._uid));
                // Resolve attachment card objects (equipment/auras — may come from either player's BF)
                const p0BfMapForOpp = new Map(p0.battlefield.map((c: any) => [c._uid, c]));
                const attachmentCards = (card._attachments || [])
                  .map((uid: string) => p1BfMap.get(uid) || p0BfMapForOpp.get(uid)).filter(Boolean);
                // Cards exiled by this permanent (e.g. Banishing Light)
                const exiledCards = card._exiledCards || [];
                // Compute granted keywords from other permanents (e.g. Call the Spirit Dragons → indestructible)
                let grantedKws: Set<string> | undefined;
                if (card.type_line?.includes('Dragon')) {
                  const bf = snap.players[1].battlefield;
                  for (const g of bf) {
                    if (g._grantDragons) {
                      if (!grantedKws) grantedKws = new Set();
                      String(g._grantDragons).split(',').forEach((k: string) => {
                        const kw = k.trim();
                        grantedKws!.add(kw.charAt(0).toUpperCase() + kw.slice(1));
                      });
                    }
                  }
                }
                return (
                  <BattlefieldCard
                    key={card._uid}
                    card={card}
                    isAttacking={combat.attackers.some((a: any) => (typeof a === 'string' ? a : a.uid) === card._uid)}
                    isAttacker={false}
                    isTargetable={isTargetable || isAttackTarget}
                    isNotTargetable={isNotTargetable && !isAttackTarget}
                    isBlockingTarget={isBlockingTarget}
                    isRecentlyEntered={recentlyEntered.has(card._uid)}
                    isTriggerPulsing={triggerPulseUids.has(card._uid)}
                    cantBlock={!!card._cantBlockThisTurn || !!card._cantBlockSagaUid}
                    overrideArtUrl={getLandArtUrl(card)}
                    attachmentCards={attachmentCards}
                    exiledCards={exiledCards}
                    grantedKeywords={grantedKws}
                    isRingBearer={snap?.ringBearer?.[1] === card._uid}
                    onAttachmentTargetClick={(a) => {
                      const tl = (a.type_line || '').toLowerCase();
                      if (targeting || wi?.type === 'post_modal_target') handleCardClick(a, a._ownerId ?? 1);
                      else setZoom(a);
                    }}
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
          {/* Full Control toggle */}
          <button
            className={`full-control-btn ${fullControl ? 'active' : ''}`}
            onClick={() => { fullControlRef.current = !fullControlRef.current; setFullControl(v => !v); }}
            title="Full Control (X) — Stop at each phase and choose trigger order"
          >
            FC
          </button>
          {/* My Turn Row */}
          {(() => {
            const displayPhases = PHASES.filter(p => !['mulligan', 'untap', 'cleanup'].includes(p.key));
            return (
              <>
                <div className="phase-turn-row">
                  <div className={`phase-turn-label opp-turn${activePlayer === 1 ? ' active-turn' : ''}`}>OPP</div>
                  {displayPhases.map((p) => {
                    const fullIdx = PHASES.findIndex(x => x.key === p.key);
                    const isActive = activePlayer === 1 && p.key === phase;
                    const isDone = activePlayer === 1 && phaseIdx > fullIdx;
                    const isStopped = oppStopPhases.has(p.key);
                    return (
                      <div key={`opp-${p.key}`} className={`game-phase-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`} title={p.tip}>
                        {p.label}
                        <span
                          className={`phase-stop-btn ${isStopped ? 'active' : ''}`}
                          title={isStopped ? 'Remove stop (opponent turn)' : 'Stop here (opponent turn)'}
                          onClick={e => { e.stopPropagation(); toggleOppStopPhase(p.key); }}
                        >⏸</span>
                      </div>
                    );
                  })}
                </div>
                <div className="phase-turn-row">
                  <div className={`phase-turn-label my-turn${activePlayer === 0 ? ' active-turn' : ''}`}>ME</div>
                  {displayPhases.map((p) => {
                    const fullIdx = PHASES.findIndex(x => x.key === p.key);
                    const isActive = activePlayer === 0 && p.key === phase;
                    const isDone = activePlayer === 0 && phaseIdx > fullIdx;
                    const isStopped = myStopPhases.has(p.key);
                    return (
                      <div key={`my-${p.key}`} className={`game-phase-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`} title={p.tip}>
                        {p.label}
                        <span
                          className={`phase-stop-btn ${isStopped ? 'active' : ''}`}
                          title={isStopped ? 'Remove stop (my turn)' : 'Stop here (my turn)'}
                          onClick={e => { e.stopPropagation(); toggleMyStopPhase(p.key); }}
                        >⏸</span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>

        {/* Turn/Stack info */}
        <div className="game-center-info">
          <span className="game-turn">Turn {turn}</span>
          {stackSize > 0 && (
            <div className="game-stack-indicator" onClick={() => setShowStack(v => !v)}>
              Stack: {stackSize}
              {showStack && (
                <div className="stack-panel glass" onClick={e => e.stopPropagation()}>
                  {((snap as any).stackItems || []).slice().reverse().map((item: any, i: number) => (
                    <div key={i} className="stack-item">
                      {item.imageUrl && <img src={item.imageUrl} alt="" className="stack-item-img" />}
                      <div className="stack-item-info">
                        <div className="stack-item-name">{item.cardName}</div>
                        <div className="stack-item-type">
                          {item.controller === 0 ? 'You' : 'Opponent'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="game-actions">
            {/* Trigger notification toggle */}
            <button
              className={`btn btn-sm ${slowTriggers ? 'btn-gold' : 'btn-muted'}`}
              style={{ fontSize: 11, padding: '1px 7px' }}
              onClick={() => setSlowTriggers(v => !v)}
              title={slowTriggers ? 'Notificações de trigger: LIGADAS (clique para desligar)' : 'Notificações de trigger: DESLIGADAS (clique para ligar)'}
            >{slowTriggers ? '🔔 Triggers' : '🔕 Auto'}</button>
            {/* Quick settings button */}
            <button
              className="btn btn-muted btn-sm"
              style={{ fontSize: 11, padding: '1px 7px', opacity: 0.8 }}
              onClick={() => setShowQuickSettings(v => !v)}
              title="Configurações rápidas"
            >⚙</button>
            {/* Keyboard help button */}
            <button
              className="btn btn-muted btn-sm"
              style={{ fontSize: 11, padding: '1px 7px', opacity: 0.6 }}
              onClick={() => setShowHelpModal(true)}
              title="Atalhos de teclado (?)"
            >?</button>
            {/* Restart button */}
            <button
              className="btn btn-muted btn-sm"
              style={{ fontSize: 11, padding: '1px 7px', opacity: 0.7 }}
              onClick={() => { if (confirm('Reiniciar partida com o mesmo deck?')) actions.restartGame(); }}
              title="Reiniciar com o mesmo deck"
            >↩ Restart</button>
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
                      if ((!c.type_line?.includes('Creature') && !(c as any)._vehicleActive) || c._tapped) return false;
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

            <button className={`btn btn-muted ${showLog ? 'active' : ''}`} onClick={() => setShowLog(v => !v)} style={{ position: 'relative', zIndex: 70 }}>
              Log (L)
            </button>
          </div>
        </div>

        {/* Mana pool */}
        {(myMana.length > 0 || canUndoMana) && (
          <div className="game-mana-pool">
            {myMana.flatMap(([color, count]) =>
              Array.from({ length: count as number }, (_, i) => (
                MANA_IMAGES[color]
                  ? <img key={`${color}_${i}`} src={MANA_IMAGES[color]} alt={color}
                      className="mana-pool-pip" title={`${color} mana`} />
                  : <div key={`${color}_${i}`} className={`mana-pool-pip mana-pool-${color}`}>
                      {color === 'C' ? '◇' : color}
                    </div>
              ))
            )}
            {canUndoMana && humanHasPriority && (
              <button
                className="btn-undo-mana"
                onClick={() => actions.undoTapLand()}
                title={`Desfazer tap de terreno (${undoManaCount} tapado${undoManaCount !== 1 ? 's' : ''})`}
              >↩ Undo {undoManaCount > 1 ? `(${undoManaCount})` : ''}</button>
            )}
          </div>
        )}
      </div>

      {/* ── Pending temp triggers indicator (Dalkovan Encampment etc.) ── */}
      {(() => {
        const triggers = (snap as any)?._tempTriggers || [];
        const myTriggers = triggers.filter((t: any) => t.controller === 0);
        if (myTriggers.length === 0) return null;
        return (
          <div style={{
            position: 'absolute', bottom: 160, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(40,120,60,0.92)', color: '#fff', padding: '4px 14px',
            borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 50,
            display: 'flex', gap: 8, alignItems: 'center', pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}>
            <span>⚡</span>
            {myTriggers.map((t: any, i: number) => {
              const desc = t.event === 'attacks'
                ? `Ao atacar: cria ${t.effects?.[0]?.count || '?'} ${t.effects?.[0]?.name || 'token'}(s)`
                : `Trigger pendente: ${t.event}`;
              return <span key={i}>{desc}</span>;
            })}
          </div>
        );
      })()}

      {/* ── My battlefield ── */}
      <div
        className={`game-my-bf playmat-${playmat}`}
        style={
          playmat === 'custom' && playmatArt ? {
            backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url('${playmatArt}')`,
            backgroundSize: playmatSize > 0 ? `${playmatSize}%` : 'cover',
            backgroundPosition: playmatPosition || '50% 50%',
            backgroundRepeat: 'no-repeat',
            backgroundColor: '#000',
          } : playmat !== 'default' ? {
            backgroundSize: playmatSize > 0 ? `${playmatSize}%` : 'cover',
            backgroundPosition: playmatPosition || '50% 50%',
            backgroundRepeat: 'no-repeat',
            backgroundColor: '#000',
          } : undefined
        }
      >
        {/* Battlefield contents only (zone cluster moved to bottom row) */}

        {p0.battlefield.length === 0
          ? <span className="game-bf-empty">Your battlefield</span>
          : (() => {
              const nonLands = p0.battlefield
                .filter((c: any) => !c.type_line?.includes('Land') && !c._attachedTo)
                .sort((a: any, b: any) => {
                  // Creatures → Planeswalkers → Artifacts → Enchantments → other
                  const typeOrder = (c: any) => {
                    const tl = (c.type_line || '').toLowerCase();
                    if (tl.includes('creature')) return 0;
                    if (tl.includes('planeswalker')) return 1;
                    if (tl.includes('artifact')) return 2;
                    if (tl.includes('enchantment')) return 3;
                    return 4;
                  };
                  return typeOrder(a) - typeOrder(b);
                });
              const lands = p0.battlefield.filter((c: any) => c.type_line?.includes('Land') && !c._attachedTo);
              // Build uid→card map for resolving attachment UIDs
              const p0BfMap = new Map(p0.battlefield.map((c: any) => [c._uid, c]));
              // Compute cumulative toughness for Betor tracker
              const hasBetorOnBf = p0.battlefield.some((c: any) => (c.name || '').toLowerCase() === 'betor, kin to all');
              const myTotalToughness = hasBetorOnBf
                ? p0.battlefield.filter((c: any) => c.type_line?.includes('Creature')).reduce((sum: number, c: any) => {
                    const base = parseInt(c.toughness);
                    if (isNaN(base)) return sum;
                    const mod = (c._counters?.['+1/+1'] ?? 0) - (c._counters?.['-1/-1'] ?? 0);
                    return sum + base + (c._toughnessMod ?? 0) + mod;
                  }, 0)
                : undefined;
              const makeCard = (card: any) => {
                const _stepFilter2 = targeting?.steps && targeting.step ? targeting.steps[targeting.step - 1]?.side : undefined;
                const _ownValidTgts2 = targeting ? getValidTargets(targeting.card, _stepFilter2) : [];
                // Saga choose_target: highlight valid targets on own battlefield too
                const isSagaChoose2 = snap.waitingForInput?.type === 'choose_target' && snap.waitingForInput.playerId === 0;
                const sagaPending2 = isSagaChoose2 ? gsRef.current?._pendingSagaChapter : null;
                const isSagaTarget2 = !!(sagaPending2 && sagaPending2.effects?.some((eff: any) => {
                  const t = (eff.target || '') as string;
                  if (t === 'nonland_permanent') return !card.type_line?.includes('Land');
                  if (t === 'creature') return card.type_line?.includes('Creature');
                  if (t === 'own_creature') return card.type_line?.includes('Creature');
                  if (t === 'artifact') return card.type_line?.includes('Artifact');
                  if (t === 'enchantment') return card.type_line?.includes('Enchantment');
                  return false;
                }));
                // post_modal_target: highlight valid targets on own battlefield
                const isPostModalTarget = wi?.type === 'post_modal_target' && wi.playerId === 0;
                const isPostModalValid = (() => {
                  if (!isPostModalTarget) return false;
                  const tt = wi.targetType;
                  const tl = (card.type_line || '').toLowerCase();
                  if (tt === 'creature' || tt === 'any') return tl.includes('creature');
                  if (tt === 'own_creature') return tl.includes('creature');
                  if (tt === 'own_nonlegendary_creature') return tl.includes('creature') && !tl.includes('legendary');
                  if (tt === 'artifact') return tl.includes('artifact');
                  if (tt === 'enchantment') return tl.includes('enchantment');
                  if (tt === 'permanent') return !tl.includes('instant') && !tl.includes('sorcery');
                  if (tt === 'nonland_permanent') return !tl.includes('land');
                  if (tt === 'artifact_or_enchantment' || tt === 'opponent_artifact_or_enchantment') return tl.includes('artifact') || tl.includes('enchantment');
                  if (tt === 'artifact_or_enchantment_or_flyer') { const hf3 = (card.keywords || []).some((k: any) => (typeof k === 'string' ? k : k?.keyword || '').toLowerCase() === 'flying'); return tl.includes('artifact') || tl.includes('enchantment') || (tl.includes('creature') && hf3); }
                  if (tt === 'opponent_artifact_or_creature') return tl.includes('artifact') || tl.includes('creature');
                  if (tt === 'opponent_nonland') return !tl.includes('land');
                  if (tt === 'creature_or_planeswalker') return tl.includes('creature') || tl.includes('planeswalker');
                  if (tt === 'creature_or_enchantment') return tl.includes('creature') || tl.includes('enchantment');
                  if (tt === 'creature_or_artifact') return tl.includes('creature') || tl.includes('artifact');
                  if (tt === 'creature_with_flying') return tl.includes('creature') && ((card.keywords || []) as string[]).some(k => (k || '').toLowerCase() === 'flying');
                  if (tt === 'creature_without_flying') return tl.includes('creature') && !((card.keywords || []) as string[]).some(k => (k || '').toLowerCase() === 'flying');
                  if (tt === 'creature_power4+') return tl.includes('creature') && parseInt(card.power || '0', 10) >= 4;
                  return false;
                })();
                // etb_any_damage_target: highlight creatures on own BF too (can target any creature)
                const isEtbDmgTarget2 = wi?.type === 'etb_any_damage_target' && wi.playerId === 0;
                const isEtbDmgValid2 = isEtbDmgTarget2 && (card.type_line || '').toLowerCase().includes('creature');
                const isTapUntapChooseOwn = wi?.type === 'tap_or_untap_choose' && (wi.choices || []).some((c: any) => c._uid === card._uid);
                const isTargetable = !!(targeting &&
                  _ownValidTgts2.some((t: any) => (t.type === 'creature' || t.type === 'permanent') && t.uid === card._uid)) || !!isSagaTarget2 || isPostModalValid || !!isEtbDmgValid2 || isTapUntapChooseOwn;
                const isNotTargetable2 = !!(targeting && !isTargetable && _ownValidTgts2.length > 0) || !!(isSagaChoose2 && !isSagaTarget2) || !!(isPostModalTarget && !isPostModalValid) || !!(isEtbDmgTarget2 && !isEtbDmgValid2);
                const isAssignedBlocker = !!(card._blocking);
                const isSelectedBlocker = blockingWith.includes(card._uid);
                const canActivatePW = !!(
                  card.type_line?.includes('Planeswalker') &&
                  isMainPhaseHuman &&
                  !card._loyaltyUsedThisTurn &&
                  !snap.stackSize
                );
                // Resolve attachment card objects (equipment/auras — may come from either player's BF)
                const p1BfMapForOwn = new Map(p1.battlefield.map((c: any) => [c._uid, c]));
                const attachmentCards = (card._attachments || [])
                  .map((uid: string) => p0BfMap.get(uid) || p1BfMapForOwn.get(uid)).filter(Boolean);
                // Cards exiled by this permanent (e.g. Banishing Light)
                const exiledCards = card._exiledCards || [];
                const isBetor = (card.name || '').toLowerCase() === 'betor, kin to all';
                // Compute granted keywords from other permanents
                let grantedKws0: Set<string> | undefined;
                if (card.type_line?.includes('Dragon')) {
                  const bf = snap.players[0].battlefield;
                  for (const g of bf) {
                    if (g._grantDragons) {
                      if (!grantedKws0) grantedKws0 = new Set();
                      String(g._grantDragons).split(',').forEach((k: string) => {
                        const kw = k.trim();
                        grantedKws0!.add(kw.charAt(0).toUpperCase() + kw.slice(1));
                      });
                    }
                  }
                }
                return (
                  <div key={card._uid} onMouseEnter={() => setHoveredBfCard(card._uid)} onMouseLeave={() => setHoveredBfCard(null)}>
                  <BattlefieldCard
                    card={card}
                    isAttacking={combat.attackers.some((a: any) => (typeof a === 'string' ? a : a.uid) === card._uid)}
                    isAttacker
                    isTargetable={isTargetable}
                    isNotTargetable={isNotTargetable2}
                    isAssignedBlocker={isAssignedBlocker}
                    isSelectedBlocker={isSelectedBlocker}
                    canActivate={canActivatePW}
                    overrideArtUrl={getLandArtUrl(card)}
                    isAutoTapPreview={autoTapPreviewUids.has(card._uid)}
                    isRecentlyEntered={recentlyEntered.has(card._uid)}
                    isTriggerPulsing={triggerPulseUids.has(card._uid)}
                    cantBlock={!!card._cantBlockThisTurn || !!card._cantBlockSagaUid}
                    attachmentCards={attachmentCards}
                    exiledCards={exiledCards}
                    grantedKeywords={grantedKws0}
                    betorToughnessTotal={isBetor ? myTotalToughness : undefined}
                    isRingBearer={snap?.ringBearer?.[0] === card._uid}
                    onAttachmentTargetClick={(a) => {
                      if (targeting || wi?.type === 'post_modal_target') handleCardClick(a, a._ownerId ?? 0);
                      else setZoom(a);
                    }}
                    onClick={c => handleCardClick(c, 0)}
                    onDoubleClick={c => handleDoubleClick(c)}
                    onRightClick={c => setZoom(c)}
                  />
                  </div>
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
          >☠ Graveyard: {p0.graveyard.length}</span>
          <span
            className="exile-click-zone"
            onClick={() => setExileOpen({ pid: 0 })}
          >✨ Ex: {p0.exile?.length || 0}</span>
          {(snap?.ringLevel?.[0] ?? 0) > 0 && (
            <span className="ring-level-badge" title={[
              'Lvl 1: Ring-bearer is legendary, can\'t be blocked by greater power',
              'Lvl 2: Ring-bearer has Menace',
              'Lvl 3: Ring-bearer has Ward {1}',
              'Lvl 4: Ring-bearer has Deathtouch',
            ].slice(0, snap!.ringLevel[0]).join(' · ')}>
              <img src={ringBearerImg} alt="Ring" style={{width:14,height:13,objectFit:'contain',verticalAlign:'middle',marginRight:3}} /> {snap!.ringLevel[0]}/4
            </span>
          )}
          {activePlayer === 0 && <div className="game-active-indicator mine">Your turn</div>}
        </div>
        {/* Hand + sidebars in the same row */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div className="game-hand">
            {p0.hand.map((card: any) => {
              const isPlayable = playableSet.has(card._uid);
              const isOmenMode = omenOnlyPlayable.has(card._uid);
              const advFace = card.back_face;
              const omenLabel = advFace?.type_line?.toLowerCase().includes('omen') ? 'Omen' : 'Adv';
              const isHovered = hoveredHandCard === card._uid;
              const isCreatureCard = card.type_line?.includes('Creature');
              const cardPow = isCreatureCard ? parseInt(card.power) || 0 : null;
              const cardTou = isCreatureCard ? parseInt(card.toughness) || 0 : null;
              const cyclingAbility = parseCyclingAbility(card as any);
              const canCycleNow = cyclingAbility && isMainPhaseHuman && wi?.type === 'main_phase';
              return (
                <div
                  key={card._uid}
                  data-uid={card._uid}
                  className={`game-hand-card ${isPlayable ? 'hand-playable' : 'hand-unplayable'} ${newHandUids.has(card._uid) ? 'hand-draw-in' : ''}`}
                  onClick={() => handleCardClick(card, 0)}
                  onContextMenu={e => { e.preventDefault(); setZoom(card); }}
                  onMouseEnter={() => setHoveredHandCard(card._uid)}
                  onMouseLeave={() => setHoveredHandCard(null)}
                  style={{ position: 'relative' }}
                >
                  <CardImage card={card} size="small" overrideArtUrl={getLandArtUrl(card)} />
                  {isOmenMode && (
                    <div style={{
                      position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)',
                      background: 'rgba(78,205,196,0.9)', color: '#000', fontSize: '8px',
                      fontWeight: 700, padding: '1px 4px', borderRadius: 3, whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                    }}>✦ {omenLabel}</div>
                  )}
                  {/* ── Hand card hover tooltip ── */}
                  {isHovered && (
                    <div className="hand-card-tooltip" onMouseEnter={() => setHoveredHandCard(card._uid)}>
                      <div className="hct-name">{card.name}</div>
                      {card.mana_cost && (
                        <div className="hct-cost"><ManaCostPips cost={card.mana_cost} /></div>
                      )}
                      <div className="hct-type">{card.type_line}</div>
                      {isCreatureCard && cardPow !== null && (
                        <div className="hct-pt">{cardPow}/{cardTou}</div>
                      )}
                      {card.oracle_text && (
                        <div className="hct-oracle">{card.oracle_text.slice(0, 120)}{card.oracle_text.length > 120 ? '…' : ''}</div>
                      )}
                      {isOmenMode && (
                        <div className="hct-oracle" style={{ color: '#4ecdc4', borderTop: '1px solid rgba(78,205,196,0.3)', paddingTop: 3 }}>
                          ⬆ Creature · Right-click → Adventure
                        </div>
                      )}
                      {cyclingAbility && (
                        <div style={{ marginTop: 4, fontSize: 10, color: '#ffd700', borderTop: '1px solid rgba(255,215,0,0.3)', paddingTop: 3 }}>
                          Cycling {cyclingAbility.manaCost || `{${cyclingAbility.cost}}`}{cyclingAbility.searchType ? ` → ${cyclingAbility.searchType}` : ' → Draw'} · Click to cast or cycle
                        </div>
                      )}
                      {card.name?.toLowerCase() === "gandalf's sanction" && (
                        <div style={{ marginTop: 4, fontSize: 10, color: '#ffd700', borderTop: '1px solid rgba(255,215,0,0.3)', paddingTop: 3 }}>
                          Instants/sorceries in GY: {p0.graveyard.filter((c: any) => {
                            const tl = (c.type_line || '').toLowerCase();
                            return tl.includes('instant') || tl.includes('sorcery');
                          }).length}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* ── Harmonize sidebar ── (left of hand, visible during main phase) */}
          {(phase === 'main1' || phase === 'main2') && activePlayer === 0 && (() => {
            const harmonizeCards = p0.graveyard.filter((c: any) => {
              // Only show cards that actually HAVE harmonize cost (not cards that GRANT harmonize like Songcrafter Mage)
              return c._harmonizeGranted || /[Hh]armonize\s+\{/.test(c.oracle_text || '');
            });
            if (harmonizeCards.length === 0) return null;
            return (
              <div style={{
                order: 2,
                display: 'flex', flexDirection: 'row', gap: '6px',
                padding: '6px 8px', alignItems: 'center', flexShrink: 0,
                borderLeft: '2px solid rgba(255,255,255,0.15)',
              }}>
                {harmonizeCards.map((card: any) => {
                  const canCast = card._harmonizeCanCast !== false;
                  const hCost = card._harmonizeCost || '';
                  return (
                    <div
                      key={card._uid}
                      onClick={() => {
                        if (!canCast) return;
                        // Check for untapped creatures — offer creature selection for discount
                        const untappedCreatures = (snap.players[0].battlefield || []).filter(
                          (c: any) => c.type_line?.includes('Creature') && !c._tapped
                        );
                        if (untappedCreatures.length > 0) {
                          setHarmonizePending({ cardUid: card._uid });
                        } else if (spellNeedsTargeting(card)) {
                          // No creatures to tap but spell still needs a target
                          setHarmonizePending({ cardUid: card._uid, tappedUid: null });
                          setTargeting({ cardUid: card._uid, card, isHarmonize: true, harmonizeTappedUid: null });
                        } else {
                          actions.castHarmonize(card._uid);
                        }
                      }}
                      onContextMenu={e => { e.preventDefault(); setZoom(card); }}
                      title={`${card.name} (clique para ativar)`}
                      style={{ position: 'relative', cursor: canCast ? 'pointer' : 'default', flexShrink: 0, opacity: canCast ? 1 : 0.45 }}
                    >
                      <img
                        src={card.image_normal || card.image_small}
                        alt={card.name}
                        style={{ width: '72px', height: '100px', objectFit: 'cover', borderRadius: '6px', display: 'block',
                          boxShadow: canCast ? '0 0 8px 2px rgba(78,205,196,0.5)' : 'none',
                          border: `2px solid ${canCast ? 'rgba(78,205,196,0.6)' : 'rgba(255,255,255,0.15)'}` }}
                      />
                      {hCost && (
                        <div style={{
                          position: 'absolute', bottom: '3px', left: 0, right: 0,
                          display: 'flex', justifyContent: 'center', alignItems: 'center',
                          background: 'rgba(0,0,0,0.75)',
                          borderRadius: '0 0 4px 4px', padding: '2px 2px',
                        }}>
                          <ManaCostPips cost={formatRawMana(hCost)} size={11} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ── Renew sidebar ── (beside hand, graveyard abilities) */}
          {(phase === 'main1' || phase === 'main2') && activePlayer === 0 && (() => {
            const renewCards = (p0.graveyard || []).filter((c: any) =>
              c._graveyardAbilities && c._graveyardAbilities.length > 0
            );
            if (renewCards.length === 0) return null;
            return (
              <div style={{
                order: 1,
                display: 'flex', flexDirection: 'row', gap: '6px',
                padding: '6px 8px', alignItems: 'center', flexShrink: 0,
                borderLeft: '2px solid rgba(255,255,255,0.15)',
              }}>
                {renewCards.map((card: any) =>
                  card._graveyardAbilities.map((ab: any, abIdx: number) => {
                    const costMana = ab.cost?.mana || '';
                    return (
                      <div
                        key={card._uid + '-' + abIdx}
                        onClick={() => actions.activateGraveyardAbility(card._uid, abIdx)}
                        onContextMenu={e => { e.preventDefault(); setZoom(card); }}
                        title={`${card.name} (clique para ativar, clique direito para ver)`}
                        style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}
                      >
                        <img
                          src={card.image_normal || card.image_small}
                          alt={card.name}
                          style={{ width: '72px', height: '100px', objectFit: 'cover', borderRadius: '6px', display: 'block',
                            boxShadow: '0 0 8px 2px rgba(255,160,60,0.5)', border: '2px solid rgba(255,160,60,0.6)' }}
                        />
                        {costMana && (
                          <div style={{
                            position: 'absolute', bottom: '3px', left: 0, right: 0,
                            display: 'flex', justifyContent: 'center', alignItems: 'center',
                            background: 'rgba(0,0,0,0.75)',
                            borderRadius: '0 0 4px 4px', padding: '2px 2px',
                          }}>
                            <ManaCostPips cost={formatRawMana(costMana)} size={11} />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })()}

          {/* ── Exiled Playable sidebar ── (cards from exile_top_play / Breaching Dragonstorm) */}
          {(() => {
            const exiledCards: any[] = snap.exiledPlayable?.[0] || [];
            if (exiledCards.length === 0) return null;
            return (
              <div style={{
                order: 0,
                display: 'flex', flexDirection: 'row', gap: '6px',
                padding: '6px 8px', alignItems: 'center', flexShrink: 0,
                borderLeft: '2px solid rgba(160,80,240,0.5)',
                background: 'rgba(120,50,200,0.12)',
              }}>
                {exiledCards.map((card: any) => {
                  const isFree = card._freeCast;
                  return (
                    <div
                      key={card._uid}
                      onClick={() => handleCardClick(card, 0)}
                      onContextMenu={e => { e.preventDefault(); setZoom(card); }}
                      title={`${card.name}${isFree ? ' — FREE (exile)' : ' (exile)'}`}
                      style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}
                    >
                      <img
                        src={card.image_normal || card.image_small}
                        alt={card.name}
                        style={{
                          width: '72px', height: '100px', objectFit: 'cover', borderRadius: '6px', display: 'block',
                          boxShadow: '0 0 10px 3px rgba(160,80,240,0.6)',
                          border: '2px solid rgba(160,80,240,0.8)',
                        }}
                      />
                      <div style={{
                        position: 'absolute', bottom: '3px', left: 0, right: 0,
                        textAlign: 'center', fontSize: '9px', fontWeight: 800,
                        color: '#fff', background: isFree ? 'rgba(120,50,200,0.85)' : 'rgba(0,0,0,0.75)',
                        borderRadius: '0 0 4px 4px', padding: '1px 2px',
                      }}>{isFree ? '✨ FREE' : '✨ Exile'}</div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ── Graveyard Lands slot (Glacierwood Siege Sultai mode) ── */}
          {(() => {
            const canPlayGYLand = !snap.landPlayedThisTurn && (snap.phase === 'main1' || snap.phase === 'main2') && !!(gsRef.current as any)?._playLandsFromGraveyard?.[0];
            if (!canPlayGYLand) return null;
            const gyLands = (p0.graveyard || []).filter((c: any) => c.type_line?.toLowerCase().includes('land'));
            if (gyLands.length === 0) return null;
            return (
              <div style={{ order: 0, flexShrink: 0, padding: '4px 6px', alignSelf: 'center' }}>
                <div
                  onClick={() => setGraveyardLandsOpen(true)}
                  title="Play land from graveyard"
                  style={{
                    width: 56, height: 56, borderRadius: '50%', cursor: 'pointer',
                    background: 'linear-gradient(135deg, rgba(40,140,60,0.4), rgba(80,200,100,0.2))',
                    border: '2px solid rgba(60,180,80,0.7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 10px rgba(60,180,80,0.4)',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    position: 'relative',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 0 16px rgba(60,180,80,0.7)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 0 10px rgba(60,180,80,0.4)'; }}
                >
                  <img
                    src="/img/land-icon.png"
                    alt="land"
                    style={{ width: 34, height: 34, filter: 'invert(1) sepia(1) saturate(3) hue-rotate(80deg) brightness(1.2)', objectFit: 'contain' }}
                  />
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    background: '#2a2', color: '#fff', fontSize: 11, fontWeight: 800,
                    width: 20, height: 20, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '1.5px solid #111',
                  }}>{gyLands.length}</span>
                </div>
              </div>
            );
          })()}

          {/* ── Deck + Graveyard panel (right side of hand row) ── */}
          {(() => {
            const CARD_BACK = sleeveArt || 'https://backs.scryfall.io/large/59/482d0001-547e-4a13-a0f7-451e2a1b5940.jpg';
            const gyCards: any[] = p0.graveyard || [];
            const topGyCard = gyCards.length > 0 ? gyCards[gyCards.length - 1] : null;
            return (
              <div className="hand-zones-panel" style={{ order: 3, marginLeft: 'auto' }}>
                {/* Graveyard */}
                <div
                  className="hand-zone-slot gy-slot"
                  onClick={() => setGraveyardOpen({ pid: 0 })}
                  title={`Graveyard: ${gyCards.length} card${gyCards.length !== 1 ? 's' : ''}`}
                >
                  {topGyCard ? (
                    <img
                      className="hand-zone-card"
                      src={getLandArtUrl(topGyCard) || topGyCard.image_normal || topGyCard.image_small}
                      alt={topGyCard.name}
                      onError={e => { (e.currentTarget as HTMLImageElement).src = CARD_BACK; }}
                    />
                  ) : (
                    <div className="hand-zone-empty">☠</div>
                  )}
                  <span className="hand-zone-label">Graveyard {gyCards.length}</span>
                </div>

                {/* Library */}
                <div
                  className="hand-zone-slot lib-slot"
                  title={`Library: ${p0.libraryCount} cards`}
                >
                  <div className="hand-zone-lib-stack">
                    <img className="hand-zone-card lib-back-3" src={CARD_BACK} alt="deck" />
                    <img className="hand-zone-card lib-back-2" src={CARD_BACK} alt="deck" />
                    <img className="hand-zone-card lib-back-1" src={CARD_BACK} alt="deck" />
                  </div>
                  <span className="hand-zone-label">Deck {p0.libraryCount}</span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Log overlay ── */}
      {showLog && (
        <div className="game-log glass" ref={logRef}>
          <button
            onClick={() => setShowLog(false)}
            style={{
              position: 'sticky', top: 0, float: 'right',
              background: 'rgba(255,255,255,0.12)', border: 'none', color: '#ccc',
              cursor: 'pointer', borderRadius: '4px', fontSize: '12px', padding: '1px 6px',
              zIndex: 2,
            }}
          >✕</button>
          {log.map((entry: string, i: number) => <div key={i} className="game-log-entry">{entry}</div>)}
        </div>
      )}


      {/* ── Card zoom (right-click) ── */}
      {zoom && (
        <div className="game-zoom-overlay" onClick={() => setZoom(null)}>
          <img src={zoom.image_normal} alt={zoom.name} className="game-zoom-img" />
          <div className="game-zoom-info glass" onClick={e => e.stopPropagation()}>
            <div className="game-zoom-header">
              <div className="game-zoom-name">{zoom.name}</div>
              {(zoom as any)._isCopy && (zoom as any)._originalCard && (
                <div style={{ color: '#b388ff', fontSize: '12px', fontWeight: 700, marginTop: '2px' }}>
                  🔮 Copia — Original: {(zoom as any)._originalCard.name}
                </div>
              )}
              {(zoom.power != null || zoom._powerMod || zoom._counters) && (
                <button
                  className={`btn btn-sm zoom-toggle-btn ${zoomModified ? 'active' : ''}`}
                  onClick={e => { e.stopPropagation(); setZoomModified(v => !v); }}
                  title="Toggle between original and current in-game state"
                >
                  {zoomModified ? '📋 Original' : '⚡ Current'}
                </button>
              )}
            </div>
            <div className="game-zoom-type">{zoom.type_line}</div>
            {!zoomModified ? (
              <>
                {zoom.oracle_text && <div className="game-zoom-text">{zoom.oracle_text}</div>}
                {zoom.power != null && <div className="game-zoom-pt">{zoom.power}/{zoom.toughness}</div>}
              </>
            ) : (
              <ZoomModifiedPanel card={zoom} />
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ── OVERLAYS (conditionally rendered based on waitingForInput) ─── */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      {/* View Battlefield toggle button — shown when an overlay is paused */}
      {(() => {
        const wi = snap.waitingForInput;
        if (!wi || wi.playerId !== 0) return null;
        // Show "view battlefield" for ALL overlay types (any human input prompt)
        if (viewingBattlefield) {
          return (
            <button
              onClick={() => setViewingBattlefield(false)}
              style={{
                position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                zIndex: 9999,
                padding: '16px 40px', borderRadius: '14px',
                background: 'linear-gradient(135deg, #f0c040, #e0a020)', color: '#1a1025',
                fontWeight: 900, fontSize: '18px', border: '2px solid #fff3',
                cursor: 'pointer',
                boxShadow: '0 6px 30px rgba(0,0,0,0.7), 0 0 60px rgba(240,192,64,0.3)',
                letterSpacing: '0.5px',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            >
              ↩ Voltar à escolha (Esc)
            </button>
          );
        }
        return (
          <button
            onClick={() => setViewingBattlefield(true)}
            style={{
              position: 'fixed', top: 10, right: 12, zIndex: 9999,
              padding: '6px 12px', borderRadius: '8px',
              background: 'rgba(30,20,60,0.92)', color: '#a0a8c0',
              fontWeight: 700, fontSize: '11px', border: '1px solid rgba(160,168,192,0.3)',
              cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
            }}
          >
            👁 View battlefield
          </button>
        );
      })()}

      {!viewingBattlefield && (() => {
        const wi = snap.waitingForInput;
        const gs = gsRef.current;
        if (!wi || wi.playerId !== 0) return null;

        switch (wi.type) {
          // ── Graveyard → top of library (Treason of Isengard) ───────────
          case 'graveyard_to_top': {
            const gttCards = wi.choices || [];
            const isOptional = wi.optional;
            return (
              <GraveyardMultiSelectOverlay
                cards={gttCards}
                amount={1}
                minAmount={isOptional ? 0 : 1}
                exactAmount={false}
                title={isOptional ? 'Put an instant or sorcery on top of your library (optional)' : 'Choose a card to put on top of your library'}
                onConfirm={(uids: string[]) => actions.resolveGraveyardToTop(uids[0] ?? null)}
              />
            );
          }

          // ── Scry / Surveil ──────────────────────────────────────────────
          case 'scry':
          case 'surveil':
            return gs?._pendingScry ? (
              <ScryOverlay pendingScry={gs._pendingScry} onConfirm={actions.resolveScry} onViewBattlefield={() => setViewingBattlefield(true)} />
            ) : null;

          // ── Modal spell picker ──────────────────────────────────────────
          case 'modal_choice':
            return gs?._pendingModal ? (
              <ModalOverlay
                pendingModal={gs._pendingModal}
                onConfirm={actions.resolveModal}
                onCancel={() => actions.cancelModal?.()}
                onViewBattlefield={() => setViewingBattlefield(true)}
              />
            ) : null;

          // ── Post-modal target selection banner ──────────────────────────
          case 'post_modal_target': {
            const labelMap: Record<string, string> = {
              creature: 'any creature',
              own_creature: 'one of your creatures',
              own_nonlegendary_creature: 'a non-legendary creature you control',
              opponent_creature: "an opponent's creature",
              creature_with_flying: 'a creature with flying',
              creature_without_flying: 'a creature without flying',
              creature_or_planeswalker: 'a creature or planeswalker',
              opponent_creature_or_planeswalker: "an opponent's creature or planeswalker",
              artifact: 'an artifact',
              enchantment: 'an enchantment',
              permanent: 'a permanent',
              nonland_permanent: 'a non-land permanent',
              any: 'any target',
              'creature_power4+': 'a creature with power 4 or greater',
              artifact_or_enchantment: 'an artifact or enchantment',
              artifact_or_enchantment_or_flyer: 'an artifact, enchantment, or creature with flying',
              opponent_artifact_or_enchantment: "an opponent's artifact or enchantment",
              opponent_artifact_or_creature: "an opponent's artifact or creature",
              opponent_nonland: "an opponent's nonland permanent",
              noncreature_artifact: 'a non-creature artifact',
              creature_or_artifact: 'a creature or artifact',
              creature_or_enchantment: 'a creature or enchantment',
              attacking_creature: 'an attacking creature',
              attacking_or_blocking_creature: 'an attacking or blocking creature',
              creature_power_3_or_less: 'a creature with power 3 or less',
              creature_power2_or_less: 'a creature with power 2 or less',
              creature_mv3: 'a creature with mana value 3 or less',
              nonland_permanent_mv2: 'a non-land permanent with mana value 2 or less',
              other_own_creature: 'another creature you control',
              dragon: 'a Dragon',
              'opponent_creature_mv3+': "an opponent's creature with mana value 3 or greater",
            };
            const label = labelMap[wi.targetType] || wi.targetType;
            // Detect if there are valid targets to avoid freeze when none exist
            const allBFCards = snap ? [...snap.players[0].battlefield, ...snap.players[1].battlefield] : [];
            const hasValidTargets = (() => {
              const tt = wi.targetType;
              if (tt === 'creature' || tt === 'any') return allBFCards.some((c: any) => c.type_line?.includes('Creature'));
              if (tt === 'own_creature') return snap!.players[0].battlefield.some((c: any) => c.type_line?.includes('Creature'));
              if (tt === 'own_nonlegendary_creature') return snap!.players[0].battlefield.some((c: any) => c.type_line?.includes('Creature') && !c.type_line?.includes('Legendary'));
              if (tt === 'opponent_creature') return snap!.players[1].battlefield.some((c: any) => c.type_line?.includes('Creature'));
              if (tt === 'creature_with_flying') return allBFCards.some((c: any) => c.type_line?.includes('Creature') && ((c.keywords || []).map((k: string) => (k || '').toLowerCase()).includes('flying') || (c.oracle_text || '').toLowerCase().includes('flying')));
              if (tt === 'creature_without_flying') return allBFCards.some((c: any) => c.type_line?.includes('Creature') && !((c.keywords || []).map((k: string) => (k || '').toLowerCase()).includes('flying')));
              if (tt === 'creature_or_planeswalker') return allBFCards.some((c: any) => c.type_line?.includes('Creature') || c.type_line?.includes('Planeswalker'));
              if (tt === 'opponent_creature_or_planeswalker') return snap!.players[1].battlefield.some((c: any) => c.type_line?.includes('Creature') || c.type_line?.includes('Planeswalker'));
              if (tt === 'artifact') return allBFCards.some((c: any) => c.type_line?.includes('Artifact'));
              if (tt === 'enchantment') return allBFCards.some((c: any) => c.type_line?.includes('Enchantment'));
              if (tt === 'permanent') return allBFCards.length > 0;
              if (tt === 'nonland_permanent') return allBFCards.some((c: any) => !c.type_line?.includes('Land'));
              if (tt === 'creature_power4+') return allBFCards.some((c: any) => c.type_line?.includes('Creature') && parseInt(c.power || '0', 10) >= 4);
              if (tt === 'artifact_or_enchantment' || tt === 'opponent_artifact_or_enchantment') {
                const pool = tt === 'opponent_artifact_or_enchantment' ? snap!.players[1].battlefield : allBFCards;
                return (pool as any[]).some((c: any) => c.type_line?.includes('Artifact') || c.type_line?.includes('Enchantment'));
              }
              if (tt === 'artifact_or_enchantment_or_flyer') {
                const hasFly4 = (c: any) => (c.keywords || []).some((k: any) => (typeof k === 'string' ? k : k?.keyword || '').toLowerCase() === 'flying');
                return allBFCards.some((c: any) => c.type_line?.includes('Artifact') || c.type_line?.includes('Enchantment') || (c.type_line?.includes('Creature') && hasFly4(c)));
              }
              if (tt === 'opponent_artifact_or_creature') {
                return (snap!.players[1].battlefield as any[]).some((c: any) => c.type_line?.includes('Artifact') || c.type_line?.includes('Creature'));
              }
              if (tt === 'opponent_nonland') {
                return (snap!.players[1].battlefield as any[]).some((c: any) => !c.type_line?.includes('Land'));
              }
              if (tt === 'noncreature_artifact') return allBFCards.some((c: any) => c.type_line?.includes('Artifact') && !c.type_line?.includes('Creature'));
              if (tt === 'creature_or_artifact') return allBFCards.some((c: any) => c.type_line?.includes('Creature') || c.type_line?.includes('Artifact'));
              if (tt === 'creature_or_enchantment') return allBFCards.some((c: any) => c.type_line?.includes('Creature') || c.type_line?.includes('Enchantment'));
              return true;
            })();
            return (
              <div style={{
                position: 'fixed', bottom: 130, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(10, 10, 30, 0.95)', border: `2px solid ${hasValidTargets ? '#7c3aed' : '#e74c3c'}`,
                borderRadius: 12, padding: '12px 28px', zIndex: 9999, color: '#fff',
                fontSize: 15, fontWeight: 600, textAlign: 'center', pointerEvents: 'auto',
                boxShadow: `0 0 20px ${hasValidTargets ? 'rgba(124,58,237,0.5)' : 'rgba(231,76,60,0.5)'}`,
              }}>
                🎯 {wi.cardName || 'Spell'}: choose {label}
                <div style={{ fontSize: 12, color: '#a78bfa', marginTop: 4 }}>
                  Click a valid target on the battlefield
                </div>
                <button
                  style={{
                    marginTop: 10, display: 'block', width: '100%',
                    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '4px 0', fontSize: 12,
                  }}
                  onClick={() => {
                    setTargeting(null);
                    actions.resolvePostModalTarget(null);
                  }}
                >
                  Cancelar (Esc)
                </button>
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

          // ── Trigger priority — handled by side panel only ─────────────
          case 'trigger_priority':
            return null;

          // ── Instant priority window ─────────────────────────────────────
          case 'instant_priority':
            return (
              <InstantPriorityBanner phase={wi.phase || ''} onPass={actions.nextPhase} />
            );

          // ── Stack priority (opponent can respond) ───────────────────────
          case 'stack_priority': {
            const pendingCard = (snap as any)?._pendingCastOnStack?.card;
            const spType = pendingCard?.type_line?.replace(/—.*/, '').trim() || '';
            return (
              <StackPriorityBanner
                spellName={pendingCard?.name || 'Spell'}
                spellCost={pendingCard?.mana_cost || ''}
                spellType={spType}
                onPass={actions.nextPhase}
              />
            );
          }

          // ── Mana color choice ───────────────────────────────────────────
          case 'mana_color_choice':
            return gs?._pendingManaChoice ? (
              <ManaColorOverlay
                colors={gs._pendingManaChoice.colors || ['W','U','B','R','G']}
                remaining={gs._pendingManaChoice.remaining}
                onConfirm={actions.resolveManaColor}
              />
            ) : null;

          // ── Put card on bottom of library ───────────────────────────────
          case 'put_card_on_bottom': {
            const handCards = myHand;
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}>
                <div className="overlay-panel glass" style={{ maxWidth: 500, textAlign: 'center' }}>
                  <h3 className="overlay-title">📚 Escolha uma carta para o fundo do grimório</h3>
                  <p style={{ margin: '0 0 14px', opacity: 0.7, fontSize: '0.85em' }}>Você não controla uma criatura lendária.</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxHeight: 260, overflowY: 'auto' }}>
                    {handCards.map((card: any) => (
                      <div
                        key={card._uid}
                        style={{ cursor: 'pointer', border: '2px solid transparent', borderRadius: 6, transition: 'border-color 0.15s' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                        onClick={() => actions.resolvePutOnBottom(card._uid)}
                      >
                        <CardImage card={card} width={80} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          // ── Discard overlays ────────────────────────────────────────────
          case 'discard': {
            const excludeUid = (wi as any).excludeUid;
            const discardHand = excludeUid
              ? snap.players[0].hand.filter((c: any) => c.uid !== excludeUid && c._uid !== excludeUid)
              : snap.players[0].hand;
            return (
              <DiscardOverlay
                hand={discardHand}
                amount={wi.amount || 1}
                title={(wi as any).prompt || '🗑 Discard to hand size'}
                onConfirm={actions.resolveDiscard}
              />
            );
          }
          case 'mandatory_discard':
            if (!gs?._pendingDiscard) return null;
            // unless_creature step 1: offer to discard a creature (highlighted)
            if (gs._pendingDiscard.unless_creature && !gs._pendingDiscard._skippedCreature) {
              const creaturesInHand = snap.players[0].hand.filter((c: any) => (c.type_line || '').includes('Creature'));
              if (creaturesInHand.length > 0) {
                return (
                  <DiscardOverlay
                    hand={creaturesInHand}
                    amount={1}
                    optional
                    title="🗑 Discard a Creature?"
                    hint="Discard 1 creature to avoid discarding 2 cards. If you click Skip, you will discard 2 cards instead."
                    onConfirm={(uids: string[]) => {
                      if (uids.length > 0) {
                        actions.resolveMandatoryDiscard(uids);
                      } else {
                        // Skip: move to step 2 (discard 2 non-creature)
                        gs._pendingDiscard._skippedCreature = true;
                        forceUpdate(n => n + 1);
                      }
                    }}
                  />
                );
              }
              // No creatures in hand: fall through to discard 2
              gs._pendingDiscard._skippedCreature = true;
            }
            return (
              <DiscardOverlay
                hand={snap.players[0].hand}
                amount={gs._pendingDiscard.amount || 1}
                optional={!!(gs._pendingDiscard.up_to || gs._pendingDiscard.optional)}
                title={gs._pendingDiscard.up_to ? '🗑 Discard (Optional — up to N)' : '🗑 Mandatory Discard'}
                onConfirm={actions.resolveMandatoryDiscard}
              />
            );
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
          case 'optional_discard_choice': {
            const discPending = gs?._pendingOptionalDiscard;
            if (!discPending) return null;
            const discSource = discPending.sourceName || '';
            const discHint = discPending.returnFromGY
              ? `Discard a card to return a creature or land from your graveyard to your hand.`
              : (discPending.hint || (discPending.onNonlandDiscard ? 'Discard a nonland card to trigger bonus effect!' : ''));
            return (
              <DiscardOverlay
                hand={snap.players[0].hand}
                amount={discPending.amount || 1}
                optional
                title={`🗑 Optional Discard${discSource ? ` — ${discSource}` : ''}`}
                hint={discHint}
                onConfirm={uids => actions.resolveDiscard(uids)}
              />
            );
          }

          // ── Search library / Ramp choice ────────────────────────────────
          case 'ramp_choice':
          case 'search_library':
          case 'search_library_choice': {
            const pending = gs?._pendingRamp || gs?._pendingSearch || gs?._pendingSearchChoice;
            const candidates = pending?.lands || pending?.candidates || [];
            const searchTarget = pending?.effect?.target || pending?.target || '';
            const searchTypeLabel: Record<string, string> = {
              creature: 'a Creature', land: 'a Land', basic_land: 'a Basic Land',
              instant: 'an Instant', sorcery: 'a Sorcery', artifact: 'an Artifact',
              enchantment: 'an Enchantment', dragon: 'a Dragon', permanent: 'a Permanent',
            };
            const typeHint = searchTypeLabel[searchTarget] || '';
            const titleBase = pending?.tapped ? '🌳 Search — Put Land into Play (Tapped)' : (pending?.toBattlefield ? '📚 Search — Put onto Battlefield' : '📚 Search Library');
            const mvHint = pending?.maxMV !== undefined ? ` (MV ≤ ${pending.maxMV})` : '';
            const title = typeHint ? `${titleBase} — Choose ${typeHint}${mvHint}` : `${titleBase}${mvHint}`;
            return candidates.length > 0 ? (
              <SearchLibraryOverlay
                candidates={candidates}
                optional={pending?.optional}
                title={title}
                onConfirm={actions.resolveSearchLibrary}
              />
            ) : null;
          }

          // ── Search library to graveyard (Lotuslight Dancers) ─────────────
          case 'search_library_to_gy': {
            const pendingGY = gs?._pendingSearchToGY;
            if (!pendingGY) return null;
            const colorIdx = pendingGY.currentColorIndex || 0;
            const currentColor = pendingGY.colors[colorIdx];
            const colorNames: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
            const colorCands = (pendingGY.colorCandidates[currentColor] || [])
              .filter((c: any) => !pendingGY.chosen.some((ch: any) => ch._uid === c._uid));
            return colorCands.length > 0 ? (
              <SearchLibraryOverlay
                candidates={colorCands}
                optional={true}
                title={`📚 Search — Choose a ${colorNames[currentColor] || currentColor} card to put into graveyard (${colorIdx + 1}/${pendingGY.colors.length})`}
                onConfirm={actions.resolveSearchToGY}
              />
            ) : null;
          }

          // ── Ugin ultimate: search library exile cast (multi-select) ─────
          case 'search_library_exile_cast': {
            const slecPending = gs?._pendingSearchExileCast;
            if (!slecPending) return null;
            const slecCandidates = slecPending.candidates || [];
            return (
              <UginUltimateOverlay
                candidates={slecCandidates}
                onConfirm={(selectedUids: string[]) => actions.resolveSearchExileCast(selectedUids)}
              />
            );
          }

          // ── X cost choice (human chooses how much X to pay) ──────────────
          case 'choose_x_cost': {
            const xPending = gs?._pendingXCast;
            if (!xPending) return null;
            const maxX = xPending.maxX || 0;
            const cardName = xPending.card?.name || 'Spell';
            return (
              <div className="overlay-backdrop" style={{ zIndex: 9999 }}>
                <div className="overlay-panel" style={{ padding: '24px', minWidth: '320px', textAlign: 'center' }}>
                  <h3 style={{ marginBottom: '12px' }}>🔢 Choose X for {cardName}</h3>
                  <p style={{ marginBottom: '16px', opacity: 0.8 }}>How much mana to pay for X? (max {maxX})</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                    {Array.from({ length: maxX + 1 }, (_, i) => (
                      <button
                        key={i}
                        className="btn-overlay"
                        style={{ minWidth: '48px', padding: '8px 12px', fontSize: '16px', fontWeight: i === maxX ? 'bold' : 'normal' }}
                        onClick={() => actions.resolveXChoice(i)}
                      >
                        X = {i}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
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

          // ── Ring-bearer choice (The One Ring tempts you) ─────────────────
          case 'ring_bearer_choice': {
            const pending = snap?.pendingRingBearer;
            if (!pending) return null;
            const creatures = (pending.creatures || [])
              .map((c: any) => snap.players[0].battlefield.find((bf: any) => bf._uid === c._uid) || c)
              .filter(Boolean);
            return (
              <CreatureChoiceOverlay
                creatures={creatures}
                title="The Ring Tempts You — Choose a Ring-bearer"
                hint="The chosen creature becomes your Ring-bearer and gains the Ring's power."
                onConfirm={uid => uid && actions.resolveRingBearerChoice(uid)}
              />
            );
          }

          // ── Grant target choice (Herd Heirloom etc.) ─────────────────────
          case 'grant_target_choice': {
            const pending = gs?._pendingGrantTarget;
            const candidates = (pending?.candidates || [])
              .map((uid: string) => snap.players[0].battlefield.find((c: any) => c._uid === uid))
              .filter(Boolean);
            const kwNames = (pending?.kwList || []).join(', ');
            const isMulti = !!(pending?.isMultiGrant);
            const isOptional = !!(pending?.optional);
            const mg = (gs as any)?._pendingMultiGrant;
            const remaining = mg?.remaining ?? 1;
            return (
              <CreatureChoiceOverlay
                creatures={candidates}
                title={`🛡 Grant ${kwNames} — Choose a creature${isMulti ? ` (up to ${remaining} more)` : ''}`}
                hint="Click a creature to grant the keyword."
                optional={isOptional}
                skipLabel="Skip"
                onConfirm={uid => actions.resolveGrantTargetChoice(uid || '')}
              />
            );
          }

          // ── Éowyn grant choice (creature + keyword combined) ────────────
          case 'eowyn_grant_choice': {
            const eoPending = gs?._pendingEowynGrant;
            if (!eoPending) return null;
            const eoCandidates = (eoPending.creatures || []).map((item: any) => ({
              uid: item.uid,
              name: (snap.players[0].battlefield.find((bf: any) => bf._uid === item.uid) as any)?.name ?? item.uid,
              isEquipped: !!(item.isEquipped),
            }));
            return (
              <div style={{
                position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(10,10,30,0.96)', border: '2px solid #ec4899',
                borderRadius: 12, padding: '16px 24px', zIndex: 9999, color: '#fff',
                fontSize: 14, boxShadow: '0 0 20px rgba(236,72,153,0.4)', maxWidth: 480,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 10, textAlign: 'center' }}>⚔️ Éowyn — Choose a creature and keyword</div>
                {eoCandidates.map((item: any) => (
                  <div key={item.uid} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ flex: 1, fontWeight: 600 }}>{item.name}</span>
                    {item.isEquipped ? (
                      <button style={{ background: '#7c3aed', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '4px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => actions.resolveEowynGrantChoice(item.uid, 'First Strike')}>
                        <img src="/img/abilities/first_strike.png" style={{ width: 14, height: 14 }} alt="" />
                        <img src="/img/abilities/vigilance.png" style={{ width: 14, height: 14 }} alt="" />
                        Both
                      </button>
                    ) : (
                      <>
                        <button style={{ background: '#dc2626', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={() => actions.resolveEowynGrantChoice(item.uid, 'First Strike')}>
                          <img src="/img/abilities/first_strike.png" style={{ width: 14, height: 14 }} alt="" />
                          First Strike
                        </button>
                        <button style={{ background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={() => actions.resolveEowynGrantChoice(item.uid, 'Vigilance')}>
                          <img src="/img/abilities/vigilance.png" style={{ width: 14, height: 14 }} alt="" />
                          Vigilance
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            );
          }

          // ── Ward choice (pay ward cost or pick different target) ────────
          case 'ward_choice': {
            const wardPending = gs?._pendingWardChoice;
            if (!wardPending) return null;
            const canAfford = (() => {
              if (wardPending.wardType === 'life') {
                return snap.players[0].life > wardPending.wardCost;
              }
              const pool = gs?.manaPool?.[0] || {};
              const poolTotal = Object.values(pool).reduce((s: number, v) => s + ((v as number) || 0), 0) as number;
              const untapped = snap.players[0].battlefield.filter((c: any) =>
                (c.type_line || '').includes('Land') && !c._tapped
              ).length;
              return (poolTotal + untapped) >= wardPending.wardCost;
            })();
            return (
              <div style={{
                position: 'fixed', bottom: 130, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(10, 10, 30, 0.96)', border: '2px solid #f59e0b',
                borderRadius: 12, padding: '16px 28px', zIndex: 9999, color: '#fff',
                fontSize: 15, fontWeight: 600, textAlign: 'center',
                boxShadow: '0 0 20px rgba(245,158,11,0.5)', minWidth: 280,
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                  🛡️ {wardPending.creatureName} has Ward
                  {wardPending.wardType === 'life'
                    ? `—Pay ${wardPending.wardCost} life`
                    : <ManaCostPips cost={`{${wardPending.wardCost}}`} size={18} />
                  }
                </span>
                <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                  Pay {wardPending.wardType === 'life' ? `${wardPending.wardCost} life` : <><ManaCostPips cost={`{${wardPending.wardCost}}`} size={13} /> mana</>} to target this creature, or choose another target.
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
                  {canAfford && (
                    <button style={{
                      background: '#16a34a', border: 'none', borderRadius: 6, color: '#fff',
                      cursor: 'pointer', padding: '6px 16px', fontSize: 13, fontWeight: 600,
                    }} onClick={() => actions.resolveWardChoice('pay')}>
                      Pay {wardPending.wardCost} {wardPending.wardType === 'life' ? '❤️' : '💰'}
                    </button>
                  )}
                  <button style={{
                    background: '#7c3aed', border: 'none', borderRadius: 6, color: '#fff',
                    cursor: 'pointer', padding: '6px 16px', fontSize: 13, fontWeight: 600,
                  }} onClick={() => actions.resolveWardChoice('repick')}>
                    Choose Other Target
                  </button>
                  <button style={{
                    background: '#dc2626', border: 'none', borderRadius: 6, color: '#fff',
                    cursor: 'pointer', padding: '6px 16px', fontSize: 13, fontWeight: 600,
                  }} onClick={() => actions.resolveWardChoice('decline')}>
                    Don't Pay (Countered)
                  </button>
                </div>
              </div>
            );
          }

          // ── Choose opponent discard (Torment of Gollum etc.) ─────────────
          case 'choose_opponent_discard': {
            const codPending = gs?._pendingChooseOpponentDiscard;
            if (!codPending) return null;
            return (
              <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.82)', zIndex: 9999,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  background: 'rgba(10,10,30,0.97)', border: '2px solid #dc2626',
                  borderRadius: 16, padding: '24px 32px', color: '#fff',
                  maxWidth: 800, width: '95%',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#fca5a5' }}>
                    🗡️ Choose a nonland card to discard
                  </div>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>
                    Opponent reveals their hand — you choose which nonland card they discard
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                    {codPending.cards.map((c: any) => {
                      const isLand = (c.type_line || '').toLowerCase().includes('land');
                      const imgSrc = c.image_small || c.image_normal || null;
                      return (
                        <div key={c._uid}
                          onClick={() => !isLand && actions.resolveChooseOpponentDiscard(c._uid)}
                          style={{
                            cursor: isLand ? 'not-allowed' : 'pointer',
                            opacity: isLand ? 0.4 : 1,
                            border: isLand ? '2px solid #4b5563' : '2px solid #dc2626',
                            borderRadius: 10, overflow: 'hidden',
                            width: 100, textAlign: 'center',
                            transition: 'all 0.15s',
                            background: isLand ? 'rgba(75,85,99,0.2)' : 'rgba(220,38,38,0.15)',
                          }}
                          title={isLand ? `${c.name} (land — cannot discard)` : `Click to discard ${c.name}`}
                        >
                          {imgSrc && (
                            <img src={imgSrc} alt={c.name}
                              style={{ width: '100%', display: 'block', borderRadius: '8px 8px 0 0' }} />
                          )}
                          <div style={{ padding: '6px 4px' }}>
                            <div style={{ fontWeight: 700, fontSize: 11, color: isLand ? '#6b7280' : '#fff' }}>{c.name}</div>
                            {c.mana_cost && <div style={{ marginTop: 2 }}><ManaCostPips cost={c.mana_cost} size={11} /></div>}
                            {isLand && <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>Land (skip)</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          }

          // ── Buff choice (pick own creature to buff) ──────────────────────
          case 'buff_choice': {
            const pending = gs?._pendingBuffChoice;
            const allBf = [...snap.players[0].battlefield, ...snap.players[1].battlefield];
            const candidates = (pending?.candidates || [])
              .map((uid: string) => allBf.find((c: any) => c._uid === uid))
              .filter(Boolean);
            const isDebuff = pending && ((pending.resolvedPower || 0) < 0 || (pending.resolvedToughness || 0) < 0);
            return (
              <CreatureChoiceOverlay
                creatures={candidates}
                title={isDebuff ? "⬇ Weaken — Choose Target" : "⬆ Strengthen — Choose Creature"}
                onConfirm={uid => uid && actions.resolveBuffChoiceAction(uid)}
              />
            );
          }

          // ── Distribute counters — multi-click UI ──────────────────────────
          case 'distribute_counters': {
            const pending = gs?._pendingDistribute;
            const creatures = pending
              ? snap.players[0].battlefield.filter((c: any) => c.type_line?.includes('Creature'))
              : [];
            return pending ? (
              <DistributeCountersOverlay
                creatures={creatures}
                totalAmount={pending.total || pending.amount || 1}
                counterType={pending.counter || '+1/+1'}
                onConfirm={dist => actions.resolveDistributeCountersAction(dist)}
              />
            ) : null;
          }

          // ── Distribute damage — human splits damage_divided spell ────────
          case 'distribute_damage': {
            const pending = gs?._pendingDistributeDamage;
            if (!pending) return null;
            // Enrich targets with name/imageUrl for display
            const enriched = pending.targets.map((t: any) => {
              if (t.type === 'creature') {
                const c = snap.players[t.player].battlefield.find((x: any) => x._uid === t.uid);
                return { ...t, name: c?.name || 'Creature', imageUrl: c?.image_small || c?.image_normal };
              }
              return { ...t, name: t.player === 0 ? 'You' : 'Opponent' };
            });
            return (
              <DistributeDamageOverlay
                totalDamage={pending.totalDamage}
                targets={enriched}
                onConfirm={dist => actions.resolveDistributeDamage(dist)}
              />
            );
          }

          // ── Put creatures from hand (Last March of the Ents) ─────────────
          case 'put_creatures_from_hand': {
            const choices = (wi as any).choices || [];
            return (
              <BounceMultiOverlay
                permanents={choices}
                maxBounce={choices.length}
                title="🌿 Choose creatures to put on the battlefield"
                onConfirm={uids => actions.resolvePutCreaturesFromHand(uids)}
                allowEmpty
              />
            );
          }

          // ── Sacrifice choice ─────────────────────────────────────────────
          case 'sacrifice': {
            const choices = (wi as any).choices || [];
            const isForCast = !!(wi as any)._forCast;
            const isAnyNumber = !!(wi as any)._anyNumber;
            const altCost = (wi as any).alternate_cost;
            const title = isAnyNumber
              ? '💀 Additional Cost — Sacrifice lands (click Done when finished)'
              : isForCast
                ? altCost !== undefined
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>💀 Additional Cost — Sacrifice a creature or pay <ManaCostPips cost={`{${altCost}}`} size={15} /></span>
                  : '💀 Additional Cost — Sacrifice'
                : '💀 Sacrifice — Choose';
            const skipLabel = isAnyNumber ? 'Done (proceed)' : altCost !== undefined
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Pay <ManaCostPips cost={`{${altCost}}`} size={13} /> instead</span>
              : 'Skip';
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title={title}
                optional={(wi as any).optional}
                skipLabel={skipLabel}
                onConfirm={uid => actions.resolveSacrifice(uid)}
              />
            );
          }

          // ── ETB destroy target ────────────────────────────────────────────
          case 'etb_destroy_target': {
            const choices = (wi as any).choices || [];
            const maxDestroy = (wi as any).maxDestroy || 1;
            const isOptionalDestroy = !!(wi as any).optional;
            if (maxDestroy > 1) {
              return (
                <BounceMultiOverlay
                  permanents={choices}
                  maxBounce={maxDestroy}
                  title={`💀 Destroy — Choose up to ${maxDestroy} permanents`}
                  onConfirm={uids => actions.resolveETBDestroyTarget(uids)}
                />
              );
            }
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="💀 Destroy — Choose a permanent"
                hint={isOptionalDestroy ? 'Click a permanent to destroy it, or skip.' : 'Click a permanent to destroy it.'}
                optional={isOptionalDestroy}
                onConfirm={uid => actions.resolveETBDestroyTarget(uid ? [uid] : [])}
              />
            );
          }

          // ── Long List of the Ents: choose a creature type ──
          case 'choose_creature_type': {
            const typeChoices: string[] = (wi as any).choices || [];
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}>
                <div className="overlay-panel glass" style={{ maxWidth: 420 }}>
                  <h3 className="overlay-title">📜 Note a Creature Type</h3>
                  <p style={{ textAlign: 'center', marginBottom: 12, opacity: 0.8 }}>
                    Choose a creature type not yet noted for this Saga.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {typeChoices.map((t: string) => (
                      <button
                        key={t}
                        className="btn btn-gold"
                        style={{ minWidth: 90 }}
                        onClick={() => actions.resolveNoteCreatureType(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          // ── Protection type choice (Pippin, Guard of the Citadel) ──
          case 'protection_type_choice': {
            const ptChoices: string[] = (wi as any).choices || ['Artifact', 'Creature', 'Enchantment', 'Instant', 'Sorcery', 'Land', 'Planeswalker'];
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}>
                <div className="overlay-panel glass" style={{ maxWidth: 480 }}>
                  <h3 className="overlay-title">🛡 Choose Card Type for Protection</h3>
                  <p style={{ textAlign: 'center', marginBottom: 12, opacity: 0.8 }}>
                    Target creature gains protection from the chosen card type until end of turn.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {ptChoices.map((t: string) => (
                      <button key={t} className="btn btn-gold" style={{ minWidth: 110 }}
                        onClick={() => actions.resolveProtectionTypeChoice(t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          // ── Protection creature choice (Pippin) ──
          case 'protection_creature_choice': {
            const ptCreatures = (wi as any).choices || [];
            const chosenType = gs?._pendingProtectionGrant?.chosenType || '?';
            return (
              <CreatureChoiceOverlay
                creatures={ptCreatures}
                title={`🛡 Choose creature to gain protection from ${chosenType}s`}
                optional={false}
                onConfirm={uid => actions.resolveProtectionCreatureChoice(uid)}
              />
            );
          }

          // ── Unless exile aura choice (Morgul-Knife Wound) ──
          case 'unless_exile_choice': {
            const auraName = (wi as any).auraName || 'the Aura';
            const lifeAmt = (wi as any).amount || 2;
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}>
                <div className="overlay-panel glass" style={{ maxWidth: 400 }}>
                  <h3 className="overlay-title">⚡ Upkeep Trigger</h3>
                  <p style={{ textAlign: 'center', marginBottom: 16, opacity: 0.8 }}>
                    Lose {lifeAmt} life unless you exile <strong>{auraName}</strong>.
                  </p>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <button className="btn btn-gold" onClick={() => actions.resolveUnlessExile(true)}>
                      Exile {auraName}
                    </button>
                    <button className="btn" onClick={() => actions.resolveUnlessExile(false)}>
                      Lose {lifeAmt} life
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── ETB bounce target (Iceridge Serpent, Marang River Regent, etc.) ──
          case 'etb_bounce_target': {
            const choices = (wi as any).choices || [];
            const maxBounce = (wi as any).maxBounce || 1;
            if (maxBounce > 1) {
              return (
                <BounceMultiOverlay
                  permanents={choices}
                  maxBounce={maxBounce}
                  title={`↩ Return to Hand — Choose up to ${maxBounce} permanents to return`}
                  onConfirm={uids => actions.resolveETBBounceTarget(uids)}
                />
              );
            }
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="↩ Return to Hand — Choose a permanent"
                hint="Click a permanent to bounce it to its owner's hand."
                onConfirm={uid => uid && actions.resolveETBBounceTarget([uid])}
              />
            );
          }

          // ── ETB tap target (Constrictor Sage etc.) ────────────────────────
          case 'etb_tap_target': {
            const choices = (wi as any).choices || [];
            const maxTap = (wi as any).maxTap || 1;
            if (maxTap > 1) {
              return (
                <BounceMultiOverlay
                  permanents={choices}
                  maxBounce={maxTap}
                  title={`⟳ Tap — Choose up to ${maxTap} creatures to tap`}
                  onConfirm={uids => actions.resolveETBTapTarget(uids)}
                />
              );
            }
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="⟳ Tap — Choose a creature to tap"
                hint="Click a creature to tap it."
                onConfirm={uid => actions.resolveETBTapTarget(uid ? [uid] : [])}
              />
            );
          }

          // ── ETB cant_block target (Summit Intimidator etc.) ──────────────────
          case 'etb_cant_block_target': {
            const choices = (wi as any).choices || [];
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="🚫 Choose a creature that can't block"
                hint="Click a creature — it won't be able to block this turn."
                onConfirm={uid => actions.resolveETBCantBlockTarget(uid ?? null)}
              />
            );
          }

          // ── ETB "any target" damage (Sonic Shrieker etc.) ────────────────────
          // No blocking overlay — use click-to-target: clicking a creature or life total resolves this.
          case 'etb_any_damage_target': {
            const pendingEtbDmg = gs?._pendingEtbAnyDamage || (snap as any)._pendingEtbAnyDamage;
            const dmgAmount = pendingEtbDmg?.amount || 1;
            const isCreatureOnly = pendingEtbDmg?.creatureOnly;
            return (
              <div className="instant-priority-banner" style={{ background: 'rgba(255,120,0,0.92)', color: '#fff', zIndex: 80 }}>
                <span style={{ fontWeight: 700 }}>⚡ Deal {dmgAmount} damage — click a {isCreatureOnly ? 'creature' : 'creature or life total'} to target</span>
              </div>
            );
          }

          // ── ETB counter target (Sage of the Fang etc.) ─────────────────────────
          case 'etb_counter_target': {
            const choices = (wi as any).choices || [];
            const pending = gs?._pendingETBCounter;
            const counterType = pending?.effect?.counter || '+1/+1';
            const counterAmt = pending?.effect?.amount ?? 1;
            const isOptional = pending?.effect?.optional || false;
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title={`⬆ +1/+1 Counter — Choose a creature`}
                hint={`Click a creature to put ${counterAmt} ${counterType} counter on it.${isOptional ? ' (optional)' : ''}`}
                optional={isOptional}
                onConfirm={uid => actions.resolveETBCounterTarget(uid || null)}
              />
            );
          }

          // ── ETB remove all counters target (Purging Stormbrood) ──
          case 'etb_remove_counters_target': {
            const choices = (wi as any).choices || [];
            const isOptional = gs?._pendingRemoveCountersAll?.optional;
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="Remove All Counters"
                hint="Click a creature to remove all counters from it."
                optional={isOptional}
                onConfirm={uid => actions.resolveETBRemoveCountersTarget(uid || null)}
              />
            );
          }

          // ── Watcher in the Water: phase 1 — pick Kraken to untap ──────────
          case 'watcher_tentacle_untap': {
            const krakens = (wi as any).choices || [];
            return (
              <CreatureChoiceOverlay
                creatures={krakens}
                title="Untap a Kraken (optional)"
                hint="Click a Kraken you control to untap it, or skip."
                optional={true}
                onConfirm={uid => actions.resolveWatcherTentacleUntap(uid || null)}
              />
            );
          }

          // ── Watcher in the Water: phase 2 — put stun counter on nonland ──
          case 'watcher_tentacle_stun': {
            const nonlands = (wi as any).choices || [];
            return (
              <CreatureChoiceOverlay
                creatures={nonlands}
                title="Add Stun Counter (optional)"
                hint="Click any nonland permanent to put a stun counter on it, or skip."
                optional={true}
                onConfirm={uid => actions.resolveWatcherTentacleStun(uid || null)}
              />
            );
          }

          // ── ETB exile target (Static Snare, Stormplain Detainment, Mardu Siegebreaker) ──
          case 'etb_exile_target': {
            const choices = (wi as any).choices || [];
            const maxExile = (wi as any).maxExile || 1;
            if (maxExile > 1) {
              return (
                <BounceMultiOverlay
                  permanents={choices}
                  maxBounce={maxExile}
                  title={`☄ Exile — Choose up to ${maxExile} permanents`}
                  onConfirm={uids => actions.resolveETBExileTarget(uids)}
                />
              );
            }
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="☄ Exile — Choose a permanent to exile"
                hint="Click a permanent to exile it."
                optional={!!(wi as any).optional}
                onConfirm={uid => actions.resolveETBExileTarget(uid ? [uid] : [])}
              />
            );
          }

          // ── Shire Shirriff: choose which token to sacrifice before exiling ──
          case 'sacrifice_token_choice': {
            const tokens = (wi as any).tokens || [];
            return (
              <CreatureChoiceOverlay
                creatures={tokens}
                title="🐑 Shire Shirriff — Sacrifice a token?"
                hint="Choose a token to sacrifice. Skip to play as a 2/2 with Vigilance only."
                optional={true}
                onConfirm={uid => actions.resolveSacrificeTokenChoice(uid ?? null)}
              />
            );
          }

          // ── tap_creature cost (Dragonbrood's Relic etc.) ──────────────────
          // ── ETB clone target (Naga Fleshcrafter etc.) ────────────────────
          case 'grishnakh_steal': {
            const choices = (wi as any).choices || [];
            const prompt = (wi as any).prompt || 'Choose a creature to control until end of turn';
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title={`⚔ Grishnákh — ${prompt}`}
                hint="Chosen creature gets haste and untaps. Returns at end of turn."
                optional={false}
                onConfirm={uid => actions.resolveGrishnakhSteal(uid ?? null)}
              />
            );
          }

          // ── Rangers of Ithilien / gain_control target ─────────────────────
          case 'gain_control_target': {
            const choices = (wi as any).choices || [];
            const prompt = (wi as any).prompt || 'Choose a creature to gain control of';
            const isOptional = !!(wi as any).optional;
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title={`🏹 ${prompt}`}
                hint={isOptional ? "Optional — choose a creature or skip." : "Chosen creature enters under your control."}
                optional={isOptional}
                onConfirm={uid => actions.resolveGainControlTarget(uid ?? null)}
              />
            );
          }

          // ── Mount Doom: choose creatures to spare ─────────────────────────
          case 'choose_spared_creatures': {
            const allCreatures = (wi as any).choices || [];
            const maxSpared = (wi as any).maxSpared ?? 2;
            const prompt = (wi as any).prompt || `Choose up to ${maxSpared} creatures to spare`;
            return (
              <div className="overlay-backdrop">
                <div className="overlay-box" style={{ maxWidth: 520 }}>
                  <div className="overlay-title">🌋 Mount Doom — {prompt}</div>
                  <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>Selected: {sparedCreatureUids.length}/{maxSpared}. All other creatures will be destroyed.</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxHeight: 300, overflowY: 'auto' }}>
                    {allCreatures.map((c: any) => {
                      const isSelected = sparedCreatureUids.includes(c._uid);
                      return (
                        <div
                          key={c._uid}
                          onClick={() => {
                            if (isSelected) setSparedCreatureUids(prev => prev.filter(u => u !== c._uid));
                            else if (sparedCreatureUids.length < maxSpared) setSparedCreatureUids(prev => [...prev, c._uid]);
                          }}
                          style={{
                            border: isSelected ? '2px solid #4ecdc4' : '2px solid #555',
                            borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                            background: isSelected ? 'rgba(78,205,196,0.2)' : 'rgba(0,0,0,0.4)',
                            color: '#eee', fontSize: 12, textAlign: 'center',
                          }}
                        >
                          {c.name}<br/><span style={{color:'#aaa'}}>{c._ownerPid === 0 ? '(Yours)' : '(Opp)'}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button className="btn btn-primary" onClick={() => { actions.resolveChooseSparedCreatures(sparedCreatureUids); setSparedCreatureUids([]); }}>
                      Destroy Rest ({allCreatures.length - sparedCreatureUids.length} creatures)
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          case 'etb_clone_target': {
            const choices = (wi as any).choices || [];
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="🐍 Clone — Choose a creature to copy"
                hint="This creature becomes a copy of the chosen creature. Optional."
                optional
                onConfirm={uid => actions.resolveETBCloneTarget(uid ?? null)}
              />
            );
          }

          case 'tap_creature_cost': {
            const choices = (wi as any).choices || [];
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="⟳ Cost — Choose a creature to tap"
                hint="Tap this creature as part of the ability cost."
                optional
                onConfirm={uid => actions.resolveActivationTapCreature(uid)}
              />
            );
          }

          // ── Crew vehicle ─────────────────────────────────────────────────
          case 'crew_vehicle': {
            const crewChoices = (wi as any).choices || [];
            const crewCost = (wi as any).crewCost ?? 3;
            return (
              <CrewOverlay
                creatures={crewChoices}
                crewCost={crewCost}
                onConfirm={uids => actions.resolveCrew(uids)}
              />
            );
          }

          // ── Look top cards ───────────────────────────────────────────────
          case 'look_top_choice':
          case 'look_top_land_choice':
          case 'look_top_permanent_choice': {
            const pending = gs?._pendingLookTop;
            if (!pending) return null;
            // Build dynamic props based on the type of look_top effect
            let ltCards: any[], ltPickCount: number, ltTitle: string, ltHint: string, ltKeepLabel: string, ltDiscardLabel: string;
            if (pending.type === 'look_top_permanent_choice') {
              ltCards = pending.cards || [];
              ltPickCount = pending.putCount ?? 2;
              ltTitle = 'Choose Permanents';
              const nCandidates = (pending.candidates || []).length;
              ltHint = nCandidates > 0
                ? `Put up to ${ltPickCount} non-creature permanent(s) (cost ≤3) onto the battlefield. The rest go to the bottom of your library.`
                : `No eligible permanents found. All cards go to the bottom of your library.`;
              ltKeepLabel = '⚔ Battlefield';
              ltDiscardLabel = '⬇ Library';
            } else if (pending.type === 'look_top_land_choice') {
              ltCards = pending.lands || pending.cards || [];
              ltPickCount = pending.pickCount ?? 1;
              ltTitle = 'Choose Land';
              ltHint = `Choose up to ${ltPickCount} land(s) to put into your hand.`;
              ltKeepLabel = '✋ Hand';
              ltDiscardLabel = '⬇ Library';
            } else {
              // look_top_choice: pick to hand/top, rest to graveyard or bottom
              ltCards = pending.cards || [];
              ltPickCount = pending.pickCount ?? 1;
              const toBottom = pending.restDestination === 'bottom';
              const pickToTop = pending.pickTo === 'top';
              ltTitle = 'Choose Cards';
              ltHint = pickToTop
                ? `Choose ${ltPickCount} card(s) to put on top of your library. The rest go to the graveyard.`
                : `Choose ${ltPickCount} card(s) to put into your hand. The rest go to the ${toBottom ? 'bottom of your library' : 'graveyard'}.`;
              ltKeepLabel = pickToTop ? '📚 Top' : '✋ Hand';
              ltDiscardLabel = toBottom ? '⬇ Library' : '💀 Graveyard';
            }
            const ltValidUids = pending.type === 'look_top_permanent_choice'
              ? (pending.candidates || []).map((c: any) => c._uid)
              : undefined;
            return (
              <LookTopOverlay
                cards={ltCards}
                pickCount={ltPickCount}
                title={ltTitle}
                hint={ltHint}
                keepLabel={ltKeepLabel}
                discardLabel={ltDiscardLabel}
                onConfirm={actions.resolveLookTop}
              />
            );
          }

          // ── Bounce to library choice (Riverwalk Technique) ──────────────
          case 'bounce_to_library_choice': {
            const blPending = gs?._pendingBounceToLibrary;
            if (!blPending) return null;
            return (
              <div className="overlay-backdrop" style={{zIndex: 10000}}>
                <div className="overlay-panel" style={{maxWidth: 360, textAlign: 'center', padding: 20}}>
                  <h3 style={{margin: '0 0 8px'}}>Top or Bottom?</h3>
                  <p style={{fontSize: 13, color: '#aaa', margin: '0 0 12px'}}>
                    Put {blPending.card.name} on top or bottom of the library?
                  </p>
                  <div style={{display: 'flex', justifyContent: 'center', marginBottom: 12}}>
                    <img
                      src={blPending.card.image_uris?.normal || blPending.card.image_uris?.small || ''}
                      alt={blPending.card.name}
                      style={{width: 180, borderRadius: 8}}
                    />
                  </div>
                  <div style={{display: 'flex', gap: 8, justifyContent: 'center'}}>
                    <button className="btn-primary" onClick={() => actions.resolveBounceToLibrary('top')}>
                      📚 Top
                    </button>
                    <button className="btn-secondary" onClick={() => actions.resolveBounceToLibrary('bottom')}>
                      ⬇ Bottom
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Traveling Botanist look ─────────────────────────────────────
          case 'botanist_look': {
            const bPending = gs?._pendingBotanistLook;
            if (!bPending) return null;
            const bCard = bPending.card;
            const bIsLand = bPending.isLand;
            const bImgUrl = bCard.image_normal || bCard.image_small || bCard.image_uris?.normal || bCard.image_uris?.small || '';
            return (
              <div className="overlay-backdrop" style={{zIndex: 10000}}>
                <div className="glass overlay-panel" style={{maxWidth: 420, padding: '24px 28px', textAlign: 'center'}}>
                  <h3 style={{margin: '0 0 4px', fontSize: 16, color: '#fff'}}>Traveling Botanist</h3>
                  <p style={{fontSize: 13, color: '#9aa', margin: '0 0 16px'}}>
                    {bIsLand
                      ? 'It\'s a land! You may put it into your hand.'
                      : 'Not a land. You may put it into the graveyard or leave it on top.'}
                  </p>
                  <div style={{display: 'flex', justifyContent: 'center', marginBottom: 16}}>
                    <img
                      src={bImgUrl}
                      alt={bCard.name}
                      style={{width: 200, borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.6)', border: bIsLand ? '2px solid #4a4' : '2px solid #555'}}
                    />
                  </div>
                  <div style={{display: 'flex', gap: 10, justifyContent: 'center'}}>
                    {bIsLand && (
                      <button className="btn-primary" style={{padding: '8px 20px', fontSize: 14}} onClick={() => actions.resolveBotanistLook('hand')}>
                        Hand
                      </button>
                    )}
                    <button className="btn-secondary" style={{padding: '8px 20px', fontSize: 14}} onClick={() => actions.resolveBotanistLook('graveyard')}>
                      Graveyard
                    </button>
                    <button className="btn-secondary" style={{padding: '8px 20px', fontSize: 14}} onClick={() => actions.resolveBotanistLook('top')}>
                      Top of Library
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Reveal pick (Dragonologist etc.) ────────────────────────────
          case 'reveal_pick': {
            const pending = gs?._pendingRevealPick;
            if (!pending) return null;
            return (
              <RevealPickOverlay
                cards={pending.cards}
                validUids={pending.validUids}
                multiSelect={pending.multiSelect}
                title={pending.multiSelect ? '👁 Reveal — Choose any number' : '👁 Reveal — Choose a card'}
                hint={pending.multiSelect
                  ? 'Click highlighted cards to select any to put onto the battlefield, then confirm.'
                  : 'Choose a valid (highlighted) card to put into your hand, or skip.'}
                onConfirm={actions.resolveRevealPick}
              />
            );
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

          // ── Trigger ordering ─────────────────────────────────────────────
          case 'trigger_order': {
            const triggerList = (wi as any).triggers || [];
            return (
              <TriggerOrderOverlay
                triggers={triggerList}
                onConfirm={(orderedIndices: number[]) => actions.resolveTriggerOrder(orderedIndices)}
              />
            );
          }

          // ── Confirm optional ─────────────────────────────────────────────
          case 'confirm_optional':
            return (
              <ConfirmOptionalOverlay
                message={wi.message as string || 'Activate this optional effect?'}
                onConfirm={actions.resolveConfirmOptional}
              />
            );

          // ── Optional mill ──────────────────────────────────────────────────
          case 'optional_mill': {
            const millPending = gs?._pendingOptionalMill;
            return millPending ? (
              <ConfirmOptionalOverlay
                message={`Mill ${millPending.amount} cards?`}
                onConfirm={(yes: boolean) => actions.resolveOptionalMill(yes)}
              />
            ) : null;
          }

          // ── Ward payment ──────────────────────────────────────────────────
          case 'ward_confirm': {
            const wardCost = (wi as any).wardCost ?? '?';
            const wardName = (wi as any).creatureName ?? 'creature';
            return (
              <ConfirmOptionalOverlay
                message={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {wardName} tem Ward {wardCost}. Pagar <ManaCostPips cost={`{${wardCost}}`} size={15} /> mana extra para continuar? (Não = cancelar spell)
                </span>}
                onConfirm={actions.resolveWardConfirm}
              />
            );
          }

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

          // ── Exile reveal (Kotis, etc.) ──────────────────────────────────
          case 'exile_reveal': {
            const exReveal = gs?._pendingExileReveal;
            if (!exReveal) return null;
            const exCards: any[] = exReveal.cards || [];
            const canPlayExile = !!exReveal.canPlay;
            return (
              <div className="overlay-backdrop" style={{ zIndex: 900 }}>
                <div className="overlay-panel" style={{ maxWidth: 600, padding: '20px 24px' }}>
                  <h2 style={{ color: '#ffd700', marginBottom: 8 }}>Exiled Cards</h2>
                  <p style={{ color: '#ccc', fontSize: 13, marginBottom: 12 }}>
                    {canPlayExile ? 'You may play these cards while they are exiled. Click to cast now or close to play later (during your main phase).' : 'These cards were exiled from the top of the opponent\'s library.'}
                  </p>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {exCards.map((ec: any) => {
                      const isLandCard = (ec.type_line || '').toLowerCase().includes('land');
                      const isCreatureCard = (ec.type_line || '').includes('Creature');
                      // Check if spell requires targets and has valid targets available
                      let hasTargets = true;
                      if (!isLandCard && !isCreatureCard && gs) {
                        const spellEffects = getPreprocessedEffects(ec)?.cast || [];
                        for (const eff of spellEffects) {
                          if (eff.target === 'creature' || eff.target === 'opponent_creature') {
                            const oppBf = gs.players[1].zones.battlefield.cards.filter((c: any) => c.type_line?.includes('Creature'));
                            const myBf = gs.players[0].zones.battlefield.cards.filter((c: any) => c.type_line?.includes('Creature'));
                            const pool = eff.target === 'opponent_creature' ? oppBf : [...oppBf, ...myBf];
                            if (pool.length === 0) hasTargets = false;
                          }
                        }
                      }
                      const isFreeExile = !!ec._freeCast || !!(gs?._exiledPlayable?.[ec._uid]?.freeCast);
                      // Check max_mv restriction (Kotis: can only cast spells with mana value ≤ X)
                      const exileMaxMv = exReveal.maxMv;
                      const mvAllowed = exileMaxMv === undefined || exileMaxMv === null || (ec.cmc || 0) <= exileMaxMv;
                      // castOnly: lands can't be "cast" (Kotis says "cast", not "play")
                      const landBlocked = isLandCard && !!exReveal.castOnly;
                      const isPlayable = canPlayExile && !landBlocked && (isLandCard || !!(ec.mana_cost) || isFreeExile || isCreatureCard) && hasTargets && mvAllowed;
                      const isAdventureCard = ec.layout === 'adventure' && ec.back_face?.name;
                      return (
                        <div key={ec._uid} style={{ textAlign: 'center', cursor: isPlayable ? 'pointer' : 'default', opacity: isPlayable ? 1 : 0.45 }}>
                          <img src={ec.image_normal || ec.image_small} alt={ec.name}
                            onClick={() => {
                              if (isPlayable && !isAdventureCard) {
                                // If spell needs targeting, close overlay and enter targeting mode
                                if (spellNeedsTargeting(ec)) {
                                  const gs2 = gsRef.current;
                                  if (gs2) {
                                    (gs2 as any)._pendingExileReveal = null;
                                    gs2.waitingForInput = null;
                                  }
                                  setTargeting({ cardUid: ec._uid, card: ec });
                                } else {
                                  actions.resolveExileReveal(ec._uid);
                                }
                              }
                            }}
                            title={isPlayable ? (isAdventureCard ? 'Choose which side to cast' : 'Click to play') : 'Cannot be played'}
                            style={{ width: 140, borderRadius: 8, border: isPlayable ? '2px solid #ffd700' : '2px solid #555' }} />
                          <div style={{ color: isPlayable ? '#ffd700' : '#888', fontSize: 11, marginTop: 4 }}>{ec.name}</div>
                          {isPlayable && isAdventureCard && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'center' }}>
                              <button className="btn btn-gold btn-sm" onClick={() => {
                                actions.resolveExileReveal(ec._uid);
                              }}>{ec.name} (Creature)</button>
                              <button className="btn btn-gold btn-sm" onClick={() => {
                                // Close overlay, then cast adventure face
                                const gs2 = gsRef.current;
                                if (gs2) {
                                  (gs2 as any)._pendingExileReveal = null;
                                  gs2.waitingForInput = null;
                                }
                                actions.castAdventure(ec._uid);
                              }}>{ec.back_face?.name} (Omen)</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button className="overlay-btn" style={{ marginTop: 16 }}
                    onClick={() => actions.resolveExileReveal(null)}>
                    Fechar {canPlayExile ? '(jogar depois)' : ''}
                  </button>
                </div>
              </div>
            );
          }

          // ── Mill land choice ─────────────────────────────────────────────
          case 'mill_land_choice': {
            const pending = gs?._pendingMillLandChoice;
            return (
              <MillLandChoiceOverlay
                milledLands={pending?.milledLands || []}
                milledAll={pending?.milledAll || pending?.milledLands || []}
                onConfirm={(choice, landUid) => actions.resolveMillLand(choice, landUid)}
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
            // Compute cost description from trigger_cost (Nimble Hobbit pattern) or effect.cost
            const costEffect = (trigger?.effects || []).find((e: any) => e.cost);
            const tc = trigger?.trigger_cost;
            const costDesc = trigger?.costDescription ||
              (tc ? [tc.sacrifice ? `Sacrifice a ${tc.sacrifice}` : '', tc.or_mana ? `pay ${formatRawMana(String(tc.or_mana))}` : ''].filter(Boolean).join(' or ') : null) ||
              (costEffect?.cost ? formatRawMana(String(costEffect.cost)) : null);
            const triggerEffectDesc = (trigger?.effects || []).map((e: any) => {
              const t = e.type; const amt = e.amount; const tgt = e.target;
              if (t === 'endure') return `Endure ${amt} (put ${amt} +1/+1 counter or create a 1/1 white Spirit token)`;
              if (t === 'draw') return `Draw ${amt} card${amt !== 1 ? 's' : ''}`;
              if (t === 'damage') return `Deal ${amt} damage${tgt ? ` to ${tgt}` : ''}`;
              if (t === 'gainLife') return `Gain ${amt} life`;
              if (t === 'destroy') return `Destroy ${tgt || 'permanent'}`;
              if (t === 'counter_self') return `+${e.amount || 1}/+${e.amount || 1} counters`;
              if (t === 'create_token') return `Create ${e.name || ''} ${e.power}/${e.toughness} token`;
              if (t === 'buff') return `+${e.power}/${e.toughness} until end of turn`;
              if (t === 'scry') return `Scry ${amt}`;
              if (t === 'surveil') return `Surveil ${amt}`;
              if (t === 'mill') return `Mill ${amt}`;
              return t.replace(/_/g, ' ');
            }).filter(Boolean).join(', ');
            return (
              <TriggerCostOverlay
                triggerName={trigger?.cardName || 'Trigger'}
                costDesc={costDesc}
                effectDesc={triggerEffectDesc || undefined}
                onConfirm={actions.resolveTriggerCostAction}
              />
            );
          }

          // ── Mill target choice (any_player: choose who mills) ────────────
          case 'mill_target_choice': {
            const pending = gs?._pendingMillTargetChoice;
            const millAmt = pending?.powerAmount || pending?.effect?.amount || 1;
            return (
              <div className="overlay-backdrop">
                <div className="overlay-panel glass" style={{ maxWidth: 340, textAlign: 'center' }}>
                  <h3 className="overlay-title">Who to mill?</h3>
                  <p className="overlay-hint">Mill {millAmt} card(s)</p>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
                    <button className="btn btn-muted" onClick={() => actions.resolveMillTargetChoice(true)}>
                      Yourself
                    </button>
                    <button className="btn btn-danger" onClick={() => actions.resolveMillTargetChoice(false)}>
                      Opponent
                    </button>
                  </div>
                </div>
              </div>
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
                title={`✨ Exile — Choose ${pending.choose || 1} to play`}
                hint="Choose which exiled card to play."
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

          case 'opponent_hand_exile': {
            const pendingOpp = gs?._pendingHandExile;
            const oppCards = pendingOpp?.cards || [];
            return (
              <SearchLibraryOverlay
                candidates={oppCards}
                title="✋ Exile from Opponent's Hand"
                hint="Choose a nonland card to exile."
                onConfirm={uid => uid && actions.resolveHandExile(uid)}
              />
            );
          }

          // ── Graveyard cast choice: pick specific card to cast ──────────────
          case 'graveyard_cast_choice': {
            const pending = gs?._pendingGraveyardCastChoice;
            const cards = pending?.cards || [];
            return (
              <SearchLibraryOverlay
                candidates={cards}
                title="☠ Cast from Graveyard"
                hint="Choose a creature to exile and cast for free."
                onConfirm={uid => uid && actions.resolveGraveyardCastChoice(uid)}
              />
            );
          }

          // ── Attach choice: equip token optional confirmation ─────────────
          case 'attach_choice': {
            const pending = gs?._pendingAttachChoice;
            const tokenName = pending?.tokenName || 'Token';
            const targetName = pending?.targetName || 'creature';
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8000 }}>
                <div className="glass overlay-panel" style={{ maxWidth: 380, padding: 24, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--gold)', fontSize: 16 }}>⚔ Equip Token?</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                    Equip <strong>{tokenName}</strong> to <strong>{targetName}</strong>?
                  </div>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <button className="btn btn-gold" onClick={() => actions.resolveAttachChoice(true)}>
                      ✓ Equip
                    </button>
                    <button className="btn btn-muted" onClick={() => actions.resolveAttachChoice(false)}>
                      ✗ Skip
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Graveyard choice: pick which player's GY ─────────────────────
          case 'graveyard_choice': {
            const myGy = snap.players[0].graveyard;
            const oppGy = snap.players[1].graveyard;
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8000 }}>
                <div className="glass overlay-panel" style={{ maxWidth: 380, padding: 24, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--gold)', fontSize: 16 }}>☠ Exile from Graveyard</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                    Choose which graveyard to exile from:
                  </div>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <button className="btn btn-gold" onClick={() => actions.resolveGraveyardChoice(0)}>
                      Your Graveyard ({myGy.length})
                    </button>
                    <button className="btn btn-muted" onClick={() => actions.resolveGraveyardChoice(1)}>
                      Opponent's Graveyard ({oppGy.length})
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Player choice: pick which player for an effect ──────────────
          case 'player_choice': {
            const pendingPC = gs?._pendingPlayerChoice;
            const pcAmount = pendingPC?.amount || 0;
            const pcType = pendingPC?.effectType || 'effect';
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8000 }}>
                <div className="glass overlay-panel" style={{ maxWidth: 380, padding: 24, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--gold)', fontSize: 16 }}>Choose Target Player</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                    {pcType === 'mill' ? `Mill ${pcAmount} cards — choose who:` : `Choose target player:`}
                  </div>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <button className="btn btn-muted" onClick={() => actions.resolvePlayerChoice(0)}>
                      Yourself
                    </button>
                    <button className="btn btn-gold" onClick={() => actions.resolvePlayerChoice(1)}>
                      Opponent
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Delve choice: exile GY cards to reduce spell cost ─────────────
          case 'delve_choice': {
            const pending = gs?._pendingDelveChoice;
            if (!pending) return null;
            const gyCards = snap.players[0].graveyard.filter(
              (c: any) => !(c.type_line || '').toLowerCase().includes('land')
            );
            return (
              <GraveyardMultiSelectOverlay
                cards={gyCards}
                amount={pending.maxDelve ?? 1}
                minAmount={0}
                title={`🌀 Delve — Exile cards to pay {1} each (max ${pending.maxDelve ?? 1})`}
                onConfirm={uids => actions.resolveDelveChoice(uids)}
              />
            );
          }

          // ── Graveyard card choice: pick specific cards ────────────────────
          case 'graveyard_card_choice': {
            const pending = gs?._pendingGraveyardCardChoice;
            if (!pending) return null;
            const pid = pending.playerId ?? 0;
            const gyFiltered = pending.cards ?? snap.players[pid].graveyard;
            const isShuffleMode = pending.mode === 'shuffle_to_library';
            const gyTitle = isShuffleMode
              ? `🔀 Bath Song — Shuffle any cards back (${pending.addManaPerCard || 'UU'} per card)`
              : `☠ Exile from ${pid === 0 ? 'Your' : "Opponent's"} Graveyard`;
            return (
              <GraveyardMultiSelectOverlay
                cards={gyFiltered}
                amount={pending.amount ?? 1}
                minAmount={pending.minAmount ?? 0}
                exactAmount={pending.exactAmount}
                title={gyTitle}
                onConfirm={uids => actions.resolveGraveyardCardChoice(uids)}
              />
            );
          }

          // ── Friendly Rivalry — 3-step targeting ──────────────────────────
          case 'multi_untap_choose': {
            const muChoices = (wi as any).choices || [];
            const muMax = (wi as any).maxCount || 2;
            return (
              <BounceMultiOverlay
                permanents={muChoices}
                maxBounce={muMax}
                title={`⟳ Untap — Choose up to ${muMax} permanents`}
                onConfirm={uids => actions.resolveMultiUntap(uids)}
              />
            );
          }

          case 'tap_or_untap_choose': {
            // No modal — the user clicks a card directly on the battlefield.
            // Just render a floating banner so they know what to do.
            return (
              <div style={{
                position: 'fixed', bottom: 120, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(20,15,40,0.95)', border: '1px solid var(--gold)',
                borderRadius: 10, padding: '10px 20px', zIndex: 300,
                color: 'var(--text-primary)', fontSize: 13, textAlign: 'center',
                pointerEvents: 'none',
              }}>
                ⟳ <strong>Tap or Untap</strong> — Click any permanent on the battlefield
              </div>
            );
          }

          case 'friendly_rivalry_choose': {
            const step = (wi as any).step as number;
            const choices = (wi as any).choices || [];
            const titles: Record<number, string> = {
              1: '⚔ Friendly Rivalry — Choose YOUR first creature',
              2: '⚔ Friendly Rivalry — Choose YOUR second creature',
              3: '⚔ Friendly Rivalry — Choose OPPONENT\'s creature to deal damage to',
            };
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title={titles[step] || '⚔ Friendly Rivalry'}
                hint={step === 2 ? 'Choose another creature you control (should share a creature type).' : undefined}
                optional={step === 2}
                skipLabel="Only one creature (skip)"
                onConfirm={uid => actions.resolveFriendlyRivalryChoice(uid)}
              />
            );
          }

          // ── Galadhrim Bow ETB: choose creature to attach equipment to ────
          case 'attach_own_creature': {
            const choices = (wi as any).choices || [];
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="🗡 Attach Equipment"
                hint="Choose one of your creatures to attach the equipment to."
                onConfirm={uid => actions.resolveAttachOwnCreature(uid)}
              />
            );
          }

          // ── Shagrat: choose equipment to attach for free (optional) ──────────
          case 'attach_equipment_choice': {
            const choices = (wi as any).choices || [];
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="⚔ Attach Equipment (Free)"
                hint="Choose an Equipment to attach for free, or skip."
                optional={true}
                skipLabel="Skip"
                onConfirm={uid => actions.resolveAttachEquipmentChoice(uid)}
              />
            );
          }

          // ── Goldberry: choose target for counter move ────────────────────────────
          case 'move_counters_target': {
            const direction = (wi as any).direction;
            const choices = (wi as any).choices || [];
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title={direction === 'to_self' ? '💧 Move counters from target' : '💧 Move counters to target'}
                hint={direction === 'to_self' ? 'Choose a permanent to move its counters onto Goldberry.' : 'Choose a creature to receive one counter of each type from Goldberry.'}
                onConfirm={uid => actions.resolveMoveCountersTarget(uid)}
              />
            );
          }

          // ── Goldberry ability 2: choose how many counters of each type to move ──
          case 'move_counters_amount': {
            const avail: Record<string, number> = (wi as any).availableCounters || {};
            return <GoldberryCounterSelector available={avail} onConfirm={amounts => actions.resolveMoveCountersAmount(amounts)} />;
          }

          // ── Fireleaper / damage_creature_target: choose creature to deal damage to ───
          case 'damage_creature_target': {
            const choices = (wi as any).choices || [];
            const amount: number = (wi as any).amount || 1;
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title={`Deal ${amount} Damage — Choose target`}
                hint="Choose a creature to deal damage to."
                onConfirm={uid => actions.resolveDamageCreatureTarget(uid)}
              />
            );
          }

          // ── Gimli fight: choose opponent creature to fight ───────────────
          case 'fight_choose_target': {
            const choices = (wi as any).choices || [];
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="⚔ Fight — Choose target creature"
                hint="Choose an opponent's creature to fight."
                onConfirm={uid => actions.resolveFightTarget(uid)}
              />
            );
          }

          // ── Glamdring free cast: choose inst/sorc from hand ──────────────
          case 'free_cast_from_hand': {
            const eligibleUids: string[] = (wi as any).eligible || [];
            const maxMv: number = (wi as any).maxMv || 0;
            const handCards = snap.players[0].hand.filter((c: any) => eligibleUids.includes(c._uid));
            return (
              <div className="overlay-backdrop" style={{zIndex: 10000}}>
                <div className="glass overlay-panel" style={{maxWidth: 500, padding: '24px 28px'}}>
                  <h3 style={{margin: '0 0 8px', fontSize: 16, color: '#fff'}}>
                    ⚡ Glamdring — Free Cast (MV ≤ {maxMv})
                  </h3>
                  <p style={{fontSize: 13, color: '#9aa', margin: '0 0 16px'}}>
                    Cast an instant or sorcery from your hand without paying its mana cost.
                  </p>
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 16}}>
                    {handCards.map((c: any) => (
                      <button
                        key={c._uid}
                        className="btn-primary"
                        style={{padding: '6px 14px', fontSize: 13}}
                        onClick={() => actions.resolveFreeCastFromHand(c._uid)}
                      >
                        {c.name} ({c.cmc || 0})
                      </button>
                    ))}
                  </div>
                  <button className="btn-secondary" style={{padding: '6px 16px', fontSize: 13}} onClick={() => actions.resolveFreeCastFromHand(null)}>
                    Skip
                  </button>
                </div>
              </div>
            );
          }

          // ── Free cast from exile (Shadow of the Enemy) ────────────────────
          case 'free_cast_from_exile': {
            const exileEligible: string[] = (wi as any).eligible || [];
            const exiledPlayable = gs?._exiledPlayable || {};
            const exileCards: any[] = exileEligible
              .map((uid: string) => exiledPlayable[uid]?.card)
              .filter(Boolean);
            return (
              <div className="overlay-backdrop" style={{zIndex: 10000}}>
                <div className="glass overlay-panel" style={{maxWidth: 600, padding: '24px 28px'}}>
                  <h3 style={{margin: '0 0 6px', fontSize: 16, color: '#fff'}}>
                    🌑 Shadow of the Enemy — Free Cast
                  </h3>
                  <p style={{fontSize: 12, color: '#9aa', margin: '0 0 16px'}}>
                    You may cast any of these creature cards without paying their mana costs.
                  </p>
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginBottom: 16}}>
                    {exileCards.map((c: any) => (
                      <div key={c._uid} style={{textAlign: 'center', cursor: 'pointer'}}
                        onClick={() => actions.resolveFreeCastFromExile(c._uid)}>
                        <div style={{position: 'relative', width: 88}}>
                          <CardImage card={c} size="small" />
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            background: 'rgba(0,180,255,0.85)', fontSize: 10, color: '#fff',
                            textAlign: 'center', padding: '2px 3px', borderRadius: '0 0 4px 4px',
                          }}>▶ Cast Free</div>
                        </div>
                        <div style={{fontSize: 10, color: '#aaa', marginTop: 3, maxWidth: 88, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis'}}>{c.name}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{textAlign: 'center'}}>
                    <button className="btn-secondary" style={{padding: '6px 20px', fontSize: 13}}
                      onClick={() => actions.resolveFreeCastFromExile(null)}>
                      Done (pass)
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Sauron's Ransom pile choice ────────────────────────────────────
          case 'saurons_ransom_choice': {
            const faceDownPile: any[] = (wi as any).faceDownPile || gs?._pendingSauronsRansom?.faceDownPile || [];
            const faceUpPile: any[] = (wi as any).faceUpPile || gs?._pendingSauronsRansom?.faceUpPile || [];
            const renderFaceDown = (count: number) => (
              <div style={{display: 'flex', flexDirection: 'column', gap: 6, minWidth: 130, alignItems: 'center'}}>
                {Array.from({length: count}).map((_, i) => (
                  <img key={i} src={cardBackImg}
                    style={{width: 88, height: 124, borderRadius: 6, objectFit: 'cover', border: '2px solid #446'}}
                    alt="Card back" />
                ))}
              </div>
            );
            const renderFaceUp = (cards: any[]) => (
              <div style={{display: 'flex', flexDirection: 'column', gap: 6, minWidth: 130, alignItems: 'center'}}>
                {cards.map((c: any, i: number) => (
                  <div key={i} style={{position: 'relative', width: 88}}>
                    <CardImage card={c} size="small" />
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      background: 'rgba(0,0,0,0.82)', fontSize: 9, color: '#fff',
                      textAlign: 'center', padding: '2px 3px', borderRadius: '0 0 4px 4px',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{c.name}</div>
                  </div>
                ))}
              </div>
            );
            return (
              <div className="overlay-backdrop" style={{zIndex: 10000}}>
                <div className="glass overlay-panel" style={{maxWidth: 560, padding: '24px 28px'}}>
                  <h3 style={{margin: '0 0 6px', fontSize: 16, color: '#fff'}}>
                    👁 Sauron's Ransom — Choose a Pile
                  </h3>
                  <p style={{fontSize: 12, color: '#9aa', margin: '0 0 18px'}}>
                    Opponent separated the cards into a hidden pile and a revealed pile.<br/>
                    Put one pile into your hand and the other into your graveyard.
                  </p>
                  <div style={{display: 'flex', gap: 32, justifyContent: 'center', marginBottom: 20, alignItems: 'flex-start'}}>
                    <div style={{textAlign: 'center'}}>
                      <div style={{fontSize: 12, color: '#a88', marginBottom: 10, fontWeight: 600}}>
                        🂠 Hidden ({faceDownPile.length} card{faceDownPile.length !== 1 ? 's' : ''})
                      </div>
                      {renderFaceDown(faceDownPile.length)}
                      <button className="btn-primary" style={{marginTop: 14, padding: '7px 20px', width: '100%'}}
                        onClick={() => actions.resolveSauronsRansomChoice(0)}>
                        Take → Hand
                      </button>
                    </div>
                    <div style={{textAlign: 'center'}}>
                      <div style={{fontSize: 12, color: '#8a8', marginBottom: 10, fontWeight: 600}}>
                        👁 Revealed ({faceUpPile.length} card{faceUpPile.length !== 1 ? 's' : ''})
                      </div>
                      {renderFaceUp(faceUpPile)}
                      <button className="btn-primary" style={{marginTop: 14, padding: '7px 20px', width: '100%'}}
                        onClick={() => actions.resolveSauronsRansomChoice(1)}>
                        Take → Hand
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // ── Multi-tap choice (e.g. Scroll of Isildur ch2: tap up to 2 creatures) ─────────
          case 'multi_tap_choice': {
            const mtPending = gs?._pendingMultiTap;
            const mtTargets: any[] = mtPending?.targets || (wi as any).targets || [];
            const mtUpTo: number = mtPending?.up_to || (wi as any).up_to || 2;

            return (
              <div className="overlay-backdrop" style={{zIndex: 10000}}>
                <div className="glass overlay-panel" style={{maxWidth: 480, padding: '24px 28px'}}>
                  <h3 style={{margin: '0 0 8px', fontSize: 16, color: '#fff'}}>
                    Tap up to {mtUpTo} Creatures
                  </h3>
                  <p style={{fontSize: 13, color: '#9aa', margin: '0 0 12px'}}>
                    Selected: {multiTapSelected.length} / {mtUpTo}. Click to toggle selection.
                  </p>
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16}}>
                    {mtTargets.map((c: any) => {
                      const sel = multiTapSelected.includes(c._uid);
                      return (
                        <div key={c._uid}
                          onClick={() => setMultiTapSelected(prev =>
                            sel ? prev.filter(u => u !== c._uid)
                                : prev.length < mtUpTo ? [...prev, c._uid] : prev
                          )}
                          style={{
                            padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                            background: sel ? 'rgba(100,200,255,0.3)' : 'rgba(255,255,255,0.08)',
                            border: sel ? '1px solid #6cf' : '1px solid transparent',
                            color: sel ? '#6cf' : '#ccc',
                          }}>
                          {c.name} ({c.power}/{c.toughness})
                        </div>
                      );
                    })}
                  </div>
                  <div style={{display: 'flex', gap: 12, justifyContent: 'center'}}>
                    <button className="btn-primary" disabled={multiTapSelected.length === 0}
                      onClick={() => { actions.resolveMultiTapChoice(multiTapSelected); setMultiTapSelected([]); }}>
                      Tap Selected ({multiTapSelected.length})
                    </button>
                    <button className="btn-secondary"
                      onClick={() => { actions.resolveMultiTapChoice([]); setMultiTapSelected([]); }}>
                      Skip
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Choose GY return ─────────────────────────────────────────────
          case 'choose_gy_return': {
            const pending = gs?._pendingGYReturn;
            const candidates = pending?.candidates || snap.players[0].graveyard;
            const gyReturnAmt = pending?.amount || 1;
            return gyReturnAmt > 1 ? (
              <GraveyardMultiSelectOverlay
                cards={candidates}
                amount={gyReturnAmt}
                minAmount={0}
                title={`⬆ Return from Graveyard (up to ${gyReturnAmt})`}
                onConfirm={uids => actions.resolveGYReturn(uids)}
              />
            ) : (
              <SearchLibraryOverlay
                candidates={candidates}
                optional={(wi as any).optional}
                title="⬆ Return from Graveyard"
                hint="Choose a card to return to hand."
                onConfirm={uid => actions.resolveGYReturn(uid ? [uid] : [])}
              />
            );
          }

          // ── Rite of Renewal: choose player ──────────────────────────────
          case 'shuffle_gy_choose_player': {
            return (
              <div className="overlay-backdrop" style={{zIndex: 10000}}>
                <div className="glass overlay-panel" style={{maxWidth: 380, padding: '24px 28px', textAlign: 'center'}}>
                  <h3 style={{margin: '0 0 8px', fontSize: 16, color: '#fff'}}>Rite of Renewal</h3>
                  <p style={{fontSize: 13, color: '#9aa', margin: '0 0 16px'}}>
                    Choose a player to shuffle up to 4 cards from their graveyard into their library.
                  </p>
                  <div style={{display: 'flex', gap: 10, justifyContent: 'center'}}>
                    <button className="btn-primary" style={{padding: '8px 20px', fontSize: 14}} onClick={() => actions.resolveShuffleGYChoosePlayer(0)}>
                      Yourself
                    </button>
                    <button className="btn-secondary" style={{padding: '8px 20px', fontSize: 14}} onClick={() => actions.resolveShuffleGYChoosePlayer(1)}>
                      Opponent
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Rite of Renewal: choose cards from GY ────────────────────────
          case 'shuffle_gy_choose_cards': {
            const shPending = gs?._pendingShuffleGY;
            const shCandidates = shPending?.candidates || [];
            const shAmount = shPending?.amount || 4;
            return (
              <GraveyardMultiSelectOverlay
                cards={shCandidates}
                amount={shAmount}
                minAmount={0}
                title={`📚 Shuffle into Library (up to ${shAmount})`}
                onConfirm={uids => actions.resolveShuffleGYChooseCards(uids)}
              />
            );
          }

          // ── GY ability: choose X opponent creatures for counters ────────
          case 'gy_counter_targets': {
            const gcPending = gs?._pendingGYCounterTargets;
            if (!gcPending) return null;
            const gcCandidates = gcPending.candidates || [];
            const gcMax = gcPending.xCount || 1;
            return (
              <GraveyardMultiSelectOverlay
                cards={gcCandidates}
                amount={gcMax}
                minAmount={0}
                title={`💀 Choose up to ${gcMax} creatures — 1 ${gcPending.effect?.counter || 'decayed'} counter each`}
                onConfirm={uids => actions.resolveGYCounterTargets(uids)}
              />
            );
          }

          case 'choose_gy_bottom_library': {
            const pending = gs?._pendingGYBottomLibrary;
            const allCands = pending?.candidates?.map((c: any) => c.card) || [
              ...snap.players[0].graveyard, ...snap.players[1].graveyard
            ];
            return (
              <SearchLibraryOverlay
                candidates={allCands}
                optional={false}
                title="📥 Put on Bottom of Library"
                hint="Choose a card from any graveyard to put on the bottom of its owner's library."
                onConfirm={uid => actions.resolveGYBottomLibrary(uid)}
              />
            );
          }

          // ── Traveling Botanist: hand vs graveyard choice ──────────────
          case 'traveling_botanist_choice': {
            const pending = gs?._pendingTravelingBotanist;
            if (!pending) return null;
            const cardName = pending.card?.name || 'land';
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8000 }}>
                <div className="glass overlay-panel" style={{ maxWidth: 360, padding: 20, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--gold)' }}>Traveling Botanist</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    {cardName} is on top. What do you want to do?
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <button className="btn btn-gold" onClick={() => actions.resolveTravelingBotanist(true)}>
                      📤 Put into Hand
                    </button>
                    <button className="btn btn-muted" onClick={() => actions.resolveTravelingBotanist(false)}>
                      ☠ Graveyard
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
              <BounceMultiOverlay
                permanents={candidates}
                maxBounce={pending.maxTargets || 1}
                title={`💪 Buff up to ${pending.maxTargets || 1} Creature(s) — +${pending.effect?.power || 0}/+${pending.effect?.toughness || 0}`}
                onConfirm={uids => actions.resolveMultiBuffChoiceAction(uids)}
              />
            );
          }

          // ── Normal gameplay states — no overlay, player acts on board ──
          case 'main_phase':
          case 'declare_attackers':
          case 'mulligan':
          case 'choose_target':
            return null;

          // ── Blocker damage order — interactive reorder UI ───────────
          case 'order_library_top': {
            const pendingOrder = gs?._pendingLibraryOrder;
            if (!pendingOrder) return null;
            const orderCards = pendingOrder.cards || [];
            // Initialize libraryOrderUids if empty or stale
            if (libraryOrderUids.length !== orderCards.length) {
              setTimeout(() => setLibraryOrderUids(orderCards.map((c: any) => c.uid)), 0);
              return null;
            }
            const moveCard = (idx: number, dir: -1 | 1) => {
              setLibraryOrderUids(prev => {
                const arr = [...prev];
                const newIdx = idx + dir;
                if (newIdx < 0 || newIdx >= arr.length) return prev;
                [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
                return arr;
              });
            };
            return (
              <div className="overlay-backdrop">
                <div className="overlay-panel" style={{ maxWidth: '600px' }}>
                  <h2 style={{ color: '#fff', margin: '0 0 8px', textAlign: 'center' }}>Library Top Order</h2>
                  <p style={{ color: '#aaa', fontSize: '13px', margin: '0 0 16px', textAlign: 'center' }}>
                    First = top (you will draw it first). Use the arrows to reorder.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '50vh', overflowY: 'auto' }}>
                    {libraryOrderUids.map((uid, idx) => {
                      const entry = orderCards.find((c: any) => c.uid === uid);
                      const card = entry?.card;
                      if (!card) return null;
                      const imgSrc = card.image_uris?.normal || card.image_uris?.small || card.image_normal || card.image_small;
                      return (
                        <div key={uid} style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '8px 12px', borderRadius: '8px',
                          background: idx === 0 ? 'rgba(40,200,120,0.15)' : 'rgba(255,255,255,0.04)',
                          border: idx === 0 ? '2px solid rgba(40,200,120,0.5)' : '1px solid rgba(255,255,255,0.1)',
                        }}>
                          <span style={{ color: idx === 0 ? '#4f4' : '#888', fontSize: '18px', fontWeight: 800, width: '28px', textAlign: 'center' }}>
                            {idx + 1}
                          </span>
                          <img src={imgSrc} alt={card.name}
                            style={{ width: '80px', height: '112px', objectFit: 'cover', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ color: '#fff', fontSize: '15px', fontWeight: 600 }}>{card.name}</div>
                            <div style={{ color: '#aaa', fontSize: '11px' }}>{card.type_line}</div>
                            {card.mana_cost && <div style={{ marginTop: 2 }}><ManaCostPips cost={card.mana_cost} size={13} /></div>}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <button onClick={() => moveCard(idx, -1)} disabled={idx === 0}
                              style={{ padding: '6px 12px', fontSize: '16px', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)', color: '#fff' }}>
                              ▲
                            </button>
                            <button onClick={() => moveCard(idx, 1)} disabled={idx === libraryOrderUids.length - 1}
                              style={{ padding: '6px 12px', fontSize: '16px', cursor: idx === libraryOrderUids.length - 1 ? 'default' : 'pointer', opacity: idx === libraryOrderUids.length - 1 ? 0.3 : 1, borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)', color: '#fff' }}>
                              ▼
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ textAlign: 'center', marginTop: '16px' }}>
                    <button className="game-btn" onClick={() => { actions.resolveLibraryOrder(libraryOrderUids); setLibraryOrderUids([]); }}
                      style={{ padding: '10px 32px', fontSize: '15px', fontWeight: 700 }}>
                      Confirmar Ordem
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          case 'order_blockers': {
            const attackerUids: string[] = wi?.attackerUids || [];
            const rawBlockers: Record<string, any[]> = wi?.blockers || {};
            return (
              <OrderBlockersOverlay
                attackerUids={attackerUids}
                blockers={rawBlockers}
                snap={snap}
                onConfirm={(order) => actions.resolveOrderBlockers(order)}
              />
            );
          }

          // ── Legendary rule: cast new (sacrifice old) or cancel ───────
          case 'legendary_choice_pre_cast': {
            const pending = gs?._pendingLegendaryChoice;
            if (!pending) return null;
            const existingName = pending.existingCards?.[0]?.name ?? 'existing legendary';
            const newName = pending.cardToCast?.name ?? 'new card';
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 7000 }}>
                <div className="glass overlay-panel" style={{ maxWidth: 340, padding: 20, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Legendary Rule</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                    You already control <strong>{existingName}</strong>.<br />
                    Casting <strong>{newName}</strong> will sacrifice the existing one.
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button className="btn btn-gold" onClick={() => actions.resolveLegendaryChoice('keep_new')}>
                      Cast (sacrifice existing)
                    </button>
                    <button className="btn btn-muted" onClick={() => actions.resolveLegendaryChoice('cancel')}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Legend rule sacrifice: choose which legendary to sacrifice ──
          case 'legend_rule_sacrifice': {
            const legPending = gs?._pendingLegendRuleSacrifice;
            if (!legPending) return null;
            const legCandidates = legPending.candidates || [];
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 7000 }}>
                <div className="glass overlay-panel" style={{ maxWidth: 500, padding: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, textAlign: 'center' }}>Legend Rule — Choose which to sacrifice</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, textAlign: 'center' }}>
                    You control two legendary permanents with the same name. Choose one to send to the graveyard.
                  </div>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {legCandidates.map((lc: any) => {
                      const bfCard = snap.players[legPending.controllerId].battlefield.find((c: any) => c._uid === lc.uid);
                      return (
                        <div key={lc.uid} style={{ textAlign: 'center', cursor: 'pointer' }}
                          onClick={() => actions.resolveLegendRuleSacrifice(lc.uid)}>
                          {bfCard && <CardImage card={bfCard} size="medium" />}
                          <div style={{ fontSize: 11, marginTop: 4, color: '#fff' }}>
                            {lc.isCopy ? `${lc.originalName} (copy)` : lc.name}
                            {' '}{lc.isNew ? '(just entered)' : '(already on battlefield)'}
                          </div>
                          <button className="btn btn-sm" style={{ marginTop: 4, fontSize: 10 }}>
                            Sacrifice this
                          </button>
                        </div>
                      );
                    })}
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
                title={`🎯 ${pending.effectType === 'tap' ? 'Tap' : 'Choose'} — Choose a creature`}
                optional={false}
                onConfirm={uid => uid && actions.resolveTargetChoiceSingle(uid)}
              />
            );
          }

          // ── Behold: reveal a dragon from hand or choose one on battlefield ──
          case 'behold_choice_multiple':
          case 'behold_choice_optional': {
            const pending = gs?._pendingBeholdChoice;
            if (!pending) return null;
            // If there are original targets (e.g. counterspell), show context
            const beholdTargetName = pending.targets?.[0]?.name;
            const beholdHint = beholdTargetName
              ? `Reveal a Dragon from hand or choose one on the battlefield (targeting: ${beholdTargetName}).`
              : 'Reveal a Dragon from hand or choose one you control on the battlefield.';
            return (
              <SearchLibraryOverlay
                candidates={pending.cards || []}
                title="🐉 Behold — Reveal or Choose a Dragon"
                hint={beholdHint}
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
                title={`🏔️ ${pending.landName} — Hideaway`}
                hint="Choose a card to exile with the land (activatable later)."
                optional={false}
                onConfirm={uid => {
                  if (uid) actions.resolveHideaway(uid);
                }}
              />
            );
          }

          case 'spirit_dragons_choose':
            return null; // handled by standalone overlay below

          // ── Exile GY creature cost (Great Arashin City etc.) ────────────
          case 'exile_gy_creature_cost': {
            const gyChoices = (wi as any).choices || [];
            return (
              <div className="overlay-backdrop">
                <div className="overlay-panel glass" style={{ maxWidth: 500 }}>
                  <h3 className="overlay-title">Exile Creature from Graveyard</h3>
                  <p className="overlay-hint">Choose a creature from your graveyard to exile as a cost:</p>
                  <div className="overlay-card-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                    {gyChoices.map((c: any) => (
                      <div key={c._uid} className="overlay-card-option"
                        onClick={() => actions.resolveExileGYCreatureCost(c._uid)}
                        style={{ cursor: 'pointer', border: '2px solid transparent', borderRadius: 8, padding: 4 }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = '#ffd700')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}>
                        <img src={c.image_small || c.image_normal} alt={c.name} style={{ width: 90, borderRadius: 6 }}
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        <div style={{ textAlign: 'center', fontSize: 11, marginTop: 2 }}>{c.name}</div>
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-muted" style={{ marginTop: 12 }}
                    onClick={() => actions.resolveExileGYCreatureCost(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            );
          }

          case 'exile_gy_cards_cost': {
            const gyChoices = (wi as any).choices || [];
            const exileCount = (wi as any).exileCount || 1;
            return (
              <BounceMultiOverlay
                permanents={gyChoices}
                maxBounce={exileCount}
                title={`☠ Exile ${exileCount} card(s) from your graveyard (cost)`}
                onConfirm={uids => actions.resolveExileGYCardsCost(uids)}
              />
            );
          }

          // ── Move counters target (dying creature counter inheritance) ────────────
          case 'counter_inheritance_target': {
            const mcWi = wi as any;
            const mcChoices = mcWi.choices || [];
            return (
              <div className="overlay-backdrop">
                <div className="overlay-panel glass" style={{ maxWidth: 500 }}>
                  <h3 className="overlay-title">Move Counters</h3>
                  <p className="overlay-hint">
                    {mcWi.dyingCardName} died with counters. Choose a creature to receive the counters:
                    {Object.entries(mcWi.counterMap || {}).map(([t, n]) => ` ${n}x ${t}`).join(',')}
                  </p>
                  <div className="overlay-card-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                    {mcChoices.map((c: any) => (
                      <div key={c._uid} className="overlay-card-option"
                        onClick={() => actions.resolveCounterInheritance(c._uid)}
                        style={{ cursor: 'pointer', border: '2px solid transparent', borderRadius: 8, padding: 4 }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = '#ffd700')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}>
                        <img src={c.image_small || c.image_normal} alt={c.name} style={{ width: 90, borderRadius: 6 }} />
                        <div style={{ textAlign: 'center', fontSize: 11, marginTop: 2 }}>{c.name}</div>
                      </div>
                    ))}
                  </div>
                  {mcWi.optional && (
                    <button className="btn btn-muted" style={{ marginTop: 12 }}
                      onClick={() => actions.resolveCounterInheritance(null)}>
                      Recusar
                    </button>
                  )}
                </div>
              </div>
            );
          }

          // ── Graveyard trigger pay (e.g. Furious Forebear) ────────────
          case 'graveyard_trigger_pay': {
            const gyTrig = wi as any;
            const gyManaCost = gyTrig.cost?.mana || '?';
            return (
              <div className="overlay-backdrop">
                <div className="overlay-panel glass" style={{ maxWidth: 380, textAlign: 'center' }}>
                  <h3 className="overlay-title">{gyTrig.cardName}</h3>
                  <p className="overlay-hint">
                    Uma criatura sua morreu. Pagar <ManaCostPips cost={gyManaCost} size={16} /> para retornar {gyTrig.cardName} do cemiterio para sua mao?
                  </p>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
                    <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => actions.resolveGraveyardTrigger(true)}>
                      Pagar <ManaCostPips cost={gyManaCost} size={16} />
                    </button>
                    <button className="btn btn-muted" onClick={() => actions.resolveGraveyardTrigger(false)}>
                      Recusar
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Grant counter target (Naga Fleshcrafter GY ability etc.) ──
          case 'grant_counter_target': {
            const gctChoices = (wi as any).choices || [];
            const gctPending = gsRef.current?._pendingGrantCounter;
            const gctCounterType = (gctPending?.counters && Array.isArray(gctPending.counters))
              ? gctPending.counters.join(', ')
              : (gctPending?.counter || '+1/+1');
            return (
              <CreatureChoiceOverlay
                creatures={gctChoices}
                title={`Choose a creature — ${gctCounterType}`}
                hint={`Place ${gctCounterType} counter(s) on the chosen creature.`}
                onConfirm={uid => {
                  if (uid) (actions as any).resolveGrantCounterTarget(uid);
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
      {targeting && (() => {
        // Multi-step: show step-specific prompt and filter targets accordingly
        const currentStep = targeting.steps && targeting.step ? targeting.steps[targeting.step - 1] : null;
        const stepFilter = currentStep?.side;
        const promptSpell = currentStep
          ? { ...targeting.card, _targetPromptOverride: `${targeting.card.name}: ${currentStep.prompt}` }
          : targeting.card;
        // For optional multi-step (e.g. Twin Bolt step 2), allow casting with already-collected targets
        const isOptionalMultiStep = !!(targeting.steps && targeting.step &&
          targeting.step === targeting.steps.length &&
          (currentStep as any)?.optional &&
          (targeting.collectedTargets?.length || 0) > 0);
        return (
          <TargetingPrompt
            spell={promptSpell}
            validTargets={getValidTargets(targeting.card, stepFilter)}
            onTarget={() => {}}
            onCancel={() => { setTargeting(null); if (targeting.isHarmonize) setHarmonizePending(null); }}
            onSkipTarget={targeting.optionalTarget || isOptionalMultiStep ? () => {
              showCastAnimation(targeting.card);
              const targets = (targeting.collectedTargets?.length || 0) > 0
                ? targeting.collectedTargets!
                : [];
              if (targeting.isHarmonize) {
                actions.castHarmonize(targeting.cardUid, targets, targeting.harmonizeTappedUid ?? undefined);
                setHarmonizePending(null);
              } else if (targeting.card._isAdventure) {
                actions.castAdventure(targeting.cardUid, targets);
              } else {
                actions.castSpell(targeting.cardUid, targets);
              }
              setTargeting(null);
            } : undefined}
          />
        );
      })()}

      {/* ── Harmonize creature tap selection (phase 1: pick creature to tap for discount) ── */}
      {harmonizePending && !targeting?.isHarmonize && (() => {
        const untappedCreatures = (snap.players[0].battlefield || []).filter(
          (c: any) => c.type_line?.includes('Creature') && !c._tapped
        );
        return (
          <CreatureChoiceOverlay
            creatures={untappedCreatures}
            title="🎵 Harmonize — Tap a Creature"
            hint="Tap a creature to reduce the cost by its power. Or skip for no discount."
            optional
            onConfirm={uid => {
              const cardUid = harmonizePending.cardUid;
              // Check if the gy card also needs targeting (e.g. Channeled Dragonfire)
              const gyCard = snap.players[0].graveyard.find((c: any) => c._uid === cardUid);
              if (gyCard && spellNeedsTargeting(gyCard)) {
                // Phase 2: show targeting overlay before casting
                setHarmonizePending({ cardUid, tappedUid: uid ?? null });
                setTargeting({ cardUid, card: gyCard, isHarmonize: true, harmonizeTappedUid: uid ?? null });
              } else {
                setHarmonizePending(null);
                actions.castHarmonize(cardUid, [], uid ?? undefined);
              }
            }}
          />
        );
      })()}

      {/* grant_counter_target is now handled inside the switch/case above */}

      {/* ── choose_target engine waiting (saga chapters etc.) ── */}
      {snap.waitingForInput?.type === 'choose_target' &&
       snap.waitingForInput.playerId === 0 && (() => {
        const pending = gsRef.current?._pendingSagaChapter;
        const sagaName = pending?.saga?.name || 'Spell';
        const chapter = pending?.chapter || '?';
        const effects = pending?.effects || [];
        const effectDesc = effects.map((e: any) => {
          if (e.type === 'destroy') return `Destroy target ${(e.target || 'permanent').replace(/_/g, ' ')}`;
          if (e.type === 'exile') return `Exile target ${(e.target || 'permanent').replace(/_/g, ' ')}`;
          if (e.type === 'bounce') return `Return target ${(e.target || 'permanent').replace(/_/g, ' ')} to hand`;
          return `Choose a target`;
        }).join('; ');

        // Compute valid targets based on saga effects
        const sagaTargets: any[] = [];
        for (const eff of effects) {
          const t = (eff.target || '') as string;
          [0, 1].forEach(pid => {
            snap.players[pid].battlefield.forEach((c: any) => {
              if (t === 'nonland_permanent' && !c.type_line?.includes('Land')) {
                sagaTargets.push({ type: 'permanent', uid: c._uid, player: pid, card: c });
              } else if (t === 'creature' && c.type_line?.includes('Creature')) {
                sagaTargets.push({ type: 'creature', uid: c._uid, player: pid, card: c });
              } else if (t === 'own_creature' && pid === 0 && c.type_line?.includes('Creature')) {
                sagaTargets.push({ type: 'creature', uid: c._uid, player: pid, card: c });
              } else if (t === 'artifact' && c.type_line?.includes('Artifact')) {
                sagaTargets.push({ type: 'permanent', uid: c._uid, player: pid, card: c });
              } else if (t === 'enchantment' && c.type_line?.includes('Enchantment')) {
                sagaTargets.push({ type: 'permanent', uid: c._uid, player: pid, card: c });
              } else if (t === 'opponent_creature' && pid !== 0 && c.type_line?.includes('Creature')) {
                sagaTargets.push({ type: 'creature', uid: c._uid, player: pid, card: c });
              } else if (!t || t === 'permanent') {
                sagaTargets.push({ type: 'permanent', uid: c._uid, player: pid, card: c });
              }
            });
          });
        }

        return (
          <TargetingPrompt
            spell={{ name: `${sagaName} — Ch.${chapter}: ${effectDesc}` }}
            validTargets={sagaTargets}
            onTarget={() => {}}
            onCancel={() => actions.resolveChooseTarget([])}
          />
        );
      })()}

      {/* ── Call the Spirit Dragons: choose dragon for each color ── */}
      {snap.waitingForInput?.type === 'spirit_dragons_choose' &&
       snap.waitingForInput.playerId === 0 && (() => {
        const wi = snap.waitingForInput as any;
        const colorBg: Record<string, string> = { W: 'rgba(249,250,244,0.15)', U: 'rgba(14,104,171,0.2)', B: 'rgba(80,60,80,0.25)', R: 'rgba(211,32,42,0.2)', G: 'rgba(0,115,62,0.2)' };
        const allColors = ['W', 'U', 'B', 'R', 'G'];
        const colorNameMap: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

        // Read assigned dragons from pending state for progress display
        const gs = gsRef.current;
        const pending = gs?._pendingSpiritDragons;
        const assignments: Record<string, { uid: string; name: string }> = {};
        const availableColors: string[] = pending?.availableColors || [];
        if (pending?.assignments) {
          const bf = gs?.players[pending.controllerId]?.zones?.battlefield;
          for (const [color, uid] of Object.entries(pending.assignments)) {
            const dragon = bf?.get(uid as string);
            if (dragon) assignments[color] = { uid: uid as string, name: dragon.name };
          }
        }
        const distinctUids = new Set(Object.values(assignments).map(a => a.uid));

        return (
          <div className="overlay-backdrop" style={{ zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="glass overlay-panel" style={{ maxWidth: 520, padding: 20, textAlign: 'center', background: colorBg[wi.color] || 'rgba(30,30,30,0.95)' }}>
              <h3 style={{ margin: '0 0 8px', color: 'var(--gold)', fontSize: 16 }}>Call the Spirit Dragons</h3>

              {/* ── Progress: 5 mana pips showing assigned/current/pending ── */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 12 }}>
                {allColors.map(c => {
                  const isAvail = availableColors.includes(c);
                  const isAssigned = !!assignments[c];
                  const isCurrent = c === wi.color;
                  const opacity = !isAvail ? 0.2 : isAssigned ? 1 : isCurrent ? 1 : 0.4;
                  const border = isCurrent ? '2px solid var(--gold)' : isAssigned ? '2px solid #4caf50' : '2px solid transparent';
                  return (
                    <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', border, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity, transition: 'all 0.2s' }}>
                        {MANA_IMAGES[c] ? <img src={MANA_IMAGES[c]} alt={c} style={{ width: 24, height: 24 }} /> : <span>{c}</span>}
                      </div>
                      <span style={{ fontSize: 9, color: isAssigned ? '#4caf50' : isCurrent ? 'var(--gold)' : 'var(--text-muted)' }}>
                        {isAssigned ? assignments[c].name.split(',')[0].split(' ').slice(0, 2).join(' ') : !isAvail ? '—' : isCurrent ? '?' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* ── Win progress ── */}
              <div style={{ fontSize: 12, marginBottom: 12, padding: '4px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.3)', display: 'inline-block' }}>
                <span style={{ color: distinctUids.size >= 5 ? '#4caf50' : 'var(--gold)', fontWeight: 700 }}>{distinctUids.size}</span>
                <span style={{ color: 'var(--text-muted)' }}>/5 distinct dragons </span>
                {distinctUids.size >= 5
                  ? <span style={{ color: '#4caf50', fontWeight: 700 }}>WIN!</span>
                  : <span style={{ color: 'var(--text-muted)' }}>(need {5 - distinctUids.size} more)</span>
                }
              </div>

              {/* ── Current color choice ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, margin: '0 0 10px' }}>
                {MANA_IMAGES[wi.color] && <img src={MANA_IMAGES[wi.color]} alt={wi.color} style={{ width: 20, height: 20 }} />}
                <span style={{ fontSize: 13 }}>Choose a <strong>{wi.colorName}</strong> Dragon for +1/+1:</span>
              </div>

              {/* ── Dragon choices ── */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {(wi.dragons || []).map((d: any) => {
                  const alreadyUsed = distinctUids.has(d.uid);
                  return (
                  <div
                    key={d.uid}
                    onClick={() => actions.resolveSpiritDragonsChoice(d.uid)}
                    style={{
                      cursor: 'pointer', borderRadius: 8, overflow: 'hidden',
                      border: alreadyUsed ? '2px solid rgba(255,165,0,0.6)' : '2px solid transparent',
                      transition: 'border-color 0.15s, transform 0.15s',
                      width: 130, textAlign: 'center', background: 'rgba(0,0,0,0.4)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = alreadyUsed ? 'rgba(255,165,0,0.6)' : 'transparent'; e.currentTarget.style.transform = 'scale(1)'; }}
                  >
                    {d.image ? (
                      <img src={d.image} alt={d.name} style={{ width: '100%', height: 'auto', display: 'block' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>{d.name}</div>
                    )}
                    <div style={{ padding: '4px 6px', fontSize: 11, fontWeight: 600 }}>
                      {d.name}
                      {d.counters > 0 && <span style={{ color: 'var(--gold)', marginLeft: 4 }}>+1/+1 x{d.counters}</span>}
                      {alreadyUsed && <div style={{ fontSize: 9, color: 'orange' }}>already chosen</div>}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Graveyard overlay ── */}
      {graveyardOpen && (
        <GraveyardOverlay
          cards={snap.players[graveyardOpen.pid].graveyard}
          playerId={graveyardOpen.pid}
          onActivate={graveyardOpen.pid === 0 ? actions.activateGraveyardAbility : undefined}
          canPlayLand={graveyardOpen.pid === 0 && !snap.landPlayedThisTurn && (snap.phase === 'main1' || snap.phase === 'main2') && !!(gsRef.current as any)?._playLandsFromGraveyard?.[0]}
          onPlayLand={graveyardOpen.pid === 0 ? (uid: string) => { actions.playLand(uid); } : undefined}
          getLandArt={getLandArtUrl}
          onClose={() => setGraveyardOpen(null)}
        />
      )}

      {/* ── Ability modal (double-click) ── */}
      {abilityModal && (() => {
        // Evaluate per-ability conditions from snap state (e.g. creature_died_this_turn for Barad-dûr)
        const abilityCondsMet = abilityModal.abilities.map((ab: any) => {
          const cond = ab.condition;
          if (!cond) return true;
          const gs = snap as any;
          if (cond === 'creature_died_this_turn') return !!(gs._creatureDiedThisTurn?.[0]);
          if (cond === 'opponent_creature_died_this_turn') return !!(gs._creatureDiedThisTurn?.[1]);
          // Unknown condition: assume met to avoid false-blocking
          return true;
        });
        return (
          <AbilityModal
            card={abilityModal.card}
            abilities={abilityModal.abilities}
            onActivate={(idx, xValue) => handleActivateAbility(abilityModal.card._uid, idx, abilityModal.card, xValue)}
            onClose={() => setAbilityModal(null)}
            availableMana={totalAvailableMana}
            conditionsMet={abilityCondsMet}
          />
        );
      })()}

      {/* ── Graveyard Lands modal (Glacierwood Siege Sultai) ── */}
      {graveyardLandsOpen && (() => {
        const gyLands = (p0.graveyard || []).filter((c: any) => c.type_line?.toLowerCase().includes('land'));
        return (
          <div className="overlay-backdrop" onClick={() => setGraveyardLandsOpen(false)}>
            <div className="overlay-panel glass" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
              <div className="overlay-header">
                <h3 className="overlay-title">Play Land from Graveyard</h3>
                <button className="btn btn-muted btn-sm" onClick={() => setGraveyardLandsOpen(false)}>X</button>
              </div>
              {gyLands.length === 0 ? (
                <p className="overlay-hint">No lands in graveyard.</p>
              ) : (
                <div style={{ display: 'flex', gap: 12, padding: '16px 8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {gyLands.map((card: any) => (
                    <div
                      key={card._uid}
                      onClick={() => { actions.playLand(card._uid); setGraveyardLandsOpen(false); }}
                      onContextMenu={e => { e.preventDefault(); setZoom(card); }}
                      style={{ cursor: 'pointer', textAlign: 'center', transition: 'transform 0.1s' }}
                      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                      <img
                        src={getLandArtUrl(card) || card.image_normal || card.image_small}
                        alt={card.name}
                        style={{
                          width: 130, height: 182, objectFit: 'cover', borderRadius: 8,
                          border: '2px solid rgba(60,180,80,0.7)',
                          boxShadow: '0 2px 16px rgba(60,180,80,0.3)',
                        }}
                      />
                      <div style={{ fontSize: 11, color: '#cec', marginTop: 4, fontWeight: 600 }}>{card.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

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
                ⚔️ Equip {equipModal.equipName}
              </div>
              {equipModal.equipCost && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                  Cost: <ManaCostPips cost={equipModal.equipCost} size={18} />
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Choose a creature to equip:
              </div>
              {myCreatures.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No creatures available.</div>
              ) : (
                myCreatures.map((c: any) => {
                  // Show reduced equip cost for equipment with per_color reduction (e.g. Dragonfire Blade)
                  const equipCard = snap.players[0].battlefield.find((e: any) => e._uid === equipModal.equipUid);
                  const dbE = equipCard ? getPreprocessedEffects(equipCard as any) : null;
                  let costHint = '';
                  if ((dbE as any)?.equip_cost_reduction === 'per_color' && (dbE as any)?.equip_cost) {
                    const baseEquipCmc = parseInt(((dbE as any).equip_cost as string).replace(/[{}]/g, '')) || 0;
                    const colors = (c.colors || c.color_identity || []).filter((cl: string) => ['W','U','B','R','G'].includes(cl));
                    const reduced = Math.max(0, baseEquipCmc - colors.length);
                    costHint = ` — Equip {${reduced}}`;
                  }
                  return (
                    <button
                      key={c._uid}
                      className="btn btn-muted"
                      style={{ display: 'block', width: '100%', marginBottom: 8, textAlign: 'left' }}
                      onClick={() => {
                        actions.equipCreature(equipModal.equipUid, c._uid);
                        setEquipModal(null);
                      }}
                    >
                      {c.name} ({c.power}/{c.toughness}){costHint}
                    </button>
                  );
                })
              )}
              <button className="btn" style={{ marginTop: 8 }} onClick={() => setEquipModal(null)}>
                Cancel
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
                ⚔️ {attackTargetPicker.isToken
                  ? `${attackTargetPicker.tokenName || 'Token'} — atacar quem?`
                  : 'Who to attack?'}
              </div>
              {/* Attack player button */}
              <button
                className="btn btn-gold"
                style={{ display: 'block', width: '100%', marginBottom: 8, textAlign: 'left' }}
                onClick={() => {
                  if (attackTargetPicker.isToken) {
                    // Token already attacking player by default — just close and show next
                    _popNextPendingToken();
                  } else {
                    actions.declareAttacker(attackTargetPicker.attackerUid);
                    setAttackTargetPicker(null);
                  }
                }}
              >
                👤 Attack the player
              </button>
              {/* One button per opponent planeswalker */}
              {oppPlaneswalkers.map((pw: any) => (
                <button
                  key={pw._uid}
                  className="btn btn-muted"
                  style={{ display: 'block', width: '100%', marginBottom: 8, textAlign: 'left' }}
                  onClick={() => {
                    if (attackTargetPicker.isToken) {
                      // Update existing attacker entry with PW target
                      const gs = (window as any).__gsRef?.current;
                      if (gs && gs.combat) {
                        const att = gs.combat.attackers.find((a: any) => (typeof a === 'string' ? a : a.uid) === attackTargetPicker.attackerUid);
                        if (att && typeof att !== 'string') att.attackTarget = pw._uid;
                      }
                      _popNextPendingToken();
                    } else {
                      actions.declareAttacker(attackTargetPicker.attackerUid, pw._uid);
                      setAttackTargetPicker(null);
                    }
                  }}
                >
                  🌟 Attack {pw.name} <span style={{ color: 'rgba(230,120,0,0.9)', fontWeight: 800 }}>★{pw._loyalty ?? '?'}</span>
                </button>
              ))}
              <button
                className="btn btn-muted"
                style={{ marginTop: 4, width: '100%' }}
                onClick={() => { setAttackTargetPicker(null); _clearPendingTokens(); }}
              >
                Cancel
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
              Additional Cost
            </div>
            <div style={{ fontSize: '13px', marginBottom: '8px' }}>
              <strong>{conditionalCostConfirm.card.name}</strong> costs{' '}
              <span style={{ color: '#f88', fontWeight: 700 }}>{conditionalCostConfirm.extraCost} more</span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              {conditionalCostConfirm.targetName} is a Dragon.
              <br />
              Total cost: {conditionalCostConfirm.card.cmc + conditionalCostConfirm.extraAmount} mana.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                className="btn btn-gold"
                onClick={() => {
                  actions.castSpell(conditionalCostConfirm.cardUid, conditionalCostConfirm.targets);
                  setConditionalCostConfirm(null);
                }}
              >Confirm</button>
              <button
                className="btn btn-muted"
                onClick={() => setConditionalCostConfirm(null)}
              >Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cast or Cycle modal ── */}
      {cycleOrCastModal && (() => {
        const c = cycleOrCastModal.card;
        const cy = cycleOrCastModal.cyclingAbility;
        const cycleLabel = cy.manaCost || `{${cy.cost}}`;
        const cycleEffect = cy.searchType ? `Search for a ${cy.searchType}` : 'Draw a card';
        return (
          <div
            className="overlay-backdrop"
            onClick={() => setCycleOrCastModal(null)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}
          >
            <div
              className="glass"
              style={{ padding: '20px', borderRadius: '12px', minWidth: '300px', textAlign: 'center' }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px', color: 'var(--gold)' }}>{c.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>How do you want to play this card?</div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button className="btn btn-muted" style={{ flex: 1 }} onClick={() => {
                  setCycleOrCastModal(null);
                  if (spellNeedsTargeting(c)) {
                    const multiSteps = getMultiTargetSteps(c);
                    if (multiSteps) setTargeting({ cardUid: c._uid, card: c, step: 1, steps: multiSteps, collectedTargets: [] });
                    else setTargeting({ cardUid: c._uid, card: c });
                  } else {
                    showCastAnimation(c);
                    actions.castSpell(c._uid);
                  }
                }}>
                  Cast<br/><ManaCostPips cost={c.mana_cost} size={14} />
                </button>
                <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => {
                  setCycleOrCastModal(null);
                  actions.activateCycling(c._uid);
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Cycle <ManaCostPips cost={cycleLabel} size={14} />
                  </span>
                  <br/>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{cycleEffect}</span>
                </button>
              </div>
              <button className="btn btn-muted" style={{ marginTop: 10, fontSize: 11 }} onClick={() => setCycleOrCastModal(null)}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* ── Adventure / Omen modal ── */}
      {adventureModal && (() => {
        const card = adventureModal.card;
        const adv = card.back_face; // adventure/omen data lives in back_face for layout='adventure'
        const isOmen = adv?.type_line?.toLowerCase().includes('omen');
        const advLabel = isOmen ? 'Omen' : 'Adventure';
        const isStackPriorityNow = (wi?.type === 'stack_priority' || wi?.type === 'trigger_priority') && wi?.playerId === 0;
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
                {isStackPriorityNow ? 'Cast instant face in response:' : 'How do you want to cast this card?'}
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                {/* Cast as creature — only available outside stack priority */}
                {!isStackPriorityNow && (
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
                    🐉 {card.name.split('//')[0].trim()}<br/>
                    <ManaCostPips cost={card.mana_cost} size={16} />
                  </button>
                )}
                {/* Cast as adventure/omen */}
                <button
                  className="btn btn-gold"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setAdventureModal(null);
                    const advText = (adv?.oracle_text || '').toLowerCase();
                    // Counter spell face: auto-target the pending stack spell
                    const isAdvCounter = advText.includes('counter target spell') ||
                      advText.includes('counter target creature spell') ||
                      advText.includes('counter target instant') ||
                      advText.includes('counter target sorcery');
                    if (isAdvCounter && isStackPriorityNow) {
                      const gs = gsRef.current;
                      const stackItems: any[] = gs?.stack?.items || [];
                      const oppSpells = stackItems.filter((item: any) => item.controller !== 0);
                      const pendingCast = gs?._pendingCastOnStack;
                      let targetCard: any = null;
                      if (oppSpells.length > 0) targetCard = oppSpells[oppSpells.length - 1].card;
                      else if (pendingCast?.card && pendingCast.playerId !== 0) targetCard = pendingCast.card;
                      if (targetCard) {
                        showCastAnimation(card);
                        actions.castAdventure(card._uid, [targetCard]);
                        return;
                      }
                    }
                    // Use adventure face type_line so spellNeedsTargeting doesn't short-circuit
                    const advFaceCard = { ...card, oracle_text: adv?.oracle_text ?? '', type_line: adv?.type_line ?? card.type_line };
                    if (spellNeedsTargeting(advFaceCard)) {
                      const optionalOnly = spellHasOnlyOptionalTargets(advFaceCard);
                      setTargeting({ cardUid: card._uid, card: { ...card, oracle_text: adv?.oracle_text ?? '', type_line: adv?.type_line ?? card.type_line, _isAdventure: true }, optionalTarget: optionalOnly });
                    } else {
                      actions.castAdventure(card._uid);
                    }
                  }}
                >
                  ✨ {adv?.name}<br/>
                  <span style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <ManaCostPips cost={adv?.mana_cost || ''} size={16} /> · {advLabel}
                  </span>
                </button>
              </div>
              <button
                className="btn btn-muted"
                style={{ marginTop: '10px', width: '100%', fontSize: '11px' }}
                onClick={() => setAdventureModal(null)}
              >
                Cancel
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
              {((snap as any).stackItems || []).slice().reverse().map((item: any, i: number) => (
                <div key={i} className="stack-item" style={{ cursor: 'default' }}>
                  {item.imageUrl && <img src={item.imageUrl} alt="" className="stack-item-img" />}
                  <div className="stack-item-info">
                    <div className="stack-item-name">{item.cardName}</div>
                    <div className="stack-item-type">
                      {item.controller === 0 ? 'You' : 'Opponent'} · {item.typeLine}
                    </div>
                  </div>
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
        <div className="auto-pass-indicator" onClick={() => { setAutoPass(false); addToast('⏹ Auto-pass desativado', 'cast'); }} style={{ cursor: 'pointer', pointerEvents: 'auto' }}>
          ⏩ Auto-pass — clique ou F para parar
        </div>
      )}

      {/* ── Keyboard help modal ── */}
      {showHelpModal && <KeyboardHelpOverlay onClose={() => setShowHelpModal(false)} />}

      {/* ── Quick settings panel ── */}
      {showQuickSettings && (
        <div style={{
          position: 'fixed', top: 44, right: 12, zIndex: 9500,
          background: 'var(--panel-bg, #1a1a2e)', border: '1px solid var(--border-color, #333)',
          borderRadius: 10, padding: '14px 18px', minWidth: 220,
          boxShadow: '0 4px 24px rgba(0,0,0,0.7)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--gold, #f0c040)' }}>⚙ Configurações</span>
            <button className="btn btn-muted btn-sm" style={{ fontSize: 11 }} onClick={() => setShowQuickSettings(false)}>✕</button>
          </div>

          {/* Som */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <button
              className={`btn btn-sm ${soundEnabled ? 'btn-gold' : 'btn-muted'}`}
              style={{ fontSize: 12, minWidth: 70 }}
              onClick={() => {
                const next = !soundEnabled;
                SoundManager.init();
                SoundManager.setEnabled(next);
                setSoundEnabled(next);
                if (next) SoundManager.play('card_draw');
              }}
            >{soundEnabled ? '🔊 Som' : '🔇 Mudo'}</button>
            <input
              type="range" min={0} max={100} value={soundVolume}
              onChange={e => {
                const v = Number(e.target.value);
                setSoundVolume(v);
                SoundManager.setVolume(v / 100);
              }}
              disabled={!soundEnabled}
              style={{ flex: 1, accentColor: 'var(--gold, #f0c040)' }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-secondary, #999)', width: 32 }}>{soundVolume}%</span>
          </div>

          {/* Triggers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <button
              className={`btn btn-sm ${slowTriggers ? 'btn-gold' : 'btn-muted'}`}
              style={{ fontSize: 12, minWidth: 70 }}
              onClick={() => setSlowTriggers(v => !v)}
            >{slowTriggers ? '🔔 Triggers' : '🔕 Auto'}</button>
            <span style={{ fontSize: 11, color: 'var(--text-secondary, #999)' }}>
              {slowTriggers ? 'Notificações visíveis' : 'Sem notificações'}
            </span>
          </div>

          {/* Abrir settings completo */}
          <button
            className="btn btn-muted btn-sm"
            style={{ width: '100%', fontSize: 12, marginTop: 4 }}
            onClick={() => { setShowQuickSettings(false); setShowFullSettings(true); }}
          >⚙ Abrir Settings completo</button>
        </div>
      )}

      {/* ── Full settings overlay (sem sair do jogo) ── */}
      {showFullSettings && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.92)', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setShowFullSettings(false); }}
        >
          {/* X fixo no canto — sempre visível */}
          <button
            className="btn btn-gold"
            style={{ position: 'fixed', top: 12, right: 16, zIndex: 10001, fontSize: 13, padding: '6px 14px' }}
            onClick={() => setShowFullSettings(false)}
          >✕ Voltar ao jogo</button>
          <SettingsScreen />
        </div>
      )}

      {/* Full Control indicator removed — now inline in phase strip */}

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

      {/* ── Trigger Stack Panel (Arena-style staircase) ── */}
      {triggerPanelItems.length > 0 && (() => {
        const isTriggerPriority = snap?.waitingForInput?.type === 'trigger_priority';
        const hand = snap?.players?.[0]?.hand ?? [];
        const hasInstant = hand.some((c: any) => {
          const tl = (c.type_line || '').toLowerCase();
          return tl.includes('instant') || (c.oracle_text || '').toLowerCase().startsWith('flash');
        });
        const showResolveBtn = isTriggerPriority && hasInstant;
        return (
          <div className="trigger-toast-panel">
            {triggerPanelItems.map((toast, idx) => {
              const toastImgSrc = toast.imageUrlLarge || toast.imageUrl
                || (toast.isToken ? getTokenImageUrl(toast.cardName) : null);
              return (
                <div
                  key={toast.id}
                  className={`trigger-toast ${toast.controllerId === 0 ? 'trigger-toast-mine' : 'trigger-toast-opp'}${idx === 0 ? ' trigger-queue-active' : ''}`}
                  style={{ marginTop: idx === 0 ? 0 : `-190px`, marginLeft: `${idx * 20}px`, zIndex: triggerPanelItems.length - idx }}
                >
                  {toastImgSrc && (
                    <img src={toastImgSrc} alt={toast.cardName} className="trigger-toast-img" />
                  )}
                  <div className="trigger-toast-info">
                    <div className="trigger-toast-name">{toast.cardName}</div>
                    <div className="trigger-toast-effect">{toast.effectDesc}</div>
                  </div>
                </div>
              );
            })}
            {showResolveBtn && (
              <div className="trigger-queue-footer">
                <div className="trigger-queue-respond-hint">You can respond with an instant</div>
                <button className="btn btn-gold btn-sm" onClick={() => actions.nextPhase()}>Resolve (Space)</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── VFX sprite layer ── */}
      <VfxLayer />

      {/* ── Arena: Exit ghosts (dying/exiled card fade-out) ── */}
      {ghosts.map(g => (
        <div
          key={g.id}
          className="exit-ghost"
          style={{ left: g.x, top: g.y, width: g.w, height: g.h, animationDelay: `${g.fadeDelay}ms` }}
        >
          <img src={g.imgSrc} alt="" />
        </div>
      ))}

      {/* ── Arena: Floating damage/life numbers ── */}
      {floats.map(f => (
        <div
          key={f.id}
          className={`float-number float-${f.type}`}
          style={{ left: f.x, top: f.y }}
        >
          {f.value}
        </div>
      ))}

      {/* ── Arena: Spell cast center zoom ── */}
      {castingCard && (
        <>
          <div className="cast-zoom-glow" />
          <div className="cast-zoom-overlay">
            <img src={castingCard.image_normal || castingCard.image_small} alt={castingCard.name} />
          </div>
        </>
      )}

      {/* ── AI cast overlay: opponent spell reveal (Arena-style) ── */}
      {aiCastOverlay && (
        <div className="ai-cast-overlay" key={aiCastOverlay.card?.name + Date.now()}>
          <div className="ai-cast-label">⚔️ Opponent</div>
          <div className="ai-cast-card">
            <img
              src={aiCastOverlay.card.image_normal || aiCastOverlay.card.image_small}
              alt={aiCastOverlay.card.name}
            />
          </div>
          <div className="ai-cast-info">
            <span className="ai-cast-name">{aiCastOverlay.card.name}</span>
            {aiCastOverlay.targetDesc && aiCastOverlay.targetDesc.trim() && (
              <span className="ai-cast-target">→ {aiCastOverlay.targetDesc.trim()}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Arena: Combat edge flash ── */}
      {combatFlash && <div className="combat-edge-flash" />}

      {/* ── Floating mana pip animations ── */}
      {floatingManas.map(f => (
        MANA_IMAGES[f.color]
          ? <img key={f.id} src={MANA_IMAGES[f.color]} alt={f.color}
              className={`mana-float-pip mana-float-${f.color}`}
              style={{ left: f.x, top: f.y }} />
          : <div key={f.id}
              className={`mana-float-pip mana-float-${f.color}`}
              style={{ left: f.x, top: f.y }}>{f.color}</div>
      ))}

      {/* ── Arena-style cascading stack display ── */}
      {(() => {
        const wiType = snap.waitingForInput?.type;
        const isStackMoment = wiType === 'stack_priority' || wiType === 'instant_priority' || wiType === 'trigger_priority';
        const pendingCard = (snap as any).pendingCastCard;
        const stackItems: any[] = (snap as any).stackItems || [];

        // Build display list from stack items
        // NOTE: pendingCard is already included in stackItems (pushed at cast time), so don't add separately
        const displayItems: Array<{ name: string; imageUrl: string; card: any; controller: number; modeLabel: string }> = [];
        for (const item of stackItems) {
          displayItems.push({ name: item.cardName, imageUrl: item.imageUrl, card: item.card, controller: item.controller, modeLabel: item.modeLabel || '' });
        }

        if (!isStackMoment || displayItems.length === 0) return null;

        // Vertical list: newest on top, each card fully visible
        const CARD_W = 150;
        const CARD_H = 210;

        return (
          <div style={{
            position: 'fixed',
            right: 12,
            bottom: 80,
            width: CARD_W + 24,
            maxHeight: 'calc(100vh - 120px)',
            zIndex: 210,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            overflowY: 'auto',
          }}>
            {/* Label */}
            <div style={{
              fontSize: '10px', fontWeight: 700, color: 'var(--gold)',
              letterSpacing: '1px', textTransform: 'uppercase',
              textAlign: 'center', flexShrink: 0,
            }}>
              🔮 Stack ({displayItems.length})
            </div>
            {/* Cards: last item = top of stack, first = bottom */}
            {[...displayItems].reverse().map((item, i) => {
              const isTopOfStack = i === 0;
              return (
                <div
                  key={i}
                  onClick={() => item.card && setZoom(item.card)}
                  style={{
                    position: 'relative',
                    width: CARD_W,
                    height: CARD_H,
                    flexShrink: 0,
                    borderRadius: 8,
                    cursor: item.card ? 'pointer' : 'default',
                    boxShadow: isTopOfStack
                      ? '0 0 18px rgba(240,192,64,0.7), 0 4px 16px rgba(0,0,0,0.8)'
                      : '0 4px 12px rgba(0,0,0,0.5)',
                    border: isTopOfStack ? '2px solid var(--gold)' : '1px solid rgba(255,255,255,0.15)',
                    transition: 'transform 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                >
                  {item.imageUrl
                    ? <img
                        src={item.imageUrl}
                        alt={item.name}
                        style={{
                          width: '100%', height: '100%', borderRadius: 7, objectFit: 'cover', display: 'block',
                          animation: isTopOfStack ? 'stackCardAppear 0.25s ease-out' : 'none',
                        }}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    : <div style={{
                        width: '100%', height: '100%', borderRadius: 7,
                        background: 'rgba(20,15,40,0.95)',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        gap: 4, padding: 8,
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' }}>{item.name}</div>
                      </div>
                  }
                  {/* Top-of-stack badge */}
                  {isTopOfStack && (
                    <div style={{
                      position: 'absolute', top: 4, left: 4,
                      background: 'rgba(240,192,64,0.9)',
                      borderRadius: 4, padding: '1px 5px',
                      fontSize: 8, fontWeight: 800, color: '#111',
                      letterSpacing: '0.5px',
                    }}>TOP</div>
                  )}
                  {/* Chosen mode label */}
                  {item.modeLabel && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4,
                      background: 'rgba(10,10,30,0.85)',
                      borderRadius: 4, padding: '2px 5px',
                      fontSize: 8, fontWeight: 700, color: '#7dd3fc',
                      maxWidth: '80%', textAlign: 'right',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{item.modeLabel}</div>
                  )}
                  {/* Controller badge */}
                  <div style={{
                    position: 'absolute', bottom: 4, left: 0, right: 0,
                    textAlign: 'center',
                    fontSize: 9, fontWeight: 700,
                    color: item.controller === 0 ? '#4ecdc4' : '#f87171',
                    textShadow: '0 1px 4px rgba(0,0,0,0.9)',
                    pointerEvents: 'none',
                  }}>
                    {item.controller === 0 ? '▲ You' : '▼ Opp'}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── Arena: Targeting arrow ── */}
      {targeting && (
        <svg style={{ position: 'fixed', inset: 0, zIndex: 240, pointerEvents: 'none', width: '100vw', height: '100vh' }}>
          <defs>
            <linearGradient id="tgt-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f0c040" />
              <stop offset="100%" stopColor="#e74c3c" />
            </linearGradient>
            <marker id="tgt-arrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#f0c040" />
            </marker>
          </defs>
          <line
            ref={targetArrowRef}
            x1={0} y1={0} x2={0} y2={0}
            stroke="url(#tgt-grad)" strokeWidth={3}
            className="targeting-arrow-line"
            markerEnd="url(#tgt-arrow)"
          />
        </svg>
      )}

      {/* Ver Campo button removed — viewingBattlefield toggle (line ~2598) handles this */}
    </div>
  );
}

// ── Art-crop URL helper (converts Scryfall /normal/ → /art_crop/) ─────────────
function toArtCropUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace('/normal/', '/art_crop/');
}

// ── GoldberryCounterSelector ─────────────────────────────────────────────────
function GoldberryCounterSelector({ available, onConfirm }: { available: Record<string, number>; onConfirm: (amounts: Record<string, number>) => void }) {
  const [chosen, setChosen] = useState<Record<string, number>>(() => Object.fromEntries(Object.keys(available).map(k => [k, 0])));
  const total = Object.values(chosen).reduce((s, n) => s + n, 0);
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass" style={{ maxWidth: 380 }}>
        <h3 className="overlay-title">💧 Goldberry — Move Counters</h3>
        <p className="overlay-hint">Choose how many counters of each type to move from Goldberry onto your permanent. Must move at least 1.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '14px 0' }}>
          {Object.entries(available).map(([cType, max]) => (
            <div key={cType} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>{cType}</span>
              <span style={{ color: '#9ca3af', fontSize: 12 }}>({max} available)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="btn btn-muted" style={{ padding: '2px 8px', fontSize: 13 }} onClick={() => setChosen(c => ({ ...c, [cType]: Math.max(0, (c[cType] || 0) - 1) }))}>−</button>
                <span style={{ minWidth: 24, textAlign: 'center', color: 'var(--gold)', fontWeight: 700 }}>{chosen[cType] || 0}</span>
                <button className="btn btn-muted" style={{ padding: '2px 8px', fontSize: 13 }} onClick={() => setChosen(c => ({ ...c, [cType]: Math.min(max, (c[cType] || 0) + 1) }))}>+</button>
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-primary overlay-confirm" disabled={total < 1} onClick={() => onConfirm(chosen)}>
          Move {total > 0 ? `${total} counter${total !== 1 ? 's' : ''}` : '...'} &amp; Draw
        </button>
      </div>
    </div>
  );
}

// ── BattlefieldCard ───────────────────────────────────────────────────────────

/** Mini attachment thumbnail with image→text fallback */
function AttachmentThumb({ a, onAttachmentTargetClick, onDoubleClick, onRightClick }: {
  a: any; onAttachmentTargetClick?: (c: any) => void; onDoubleClick?: (c: any) => void; onRightClick: (c: any) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const directImg = a.image_small || a.image_normal || a.image_uris?.small || a.image_uris?.normal;
  const fallbackImg = !directImg && (a.set_code && (a.collector_number || a.set_number))
    ? `https://api.scryfall.com/cards/${a.set_code.toLowerCase()}/${a.collector_number || a.set_number}?format=image&version=small`
    : null;
  const imgSrc = directImg || (!imgFailed ? fallbackImg : null);
  const handleClick = (e: React.MouseEvent) => { e.stopPropagation(); onAttachmentTargetClick ? onAttachmentTargetClick(a) : onDoubleClick ? onDoubleClick(a) : onRightClick(a); };
  const handleCtx = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onRightClick(a); };
  if (imgSrc) {
    return <img className="bf-attachment-mini" src={imgSrc} alt={a.name}
      title={`${a.name} — clique para re-equipar · botão direito para zoom`}
      onClick={handleClick} onContextMenu={handleCtx}
      onError={() => setImgFailed(true)} />;
  }
  return <div className="bf-attachment-mini bf-attachment-text" title={a.name}
    onClick={handleClick} onContextMenu={handleCtx}>{a.name}</div>;
}

interface BFCardProps {
  card: any;
  isAttacking: boolean;
  isAttacker: boolean;
  isTargetable?: boolean;
  isNotTargetable?: boolean;  // dim when targeting mode active and this card is not a valid target
  isBlockingTarget?: boolean;
  isAssignedBlocker?: boolean;
  isSelectedBlocker?: boolean;
  canActivate?: boolean;
  overrideArtUrl?: string;
  isAutoTapPreview?: boolean;
  isRecentlyEntered?: boolean;
  isTriggerPulsing?: boolean;
  cantBlock?: boolean;
  /** Cards currently equipped/enchanting this creature (shown as mini thumbnails) */
  attachmentCards?: any[];
  /** Cards exiled by this permanent (enchantments like Banishing Light) */
  exiledCards?: any[];
  /** For Betor, Kin to All: cumulative toughness of all my creatures (shows threshold progress) */
  betorToughnessTotal?: number;
  grantedKeywords?: Set<string>;
  /** When set, attachment thumbnail clicks call this instead of onDoubleClick (for targeting auras) */
  onAttachmentTargetClick?: (card: any) => void;
  isRingBearer?: boolean;
  onClick?: (card: any) => void;
  onDoubleClick?: (card: any) => void;
  onRightClick: (card: any) => void;
}

function BattlefieldCard({ card, isAttacking, isAttacker, isTargetable, isNotTargetable, isBlockingTarget, isAssignedBlocker, isSelectedBlocker, canActivate, overrideArtUrl, isAutoTapPreview, isRecentlyEntered, isTriggerPulsing, cantBlock, attachmentCards, exiledCards, betorToughnessTotal, grantedKeywords, isRingBearer, onAttachmentTargetClick, onClick, onDoubleClick, onRightClick }: BFCardProps) {
  const isLand = card.type_line?.includes('Land');
  const isCreature = card.type_line?.includes('Creature') || !!(card as any)._vehicleActive;
  const isPlaneswalkerCard = card.type_line?.includes('Planeswalker');
  const counters = Object.entries(card._counters || {}).filter(([, v]) => (v as number) > 0);
  const mod = (card._counters?.['+1/+1'] ?? 0) - (card._counters?.['-1/-1'] ?? 0);
  const rawPow = parseInt(card.power);
  const basePow = isNaN(rawPow)
    ? (card._vividPower ? (card._vividPowerValue ?? 0) : card._starPower ? (card._starValue ?? 0) : (card._dynamicPower ?? null))
    : rawPow;
  const power = basePow != null ? basePow + (card._powerMod ?? 0) + mod : null;
  const rawTou = parseInt(card.toughness);
  const baseTou = isNaN(rawTou) ? (card._starPower ? (card._starValue ?? 0) : null) : rawTou;
  const toughness = baseTou != null ? baseTou + (card._toughnessMod ?? 0) + mod : null;

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
        ${isNotTargetable ? 'not-targetable' : ''}
        ${isBlockingTarget ? 'blocking-target' : ''}
        ${isAssignedBlocker ? 'assigned-blocker' : ''}
        ${isSelectedBlocker ? 'targetable' : ''}
        ${isAutoTapPreview ? 'auto-tap-preview' : ''}
        ${isRecentlyEntered ? 'card-entering' : ''}
        ${isTriggerPulsing ? 'trigger-pulse' : ''}
        ${cantBlock ? 'cant-block' : ''}
        ${attachmentCards && attachmentCards.length > 0 ? 'has-attachments' : ''}
        ${exiledCards && exiledCards.length > 0 ? 'has-exiled' : ''}
        ${card._phasedOut ? 'phased-out' : ''}
      `}
      style={attachmentCards && attachmentCards.length > 0 ? {
        marginTop: Math.max(16, attachmentCards.length * 12),
        marginLeft: Math.max(20, attachmentCards.length * 8),
      } : undefined}
      onClick={() => onClick?.(card)}
      onDoubleClick={() => onDoubleClick?.(card)}
      onContextMenu={e => { e.preventDefault(); onRightClick?.(card); }}
    >
      {card._isToken && !(overrideArtUrl || card.image_normal || card.image_small) ? (
        <BfToken card={card} power={power} toughness={toughness} />
      ) : (
        <img
          src={overrideArtUrl || card.image_normal || card.image_small || undefined}
          alt={card.name}
        />
      )}
      {/* Always show P/T badge for creatures (including tokens — BfToken's internal P/T
          disappears when Scryfall image loads asynchronously, so badge must always be present). */}
      {isCreature && power !== null && (
        <div className={`bf-pt${(card._powerMod || 0) > 0 || (card._toughnessMod || 0) > 0 ? ' buffed' : (card._powerMod || 0) < 0 || (card._toughnessMod || 0) < 0 ? ' debuffed' : ''}`}>
          {power}/{card._damage > 0
            ? <span className="toughness-damaged">{(toughness ?? 0) - (card._damage || 0)}</span>
            : toughness}
        </div>
      )}
      {counters.filter(([type]) => type === '+1/+1' || type === '-1/-1').map(([type, n]) => (
        <div key={type} className={`bf-counter ${type.includes('+') ? 'positive' : 'negative'}`} title={`${n} ${type} counter${(n as number) > 1 ? 's' : ''}`}>
          {type.includes('+') ? '+' : '-'}{n as number}
        </div>
      ))}
      {(card._counters?.burden ?? 0) > 0 && (
        <div className="bf-burden-counter" title={`${card._counters.burden} burden counter${card._counters.burden > 1 ? 's' : ''}`}>
          {card._counters.burden}
        </div>
      )}
      {(card._counters?.influence ?? 0) > 0 && (
        <div className="bf-influence-counter" title={`${card._counters.influence} influence counter${card._counters.influence > 1 ? 's' : ''}`}>
          👁{card._counters.influence}
        </div>
      )}
      {isAttacking && <div className="bf-attacking-indicator">⚔</div>}
      {cantBlock && <div className="bf-cant-block-badge" title="Can't block this turn">🚫</div>}
      {isRingBearer && <div className="bf-ring-bearer" title="Ring-bearer"><img src={ringBearerImg} alt="Ring" /></div>}
      {/* ── Mana cost top-right ── */}
      {!isLand && card.mana_cost && (
        <div className="bf-mana-cost">
          <ManaCostPips cost={card.mana_cost} size={12} />
        </div>
      )}

      {/* ── Keyword badges ── */}
      {isCreature && (() => {
        const kws = card.keywords || [];
        const text = (card.oracle_text || '').toLowerCase();
        // Build set of temp-granted keyword names for styling
        const tempKwNames = new Set<string>(
          (card._tempKeywords || []).map((t: any) => typeof t === 'string' ? t : t.keyword)
        );
        // Check keyword counters (flying counter, etc.)
        const counterKws = new Set<string>();
        if (card._counters) {
          for (const [k, v] of Object.entries(card._counters)) {
            if (v && (v as number) > 0 && !k.includes('/')) counterKws.add(k.toLowerCase());
          }
        }
        const has = (kw: string) => {
          const kwL = kw.toLowerCase();
          if (counterKws.has(kwL)) return true;
          // Conditional hexproof (Karakyk Guardian)
          if (kwL === 'hexproof' && card._hexproofUntilDamage && !card._hasDealtDamage) return true;
          return kws.some((k: string) => k?.toLowerCase() === kwL) || tempKwNames.has(kw) || [...(tempKwNames)].some(t => t.toLowerCase() === kwL) || (grantedKeywords ? [...grantedKeywords].some(g => g.toLowerCase() === kwL) : false);
        };
        type KwEntry = { label: string; key: string; img?: string };
        const abilImg = (name: string) => `/img/abilities/${name}`;
        const badges: KwEntry[] = [];
        const push = (label: string, key: string, img?: string) => badges.push({ label, key, img });
        if (has('Flying')) push('✈', 'Flying', abilImg('flying.png'));
        if (has('First Strike')) push('FS', 'First Strike', abilImg('first_strike.png'));
        if (has('Double Strike')) push('DS', 'Double Strike', abilImg('double_strike.png'));
        if (has('Deathtouch')) push('☠', 'Deathtouch', abilImg('deathtouch.png'));
        if (has('Lifelink')) push('♥', 'Lifelink', abilImg('lifelink.png'));
        if (has('Trample')) push('Tpl', 'Trample', abilImg('trample.png'));
        if (has('Haste')) push('H', 'Haste', abilImg('haste.png'));
        if (has('Reach')) push('Rch', 'Reach', abilImg('reach.png'));
        if (has('Hexproof')) push('Hex', 'Hexproof', abilImg('hexproof.png'));
        if (has('hexproof_from_monocolored')) push('HxM', 'Hexproof from Monocolored', abilImg('hexproof.png'));
        if (has('Indestructible')) push('Ind', 'Indestructible', abilImg('indestrutivel.png'));
        if (has('Menace')) push('Men', 'Menace', abilImg('menace.png'));
        if (has('Vigilance')) push('Vig', 'Vigilance', abilImg('vigilance.png'));
        if (has('Flash')) push('⚡', 'Flash', abilImg('flash.png'));
        if (has('Defender')) push('🛡', 'Defender', abilImg('defender.png'));
        if (has('Ward')) push('W', 'Ward', abilImg('ward.png'));
        if (has('Decayed')) push('💀', 'Decayed', abilImg('decayed.png'));
        if (has('unblockable')) push('👻', 'Unblockable', abilImg('cant_block.png'));
        if (has('Prowess')) push('Prw', 'Prowess', abilImg('prowess.png'));
        // Protection badges (static keywords)
        if (has('protection from white')) push('🛡W', 'Protection from White', abilImg('protection.png'));
        if (has('protection from blue')) push('🛡U', 'Protection from Blue', abilImg('protection.png'));
        if (has('protection from black')) push('🛡B', 'Protection from Black', abilImg('protection.png'));
        if (has('protection from red')) push('🛡R', 'Protection from Red', abilImg('protection.png'));
        if (has('protection from green')) push('🛡G', 'Protection from Green', abilImg('protection.png'));
        // Temporary protection (e.g. Pippin, Guard of the Citadel grants protection from a card type)
        if (card._tempProtectionFrom && Array.isArray(card._tempProtectionFrom)) {
          for (const p of card._tempProtectionFrom) {
            const pType = p.type || p;
            const pKey = `Protection from ${pType}s`;
            push(`🛡${pType[0]}`, pKey, abilImg('protection.png'));
            tempKwNames.add(pKey);
          }
        }
        if (badges.length === 0) return null;
        return (
          <div className="bf-keyword-badges">
            {badges.map(({ label, key, img }) => (
              <span key={key} className={`kw-badge${tempKwNames.has(key) ? ' kw-temp' : ''}`} title={tempKwNames.has(key) ? `${key} (until end of turn)` : key}>
                {img ? <img src={img} alt={key} className="kw-badge-img" /> : label}
              </span>
            ))}
          </div>
        );
      })()}
      {/* ── Attached-to indicator (on equipment/aura itself) ── */}
      {card._attachedTo && (
        <div className="bf-equip-attached" title="Equipped/Enchanting">🔗</div>
      )}
      {/* ── Arena-style: equipment/aura thumbnails on creature ── */}
      {attachmentCards && attachmentCards.length > 0 && (
        <div className="bf-attachment-strip">
          {attachmentCards.map((a: any, i: number) => {
            const attImg = a.image_small || a.image_normal || a.image_uris?.small || a.image_uris?.normal;
            const attClick = (e: React.MouseEvent) => { e.stopPropagation(); onAttachmentTargetClick ? onAttachmentTargetClick(a) : onDoubleClick ? onDoubleClick(a) : onRightClick(a); };
            const attCtx = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onRightClick(a); };
            const n = i + 1;
            const pos = { top: n * -12, left: n * -8, zIndex: -n } as React.CSSProperties;
            return attImg ? (
              <img key={a._uid} className="bf-attachment-mini" style={pos} src={attImg} alt={a.name}
                title={`${a.name} — clique para re-equipar · botão direito para zoom`}
                onClick={attClick} onContextMenu={attCtx} />
            ) : (
              <div key={a._uid} className="bf-attachment-mini bf-attachment-text" style={pos}
                title={a.name} onClick={attClick} onContextMenu={attCtx}>{a.name}</div>
            );
          })}
        </div>
      )}
      {/* ── Arena-style: exiled-by-enchantment thumbnails ── */}
      {exiledCards && exiledCards.length > 0 && (
        <div className="bf-exiled-strip">
          {exiledCards.map((ex: any, i: number) => (
            <img
              key={ex._uid || i}
              className="bf-exiled-mini"
              src={ex.image_small || ex.image_normal || ex.image_uris?.small || ex.image_uris?.normal}
              alt={ex.name}
              title={`Exiled: ${ex.name}`}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ))}
        </div>
      )}
      {/* ── Betor toughness tracker ── */}
      {betorToughnessTotal !== undefined && (
        <div className="betor-tracker" title={`Total toughness: ${betorToughnessTotal}\n≥10: draw a card | ≥20: untap creatures | ≥40: opponent loses half their life`}>
          <div className="betor-tracker-total">{betorToughnessTotal}</div>
          <div className="betor-tracker-bars">
            <div className={`betor-bar ${betorToughnessTotal >= 10 ? 'betor-bar-met' : ''}`} title="≥10: draw">10</div>
            <div className={`betor-bar ${betorToughnessTotal >= 20 ? 'betor-bar-met' : ''}`} title="≥20: untap">20</div>
            <div className={`betor-bar ${betorToughnessTotal >= 40 ? 'betor-bar-met' : ''}`} title="≥40: half life">40</div>
          </div>
        </div>
      )}
      {/* ── Saga badge ── */}
      {card._isSaga && (
        <div className="bf-saga-badge">
          CH {card._sagaChapter || 1}/{card._sagaMaxChapter || '?'}
        </div>
      )}
      {/* ── Verse counter badge (Lost Isle Calling, etc.) ── */}
      {(card._counters?.['verse'] || 0) > 0 && (
        <div className="bf-saga-badge" style={{ background: '#1a4d8f' }}>
          📖 {card._counters['verse']}
        </div>
      )}
      {/* ── Finality counter badge ── */}
      {card._finalityCounter && (
        <div className="bf-finality-badge">FINALITY</div>
      )}
      {/* ── Loses all abilities badge (Fresh Start aura) ── */}
      {card._losesAllAbilities && (
        <div className="bf-finality-badge" style={{ background: '#8b0000' }}>NO ABILITIES</div>
      )}
      {/* ── Stun badge ── */}
      {((card._stunCounters || 0) + (card._counters?.stun || 0)) > 0 && (
        <div className="bf-stun-badge">STUN {(card._stunCounters || 0) + (card._counters?.stun || 0) > 1 ? `×${(card._stunCounters || 0) + (card._counters?.stun || 0)}` : ''}</div>
      )}
      {/* ── Transform badge ── */}
      {card._canTransform && (
        <div className="bf-transform-badge">↔</div>
      )}
      {/* ── Planeswalker loyalty badge ── */}
      {isPlaneswalkerCard && card._loyalty !== undefined && (
        <div className={`bf-loyalty-badge${card._loyaltyUsedThisTurn ? ' bf-loyalty-used' : ''}`}>
          {card._loyaltyUsedThisTurn ? '✓' : ''}{card._loyalty}
        </div>
      )}
    </div>
  );
}

// ── ZoomModifiedPanel ─────────────────────────────────────────────────────────

function ZoomModifiedPanel({ card }: { card: any }) {
  const counters = card._counters || {};
  const counterBonus = (counters['+1/+1'] || 0) - (counters['-1/-1'] || 0);
  const hasPT = card.power != null;

  // Compute current P/T
  const basePow = parseInt(card.power);
  const baseTou = parseInt(card.toughness);
  const curPow = isNaN(basePow) ? null : basePow + (card._powerMod || 0) + counterBonus;
  const curTou = isNaN(baseTou) ? null : baseTou + (card._toughnessMod || 0) + counterBonus;
  const origPow = isNaN(basePow) ? null : basePow;
  const origTou = isNaN(baseTou) ? null : baseTou;

  // Temp buffs (until EOT)
  const tempPow = card._tempPowerMod || 0;
  const tempTou = card._tempToughnessMod || 0;

  // Counter list
  const counterEntries = Object.entries(counters).filter(([, v]) => (v as number) > 0);

  // Temp keywords
  const tempKws: string[] = card._tempKeywords || [];
  const stunCount: number = (card._stunCounters || 0) + (card._counters?.stun || 0);
  const damage: number = card._damage || 0;
  const isTapped: boolean = !!card._tapped;
  const hasSummoningSick: boolean = !!card._summoningSick;

  const noChanges = !counterEntries.length && !tempPow && !tempTou && !tempKws.length &&
    !stunCount && !damage && curPow === origPow && curTou === origTou;

  return (
    <div className="zoom-modified-panel">
      {hasPT && curPow != null && (
        <div className="zm-row">
          <span className="zm-label">P/T</span>
          <span className="zm-val">
            <span className={curPow !== origPow ? 'zm-changed' : ''}>{curPow}</span>
            {' / '}
            <span className={curTou !== origTou ? 'zm-changed' : ''}>{curTou}</span>
            <span className="zm-orig"> (base {origPow}/{origTou})</span>
          </span>
        </div>
      )}
      {counterEntries.length > 0 && (
        <div className="zm-row">
          <span className="zm-label">Counters</span>
          <span className="zm-val">
            {counterEntries.map(([k, v]) => (
              <span key={k} className={`zm-counter zm-counter-${k === '+1/+1' ? 'plus' : k === '-1/-1' ? 'minus' : 'other'}`}>
                {v as number}× {k}
              </span>
            ))}
          </span>
        </div>
      )}
      {(tempPow !== 0 || tempTou !== 0) && (
        <div className="zm-row">
          <span className="zm-label">Until EOT</span>
          <span className="zm-val zm-changed">
            {tempPow > 0 ? `+${tempPow}` : tempPow}{' / '}{tempTou > 0 ? `+${tempTou}` : tempTou}
          </span>
        </div>
      )}
      {tempKws.length > 0 && (
        <div className="zm-row">
          <span className="zm-label">Granted</span>
          <span className="zm-val zm-changed">{tempKws.join(', ')}</span>
        </div>
      )}
      {stunCount > 0 && (
        <div className="zm-row">
          <span className="zm-label">Stun</span>
          <span className="zm-val zm-danger">{stunCount} counter{stunCount > 1 ? 's' : ''}</span>
        </div>
      )}
      {damage > 0 && (
        <div className="zm-row">
          <span className="zm-label">Damage</span>
          <span className="zm-val zm-danger">{damage} (lethal at {curTou})</span>
        </div>
      )}
      {isTapped && (
        <div className="zm-row">
          <span className="zm-label">Status</span>
          <span className="zm-val zm-muted">Tapped</span>
        </div>
      )}
      {hasSummoningSick && (
        <div className="zm-row">
          <span className="zm-label">Sick</span>
          <span className="zm-val zm-muted">Summoning sickness</span>
        </div>
      )}
      {card._attachedTo && (
        <div className="zm-row">
          <span className="zm-label">Attached</span>
          <span className="zm-val zm-muted">On battlefield</span>
        </div>
      )}
      {noChanges && (
        <div className="zm-muted" style={{ padding: '8px 0', fontSize: 12 }}>
          No modifications — card is at base state
        </div>
      )}
    </div>
  );
}
