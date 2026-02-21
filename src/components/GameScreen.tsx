// GameScreen.tsx — Game UI connected to the real engine via useGameEngine hook

import { useState, useEffect, useRef, useMemo } from 'react';
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
  AbilityModal, ExileOverlay, CombatArrows, GraveyardMultiSelectOverlay,
  BounceMultiOverlay, DistributeCountersOverlay, ManaCostPips, MANA_IMAGES,
  KeyboardHelpOverlay, DistributeDamageOverlay,
} from './game/GameOverlays';
import { VfxLayer, VfxManager } from './game/VfxLayer';
import { getLandManaColors, canPay } from '../engine/mana';
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

// ── Battlefield token renderer (fetches real image from Scryfall) ─────────────
function BfToken({ card, power, toughness }: { card: any; power: number | null; toughness: number | null }) {
  const [imgUrl, setImgUrl] = useState<string | null>(() => {
    const cached = getTokenImageUrl(card.name);
    if (cached) card.image_normal = cached; // sync cache hit: write immediately
    return cached;
  });
  useEffect(() => {
    if (imgUrl) return;
    preloadTokenImage(card.name, card.colors || []).then(url => {
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
      {power !== null && <span className="bf-token-pt">{power}/{toughness}</span>}
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
  const [zoomModified, setZoomModified] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Reset modified view when zoom target changes
  useEffect(() => setZoomModified(false), [zoom]);

  // ── Overlay states ────────────────────────────────────────────────────────
  const [graveyardOpen, setGraveyardOpen] = useState<{ pid: number } | null>(null);
  const [exileOpen, setExileOpen] = useState<{ pid: number } | null>(null);
  // Targeting: pending spell waiting for player to click a target
  // Multi-step targeting: step/steps/collectedTargets for spells that need multiple sequential targets
  const [targeting, setTargeting] = useState<{
    cardUid: string;
    card: any;
    step?: number;
    steps?: Array<{ side: 'own' | 'opponent'; prompt: string }>;
    collectedTargets?: any[];
  } | null>(null);
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
  // Mana autopay preview: which lands will be auto-tapped when this hand card is hovered
  const [hoveredHandCard, setHoveredHandCard] = useState<string | null>(null);

  // Toast / banner / auto-pass states
  const [toasts, setToasts] = useState<{id: number; msg: string; type: string}[]>([]);
  const toastIdRef = useRef(0);
  const [showStack, setShowStack] = useState(false);
  const [turnBanner, setTurnBanner] = useState<string | null>(null);
  const [autoPass, setAutoPass] = useState(false);
  const autoPassRef = useRef(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showOppTooltip, setShowOppTooltip] = useState(false);
  // Full Control Mode: pause at every phase transition (like Arena Ctrl)
  const [fullControl, setFullControl] = useState(false);
  const fullControlRef = useRef(false);
  const prevLifeRef = useRef<[number, number] | null>(null);
  const prevActivePlayerRef = useRef<number | null>(null);

  // ── Arena-like animation states ──────────────────────────────────────────
  // Battlefield enter/exit
  const [recentlyEntered, setRecentlyEntered] = useState<Set<string>>(new Set());
  const [ghosts, setGhosts] = useState<Array<{id: number; imgSrc: string; x: number; y: number; w: number; h: number}>>([]);
  const ghostIdRef = useRef(0);
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
  // Combat edge flash
  const [combatFlash, setCombatFlash] = useState(false);
  const prevPhaseRef = useRef<string | null>(null);
  // Target arrow
  const targetArrowRef = useRef<SVGLineElement>(null);
  // Floating mana pip animations (on land tap)
  const [floatingManas, setFloatingManas] = useState<{ id: string; color: string; x: number; y: number }[]>([]);

  // Build decks for the engine (memoized — only recompute when deck/pool changes)
  const playerDeck = useMemo(() => {
    const spells = deck?.mainboard ?? draftPool.slice(0, 23);
    const lands  = deck?.lands    ?? { W: 9, U: 8, B: 0, R: 0, G: 0 };
    return buildFullDeck(spells, lands);
  }, [deck, draftPool]);

  const aiDeck = useMemo(() => {
    const spells = deck?.mainboard ?? draftPool.slice(0, 23);
    const aiPool = draftPool.filter(c => !c.type_line?.includes('Land'));
    const aiDeckData = aiPool.length >= 10
      ? botBuildDeck(aiPool)
      : { deck: spells.slice(0, 23), lands: { W: 9, U: 8 } as Record<string, number>, sideboard: [] as any[] };
    return buildFullDeck(aiDeckData.deck, aiDeckData.lands);
  }, [deck, draftPool]);

  const { snap, loading, error, actions, gsRef, canUndoMana, undoManaCount } = useGameEngine(playerDeck, aiDeck);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [snap?.log]);

  function addToast(msg: string, type: string = 'info') {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev.slice(-4), { id, msg, type }]); // max 5 toasts
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2500);
  }

  function addFloat(value: string, x: number, y: number, type: string) {
    const id = ++floatIdRef.current;
    setFloats(prev => [...prev.slice(-8), { id, value, x, y, type }]);
    setTimeout(() => setFloats(prev => prev.filter(f => f.id !== id)), 800);
  }

  function showCastAnimation(card: any) {
    if (!card?.image_normal && !card?.image_small) return;
    setCastingCard(card);
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
    // Warn when hand reaches 8 during player's own turn (before cleanup)
    if (handSize >= 8 && handSize > prevHandSizeRef.current && activePlayer === 0 && phase !== 'cleanup') {
      addToast(`⚠ Mão cheia (${handSize}) — descarte no cleanup!`, 'damage');
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

    // Entering battlefield — VFX + scale-in animation
    const newEntries = new Set<string>();
    for (const uid of nowSet) {
      if (!prev.has(uid)) {
        newEntries.add(uid);
        setTimeout(() => VfxManager.play('buff', uid), 80);
      }
    }
    if (newEntries.size > 0) {
      setRecentlyEntered(s => new Set([...s, ...newEntries]));
      setTimeout(() => {
        setRecentlyEntered(s => {
          const next = new Set(s);
          for (const uid of newEntries) next.delete(uid);
          return next;
        });
      }, 500);
    }

    // Leaving battlefield — VFX + ghost fade-out
    const newGhosts: typeof ghosts = [];
    for (const uid of prev) {
      if (!nowSet.has(uid)) {
        VfxManager.play('death', uid);
        const el = document.querySelector(`[data-uid="${uid}"]`);
        if (el) {
          const rect = el.getBoundingClientRect();
          const img = el.querySelector('img');
          const imgSrc = img?.src || '';
          if (imgSrc) {
            newGhosts.push({
              id: ++ghostIdRef.current,
              imgSrc,
              x: rect.left, y: rect.top,
              w: rect.width, h: rect.height,
            });
          }
        }
      }
    }
    if (newGhosts.length > 0) {
      setGhosts(g => [...g, ...newGhosts].slice(-10));
      const ids = newGhosts.map(g => g.id);
      setTimeout(() => setGhosts(g => g.filter(ghost => !ids.includes(ghost.id))), 400);
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
          if (blockingWith) { setBlockingWith(null); break; }
          {
            // Block Space from skipping mandatory-input states
            const blockingInputTypes = ['discard', 'sacrifice', 'scry', 'surveil', 'search_library', 'modal', 'order_blockers'];
            const wiType = snap?.waitingForInput?.type;
            if (wiType && blockingInputTypes.includes(wiType) && snap?.waitingForInput?.playerId === 0) break;
          }
          if (snap?.waitingForInput?.type === 'declare_blockers' && snap.waitingForInput.playerId === 0) {
            actions.confirmBlockers();
          } else {
            actions.nextPhase();
          }
          break;
        case 'Escape':
          if (showHelpModal) { setShowHelpModal(false); break; }
          if (targeting) { setTargeting(null); break; }
          if (blockingWith) { setBlockingWith(null); break; }
          if (graveyardOpen) { setGraveyardOpen(null); break; }
          if (exileOpen) { setExileOpen(null); break; }
          if (abilityModal) { setAbilityModal(null); break; }
          if (equipModal) { setEquipModal(null); break; }
          if (attackTargetPicker) { setAttackTargetPicker(null); break; }
          if (adventureModal) { setAdventureModal(null); break; }
          if (conditionalCostConfirm) { setConditionalCostConfirm(null); break; }
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
        case 'Control':
          // Full Control Mode toggle: pause at every phase like Arena Ctrl
          fullControlRef.current = !fullControlRef.current;
          setFullControl(v => !v);
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
  }, [snap, actions, targeting, graveyardOpen, blockingWith, showStack, autoPass, exileOpen, abilityModal, equipModal, attackTargetPicker, adventureModal, conditionalCostConfirm, showHelpModal]);

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

  // Detect cards that need sequential multi-step targeting (own creature first, then opponent).
  // Covered patterns:
  //   A) "buff/double target creature you control ... fights target creature" (Dragonclaw Strike)
  //   B) "put a counter on target creature you control, then it deals damage to target creature" (Knockout Maneuver)
  //   C) "target creature you control deals damage equal to its power to target creature" (Piercing Exhale)
  function getMultiTargetSteps(card: any): Array<{ side: 'own' | 'opponent'; prompt: string }> | null {
    const text = (card?.oracle_text || '').toLowerCase();
    if (!text.includes('target creature you control')) return null;

    // Pattern A: ... then that creature fights target creature (Dragonclaw Strike)
    // Oracle: "...then it fights up to one target creature an opponent controls."
    if ((text.includes('fights') || text.includes('fight')) && text.includes('target creature') && !text.includes('deals damage')) {
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
  // stepFilter: if provided, restrict to 'own' or 'opponent' side only (for multi-step targeting)
  function getValidTargets(card: any, stepFilter?: 'own' | 'opponent') {
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

    const wantsCreature = text.includes('target creature') || text.includes('target permanent') || text.includes('target nonland');
    // "target player" / "target opponent" / "player or planeswalker" are explicitly player-targeting.
    // Do NOT include generic 'damage'/'deals' here — that's too broad and wrongly targets players
    // for cards like "deals 5 damage to target creature". 'any target' is handled via wantsAny below.
    const wantsPlayer = text.includes('target player') || text.includes('target opponent') ||
      text.includes('target player or planeswalker') || text.includes('target opponent or planeswalker');
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
      targets.push({ type: 'player', player: 1, name: 'Opponent' });
      if (!wantsEnemy) targets.push({ type: 'player', player: 0, name: 'You' });
    }

    return targets;
  }

  function handleCardClick(card: any, pid: number) {
    if (!snap) return;
    const wi = snap.waitingForInput;

    // ── Targeting mode: clicking a creature/permanent to target it ──────────
    if (targeting) {
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
      } else if (targetType === 'own_nonlegendary_creature') {
        isValid = pid === 0 && tl.includes('creature') && !tl.includes('legendary');
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

      // Counter spells: auto-target opponent's topmost stack spell
      const cardText = (card.oracle_text || '').toLowerCase();
      const isCounterSpell = cardText.includes('counter target spell') ||
                              cardText.includes('counter target creature spell') ||
                              cardText.includes('counter target instant') ||
                              cardText.includes('counter target sorcery');
      if (isCounterSpell) {
        const gs = gsRef.current;
        const stackItems: any[] = gs?.stack?.items || [];
        const oppSpells = stackItems.filter((item: any) => item.controller !== 0);
        if (oppSpells.length === 0) return; // Nothing to counter
        const topOppSpell = oppSpells[oppSpells.length - 1];
        showCastAnimation(card);
        actions.castSpell(card._uid, [topOppSpell.card]);
        return;
      }

      // Detect cards that need two sequential targets (e.g. Dragonclaw Strike: buff own then fight opp)
      const multiSteps = getMultiTargetSteps(card);
      if (spellNeedsTargeting(card)) {
        if (multiSteps) {
          setTargeting({ cardUid: card._uid, card, step: 1, steps: multiSteps, collectedTargets: [] });
        } else {
          setTargeting({ cardUid: card._uid, card });
        }
      } else {
        showCastAnimation(card);
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
          spawnManaFloat(card);
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
        showCastAnimation(targeting.card);
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
    if (!snap) return;
    const phase = snap.phase;
    const wiType = snap.waitingForInput?.type;
    const isInstantWindow = wiType === 'instant_priority' || wiType === 'stack_priority';
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
      if (locked) return; // silently block — UI shows no modal
    }

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

  // ── Floating mana pip on land tap ────────────────────────────────────────────
  function spawnManaFloat(landCard: any) {
    const colors = getLandManaColors(landCard);
    const color = colors[0] || 'C';
    const el = document.querySelector(`[data-uid="${landCard._uid}"]`) as HTMLElement | null;
    let x = window.innerWidth * 0.5 + (Math.random() - 0.5) * 120;
    let y = window.innerHeight * 0.72;
    if (el) {
      const rect = el.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }
    const id = landCard._uid + '_' + Date.now();
    setFloatingManas(prev => [...prev, { id, color, x, y }]);
    setTimeout(() => setFloatingManas(prev => prev.filter(f => f.id !== id)), 850);
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

  // During main phase, use the engine's getPlayableCards (via humanPlayableUids in snapshot)
  // so cost reductions (Bell-Ringer, etc.) are reflected correctly.
  // During instant/stack priority, fall back to local CMC computation since that
  // window is narrower and getPlayableCards isn't gated by phase there.
  const enginePlayableUids: Set<string> = (snap as any).humanPlayableUids || new Set();

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
            // Main phase: defer to engine's getPlayableCards for accuracy
            if (enginePlayableUids.size > 0) return enginePlayableUids.has(c._uid);
            // Fallback if engine result unavailable
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
    if (!hoveredHandCard || !isMainPhaseHuman) return new Set<string>();
    const card = p0.hand.find((c: any) => c._uid === hoveredHandCard);
    if (!card || (card.type_line || '').toLowerCase().includes('land')) return new Set<string>();

    const cost = card.mana_cost || '';
    const cmc = card._effectiveCmc ?? card.cmc ?? 0;
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
          >☠ GY: {p1.graveyard.length}</span>
          <span
            className="exile-click-zone"
            onClick={() => setExileOpen({ pid: 1 })}
          >✨ Ex: {p1.exile?.length || 0}</span>
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
              <div className="oit-row"><span className="oit-label">❤️ Vida</span><span className="oit-val">{p1.life}</span></div>
              <div className="oit-row"><span className="oit-label">🃏 Mão</span><span className="oit-val">{p1.hand.length} cartas</span></div>
              <div className="oit-row"><span className="oit-label">📚 Deck</span><span className="oit-val">{p1.libraryCount} cartas</span></div>
              <div className="oit-row"><span className="oit-label">☠ Cemitério</span><span className="oit-val">{p1.graveyard.length} cartas</span></div>
              <div className="oit-row"><span className="oit-label">🐉 Criaturas</span><span className="oit-val">{oppCreatures}</span></div>
              <div className="oit-row"><span className="oit-label">🌲 Terrenos</span><span className="oit-val">{oppLands.length} ({oppUntappedLands} livres)</span></div>
              {oppOther > 0 && <div className="oit-row"><span className="oit-label">✨ Outros</span><span className="oit-val">{oppOther}</span></div>}
            </div>
          );
        })()}
      </div>

      {/* ── Opponent battlefield ── */}
      <div className="game-opp-bf">
        {/* ── Zone cluster do oponente: Grimório + Cemitério ── */}
        {(() => {
          const CARD_BACK = 'https://backs.scryfall.io/large/59/482d0001-547e-4a13-a0f7-451e2a1b5940.jpg';
          const gyCards: any[] = p1.graveyard || [];
          const topGyCard = gyCards.length > 0 ? gyCards[gyCards.length - 1] : null;
          return (
            <div className="zone-cluster zone-cluster-opp">
              {/* Grimório do oponente — canto superior-esquerdo */}
              <div className="library-zone-visual" title={`Grimório: ${p1.libraryCount} cartas`}>
                <span className="zone-count-badge">{p1.libraryCount}</span>
                <div className="library-card-stack">
                  <img className="lib-card lib-card-3" src={CARD_BACK} alt="deck" />
                  <img className="lib-card lib-card-2" src={CARD_BACK} alt="deck" />
                  <img className="lib-card lib-card-1" src={CARD_BACK} alt="deck" />
                  <div className="lib-shield-badge">🛡</div>
                </div>
              </div>
              {/* Cemitério do oponente */}
              <div
                className="gy-zone-visual"
                onClick={() => setGraveyardOpen({ pid: 1 })}
                title={`Cemitério: ${gyCards.length} carta${gyCards.length !== 1 ? 's' : ''}`}
              >
                <span className="zone-count-badge">{gyCards.length}</span>
                {topGyCard ? (
                  <>
                    <img
                      className="gy-zone-card"
                      src={topGyCard.image_normal || topGyCard.image_small}
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
                .filter((c: any) => !c.type_line?.includes('Land'))
                .sort((a: any, b: any) => (a.type_line?.includes('Planeswalker') ? 1 : 0) - (b.type_line?.includes('Planeswalker') ? 1 : 0));
              const lands = p1.battlefield.filter((c: any) => c.type_line?.includes('Land'));
              // Build uid→card map for resolving attachment UIDs
              const p1BfMap = new Map(p1.battlefield.map((c: any) => [c._uid, c]));
              const makeCard = (card: any) => {
                const _stepFilter = targeting?.steps && targeting.step ? targeting.steps[targeting.step - 1]?.side : undefined;
                const validTgts = targeting ? getValidTargets(targeting.card, _stepFilter) : [];
                const isTargetable = !!(targeting &&
                  validTgts.some((t: any) => (t.type === 'creature' || t.type === 'permanent') && t.uid === card._uid));
                const isBlockingTarget = !!(snap.waitingForInput?.type === 'declare_blockers' &&
                  blockingWith && card._attacking);
                // Show "being attacked" glow on a PW that is currently targeted by an attacker
                const isAttackTarget = !!(card.type_line?.includes('Planeswalker') &&
                  combat.attackers.some((a: any) => a.attackTarget === card._uid));
                // Resolve attachment card objects (equipment/auras on this creature)
                const attachmentCards = (card._attachments || [])
                  .map((uid: string) => p1BfMap.get(uid)).filter(Boolean);
                // Cards exiled by this permanent (e.g. Banishing Light)
                const exiledCards = card._exiledCards || [];
                return (
                  <BattlefieldCard
                    key={card._uid}
                    card={card}
                    isAttacking={combat.attackers.some((a: any) => (typeof a === 'string' ? a : a.uid) === card._uid)}
                    isAttacker={false}
                    isTargetable={isTargetable || isAttackTarget}
                    isBlockingTarget={isBlockingTarget}
                    isRecentlyEntered={recentlyEntered.has(card._uid)}
                    isTriggerPulsing={triggerPulseUids.has(card._uid)}
                    overrideArtUrl={getLandArtUrl(card)}
                    attachmentCards={attachmentCards}
                    exiledCards={exiledCards}
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
              title={p.tip}
            >
              {p.label}
            </div>
          ))}
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
            {/* Keyboard help button */}
            <button
              className="btn btn-muted btn-sm"
              style={{ fontSize: 11, padding: '1px 7px', opacity: 0.6 }}
              onClick={() => setShowHelpModal(true)}
              title="Atalhos de teclado (?)"
            >?</button>
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
            {canUndoMana && isMainPhaseHuman && (
              <button
                className="btn-undo-mana"
                onClick={() => actions.undoTapLand()}
                title={`Desfazer tap de terreno (${undoManaCount} tapado${undoManaCount !== 1 ? 's' : ''})`}
              >↩ Undo {undoManaCount > 1 ? `(${undoManaCount})` : ''}</button>
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
        {/* ── Zone cluster: Cemitério + Grimório ── */}
        {(() => {
          const CARD_BACK = sleeveArt || 'https://backs.scryfall.io/large/59/482d0001-547e-4a13-a0f7-451e2a1b5940.jpg';
          const gyCards: any[] = p0.graveyard || [];
          const topGyCard = gyCards.length > 0 ? gyCards[gyCards.length - 1] : null;
          return (
            <div className="zone-cluster">
              {/* Cemitério — última carta face-up, clicável */}
              <div
                className="gy-zone-visual"
                onClick={() => setGraveyardOpen({ pid: 0 })}
                title={`Cemitério: ${gyCards.length} carta${gyCards.length !== 1 ? 's' : ''}`}
              >
                {topGyCard ? (
                  <>
                    <img
                      className="gy-zone-card"
                      src={topGyCard.image_normal || topGyCard.image_small}
                      alt={topGyCard.name}
                      onError={e => { (e.currentTarget as HTMLImageElement).src = CARD_BACK; }}
                    />
                    {gyCards.length > 1 && (
                      <div className="gy-zone-stack-hint" />
                    )}
                    <span className="zone-count-badge">{gyCards.length}</span>
                  </>
                ) : (
                  <div className="gy-zone-empty">
                    <span className="gy-zone-empty-icon">☠</span>
                  </div>
                )}
              </div>

              {/* Grimório — pilha face-down com escudo */}
              <div className="library-zone-visual" title={`Grimório: ${p0.libraryCount} cartas`}>
                <div className="library-card-stack">
                  <img className="lib-card lib-card-3" src={CARD_BACK} alt="deck" />
                  <img className="lib-card lib-card-2" src={CARD_BACK} alt="deck" />
                  <img className="lib-card lib-card-1" src={CARD_BACK} alt="deck" />
                  <div className="lib-shield-badge">🛡</div>
                </div>
                <span className="zone-count-badge">{p0.libraryCount}</span>
              </div>
            </div>
          );
        })()}

        {p0.battlefield.length === 0
          ? <span className="game-bf-empty">Your battlefield</span>
          : (() => {
              const nonLands = p0.battlefield
                .filter((c: any) => !c.type_line?.includes('Land'))
                .sort((a: any, b: any) => (a.type_line?.includes('Planeswalker') ? 1 : 0) - (b.type_line?.includes('Planeswalker') ? 1 : 0));
              const lands = p0.battlefield.filter((c: any) => c.type_line?.includes('Land'));
              // Build uid→card map for resolving attachment UIDs
              const p0BfMap = new Map(p0.battlefield.map((c: any) => [c._uid, c]));
              const makeCard = (card: any) => {
                const _stepFilter2 = targeting?.steps && targeting.step ? targeting.steps[targeting.step - 1]?.side : undefined;
                const isTargetable = !!(targeting &&
                  getValidTargets(targeting.card, _stepFilter2).some((t: any) => (t.type === 'creature' || t.type === 'permanent') && t.uid === card._uid));
                const isAssignedBlocker = !!(card._blocking);
                const isSelectedBlocker = blockingWith === card._uid;
                const canActivatePW = !!(
                  card.type_line?.includes('Planeswalker') &&
                  isMainPhaseHuman &&
                  !card._loyaltyUsedThisTurn
                );
                // Resolve attachment card objects (equipment/auras on this creature)
                const attachmentCards = (card._attachments || [])
                  .map((uid: string) => p0BfMap.get(uid)).filter(Boolean);
                // Cards exiled by this permanent (e.g. Banishing Light)
                const exiledCards = card._exiledCards || [];
                return (
                  <BattlefieldCard
                    key={card._uid}
                    card={card}
                    isAttacking={combat.attackers.some((a: any) => (typeof a === 'string' ? a : a.uid) === card._uid)}
                    isAttacker
                    isTargetable={isTargetable}
                    isAssignedBlocker={isAssignedBlocker}
                    isSelectedBlocker={isSelectedBlocker}
                    canActivate={canActivatePW}
                    overrideArtUrl={getLandArtUrl(card)}
                    isAutoTapPreview={autoTapPreviewUids.has(card._uid)}
                    isRecentlyEntered={recentlyEntered.has(card._uid)}
                    isTriggerPulsing={triggerPulseUids.has(card._uid)}
                    attachmentCards={attachmentCards}
                    exiledCards={exiledCards}
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
            {p0.hand.map((card: any) => {
              const isPlayable = playableSet.has(card._uid);
              const isOmenMode = omenOnlyPlayable.has(card._uid);
              const advFace = card.back_face;
              const omenLabel = advFace?.type_line?.toLowerCase().includes('omen') ? 'Omen' : 'Adv';
              const isHovered = hoveredHandCard === card._uid;
              const isCreatureCard = card.type_line?.includes('Creature');
              const cardPow = isCreatureCard ? parseInt(card.power) || 0 : null;
              const cardTou = isCreatureCard ? parseInt(card.toughness) || 0 : null;
              return (
                <div
                  key={card._uid}
                  data-uid={card._uid}
                  className={`game-hand-card ${isPlayable ? 'hand-playable' : humanHasPriority ? 'hand-unplayable' : ''} ${newHandUids.has(card._uid) ? 'hand-draw-in' : ''}`}
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
                          ⬆ Criatura · Clique direito → Aventura
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
          <div className="game-zoom-info glass" onClick={e => e.stopPropagation()}>
            <div className="game-zoom-header">
              <div className="game-zoom-name">{zoom.name}</div>
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
              creature: 'any creature',
              own_creature: 'one of your creatures',
              own_nonlegendary_creature: 'a non-legendary creature you control',
              opponent_creature: "an opponent's creature",
              creature_with_flying: 'a creature with flying',
              artifact: 'an artifact',
              enchantment: 'an enchantment',
              permanent: 'a permanent',
              nonland_permanent: 'a non-land permanent',
              any: 'any target',
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
                🎯 {wi.cardName || 'Spell'}: choose {label}
                <div style={{ fontSize: 12, color: '#a78bfa', marginTop: 4 }}>
                  Click a valid target on the battlefield
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
          case 'stack_priority': {
            const pendingCard = gs?._pendingCastOnStack?.card;
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
            const searchTarget = pending?.effect?.target || pending?.target || '';
            const searchTypeLabel: Record<string, string> = {
              creature: 'a Creature', land: 'a Land', basic_land: 'a Basic Land',
              instant: 'an Instant', sorcery: 'a Sorcery', artifact: 'an Artifact',
              enchantment: 'an Enchantment', dragon: 'a Dragon', permanent: 'a Permanent',
            };
            const typeHint = searchTypeLabel[searchTarget] || '';
            const titleBase = pending?.tapped ? '🌳 Search — Put Land into Play (Tapped)' : '📚 Search Library';
            const title = typeHint ? `${titleBase} — Choose ${typeHint}` : titleBase;
            return candidates.length > 0 ? (
              <SearchLibraryOverlay
                candidates={candidates}
                optional={pending?.optional}
                title={title}
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

          // ── Distribute counters — multi-click UI ──────────────────────────
          case 'distribute_counters': {
            const pending = gs?._pendingDistribute;
            const creatures = pending
              ? snap.players[0].battlefield.filter((c: any) => c.type_line?.includes('Creature'))
              : [];
            return pending ? (
              <DistributeCountersOverlay
                creatures={creatures}
                totalAmount={pending.amount || 1}
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

          // ── Sacrifice choice ─────────────────────────────────────────────
          case 'sacrifice': {
            const choices = (wi as any).choices || [];
            const isForCast = !!(wi as any)._forCast;
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title={isForCast ? '💀 Additional Cost — Sacrifice a Creature' : '💀 Sacrifice — Choose Creature'}
                optional={(wi as any).optional}
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

          // ── ETB bounce target (Iceridge Serpent, Marang River Regent, etc.) ──
          case 'etb_bounce_target': {
            const choices = (wi as any).choices || [];
            const maxBounce = (wi as any).maxBounce || 1;
            if (maxBounce > 1) {
              return (
                <BounceMultiOverlay
                  permanents={choices}
                  maxBounce={maxBounce}
                  title={`↩ Bounce — Choose up to ${maxBounce} permanents to return`}
                  onConfirm={uids => actions.resolveETBBounceTarget(uids)}
                />
              );
            }
            return (
              <CreatureChoiceOverlay
                creatures={choices}
                title="↩ Bounce — Choose a permanent to return to hand"
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
                onConfirm={uid => actions.resolveETBExileTarget(uid ? [uid] : [])}
              />
            );
          }

          // ── tap_creature cost (Dragonbrood's Relic etc.) ──────────────────
          // ── ETB clone target (Naga Fleshcrafter etc.) ────────────────────
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
                      Your GY ({myGy.length})
                    </button>
                    <button className="btn btn-muted" onClick={() => actions.resolveGraveyardChoice(1)}>
                      Opponent's GY ({oppGy.length})
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

          // ── Graveyard card choice: pick specific cards ────────────────────
          case 'graveyard_card_choice': {
            const pending = gs?._pendingGraveyardCardChoice;
            if (!pending) return null;
            const pid = pending.playerId ?? 0;
            const gy = snap.players[pid].graveyard;
            return (
              <GraveyardMultiSelectOverlay
                cards={gy}
                amount={pending.amount ?? 1}
                minAmount={pending.minAmount ?? 0}
                title={`☠ Exile from ${pid === 0 ? 'Your' : "Opponent's"} Graveyard`}
                onConfirm={uids => actions.resolveGraveyardCardChoice(uids)}
              />
            );
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
              <CreatureChoiceOverlay
                creatures={candidates}
                title={`💪 Buff up to ${pending.maxTargets || 1} Creature(s)`}
                hint={`Choose a creature to receive the buff`}
                optional
                onConfirm={uid => actions.resolveMultiBuffChoiceAction(uid ? [uid] : [])}
              />
            );
          }

          // ── Normal gameplay states — no overlay, player acts on board ──
          case 'main_phase':
          case 'declare_attackers':
          case 'mulligan':
          case 'choose_target':
            return null;

          // ── Blocker damage order — auto-resolve using AI heuristic ───
          case 'order_blockers': {
            return (
              <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 7000 }}>
                <div className="glass overlay-panel" style={{ maxWidth: 320, padding: 16, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Blocker Order</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Multiple blockers — confirm damage assignment order.
                  </div>
                  <button className="btn btn-gold" onClick={() => actions.resolveOrderBlockers()}>
                    Confirm Order
                  </button>
                </div>
              </div>
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

          // ── Behold: reveal a dragon from hand ───────────────────────
          case 'behold_choice_multiple':
          case 'behold_choice_optional': {
            const pending = gs?._pendingBeholdChoice;
            if (!pending) return null;
            return (
              <SearchLibraryOverlay
                candidates={pending.cards || []}
                title="🐉 Behold — Reveal a Dragon from your hand"
                hint="Choose which Dragon to reveal. The card stays in your hand."
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
        return (
          <TargetingPrompt
            spell={promptSpell}
            validTargets={getValidTargets(targeting.card, stepFilter)}
            onTarget={() => {}}
            onCancel={() => setTargeting(null)}
          />
        );
      })()}

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
                ⚔️ Equip {equipModal.equipName}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Choose a creature to equip:
              </div>
              {myCreatures.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No creatures available.</div>
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
                ⚔️ Who to attack?
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
                👤 Attack the player
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
                  🌟 Attack {pw.name} <span style={{ color: 'rgba(230,120,0,0.9)', fontWeight: 800 }}>★{pw._loyalty ?? '?'}</span>
                </button>
              ))}
              <button
                className="btn btn-muted"
                style={{ marginTop: 4, width: '100%' }}
                onClick={() => setAttackTargetPicker(null)}
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
                How do you want to cast this card?
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

      {/* ── Arena: Exit ghosts (dying/exiled card fade-out) ── */}
      {ghosts.map(g => (
        <div
          key={g.id}
          className="exit-ghost"
          style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
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
  canActivate?: boolean;
  overrideArtUrl?: string;
  isAutoTapPreview?: boolean;
  isRecentlyEntered?: boolean;
  isTriggerPulsing?: boolean;
  /** Cards currently equipped/enchanting this creature (shown as mini thumbnails) */
  attachmentCards?: any[];
  /** Cards exiled by this permanent (enchantments like Banishing Light) */
  exiledCards?: any[];
  onClick?: (card: any) => void;
  onDoubleClick?: (card: any) => void;
  onRightClick: (card: any) => void;
}

function BattlefieldCard({ card, isAttacking, isAttacker, isTargetable, isBlockingTarget, isAssignedBlocker, isSelectedBlocker, canActivate, overrideArtUrl, isAutoTapPreview, isRecentlyEntered, isTriggerPulsing, attachmentCards, exiledCards, onClick, onDoubleClick, onRightClick }: BFCardProps) {
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
        ${isAutoTapPreview ? 'auto-tap-preview' : ''}
        ${isRecentlyEntered ? 'card-entering' : ''}
        ${isTriggerPulsing ? 'trigger-pulse' : ''}
      `}
      onClick={() => onClick?.(card)}
      onDoubleClick={() => onDoubleClick?.(card)}
      onContextMenu={e => { e.preventDefault(); onRightClick(card); }}
    >
      {card._isToken && !(overrideArtUrl || card.image_normal || card.image_small) ? (
        <BfToken card={card} power={power} toughness={toughness} />
      ) : (
        <img src={overrideArtUrl || card.image_normal || card.image_small || undefined} alt={card.name} loading="lazy" />
      )}
      {/* Real cards always show badge; token-copies (image_normal set) also show badge
          since their card image has base P/T but actual P/T may differ due to buffs.
          Regular tokens (no image) use BfToken placeholder which shows P/T internally. */}
      {isCreature && power !== null && (!card._isToken || !!(overrideArtUrl || card.image_normal || card.image_small)) && (
        <div className={`bf-pt${(card._powerMod || 0) > 0 || (card._toughnessMod || 0) > 0 ? ' buffed' : (card._powerMod || 0) < 0 || (card._toughnessMod || 0) < 0 ? ' debuffed' : ''}`}>{power}/{toughness}</div>
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
        // Build set of temp-granted keyword names for styling
        const tempKwNames = new Set<string>(
          (card._tempKeywords || []).map((t: any) => typeof t === 'string' ? t : t.keyword)
        );
        type KwEntry = { label: string; key: string };
        const badges: KwEntry[] = [];
        const push = (label: string, key: string) => badges.push({ label, key });
        if (kws.includes('Flying') || text.includes('flying')) push('✈', 'Flying');
        if (kws.includes('First Strike') || text.includes('first strike')) push('FS', 'First Strike');
        if (kws.includes('Double Strike') || text.includes('double strike')) push('DS', 'Double Strike');
        if (kws.includes('Deathtouch') || text.includes('deathtouch')) push('☠', 'Deathtouch');
        if (kws.includes('Lifelink') || text.includes('lifelink')) push('♥', 'Lifelink');
        if (kws.includes('Trample') || text.includes('trample')) push('Tpl', 'Trample');
        if (kws.includes('Haste') || text.includes('haste')) push('H', 'Haste');
        if (kws.includes('Reach') || text.includes('reach')) push('Rch', 'Reach');
        if (kws.includes('Hexproof') || text.includes('hexproof')) push('Hex', 'Hexproof');
        if (kws.includes('Indestructible') || text.includes('indestructible')) push('Ind', 'Indestructible');
        if (kws.includes('Menace') || text.includes('menace')) push('Men', 'Menace');
        if (kws.includes('Vigilance') || text.includes('vigilance')) push('Vig', 'Vigilance');
        if (kws.includes('Flash') || text.includes('flash')) push('⚡', 'Flash');
        if (badges.length === 0) return null;
        return (
          <div className="bf-keyword-badges">
            {badges.map(({ label, key }) => (
              <span key={key} className={`kw-badge${tempKwNames.has(key) ? ' kw-temp' : ''}`} title={tempKwNames.has(key) ? `${key} (until end of turn)` : key}>{label}</span>
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
          {attachmentCards.map((a: any) => (
            <img
              key={a._uid}
              className="bf-attachment-mini"
              src={a.image_small || a.image_normal}
              alt={a.name}
              title={a.name}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ))}
        </div>
      )}
      {/* ── Arena-style: exiled-by-enchantment thumbnails ── */}
      {exiledCards && exiledCards.length > 0 && (
        <div className="bf-exiled-strip">
          {exiledCards.map((ex: any, i: number) => (
            <img
              key={ex._uid || i}
              className="bf-exiled-mini"
              src={ex.image_small || ex.image_normal}
              alt={ex.name}
              title={`Exilada: ${ex.name}`}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ))}
        </div>
      )}
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
  const stunCount: number = card._stunCounters || 0;
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
