// game-state-types.ts — Types for the full game state
// Split from the massive game-state module

import type { GameCard, ManaPool, Effect, TriggerDefinition } from './engine-types';
import type { Zone } from './zones';
import type { CombatState } from './combat';

// ============================================
// Callback interfaces (replacing VFX/UIGame globals)
// ============================================

export interface GameCallbacks {
  // Phase & turn
  onPhaseChange?: (phase: string) => void;
  onPhaseTransition?: () => void;

  // Cards
  onCardPlayed?: (card: GameCard, playerId: number) => void;
  onSpellCast?: (cardName: string) => void;
  onCardDraw?: (playerId: number) => void;
  onEnterBattlefield?: (cardUid: string) => void;

  // Combat & damage
  onDamage?: (target: string, amount: number) => void;
  onDeath?: (cardUid: string) => void;
  onBuff?: (cardUid: string) => void;

  // Triggers
  onTriggerFire?: (cardUid: string) => void;

  // Game over
  onGameOver?: (winner: number) => void;
}

// ============================================
// Stack item
// ============================================

export interface StackItem {
  card: GameCard;
  controller: number;
  targets: TargetInfo[];
  effects: Effect[];
  type?: string;
}

export interface GameStack {
  items: StackItem[];
}

// ============================================
// Target info
// ============================================

export interface TargetInfo {
  type?: string;
  player: number;
  uid: string;
}

// ============================================
// Waiting for input
// ============================================

export interface WaitingForInput {
  type: string;
  playerId: number;
  phase?: string;
  amount?: number;
  spellCaster?: number;
  prompt?: string;
  attackerUids?: string[];
  [key: string]: unknown;
}

// ============================================
// Player
// ============================================

export interface PlayerZones {
  library: Zone;
  hand: Zone;
  battlefield: Zone;
  graveyard: Zone;
  exile: Zone;
}

export interface Player {
  id: number;
  life: number;
  zones: PlayerZones;
  isHuman: boolean;
}

// ============================================
// Full game state
// ============================================

export interface FullGameState {
  players: Player[];
  activePlayer: number;
  phase: string;
  phaseIndex: number;
  turn: number;
  combat: CombatState;
  stack: GameStack;
  manaPool: ManaPool[];
  landPlayedThisTurn: boolean;
  winner: number | null;
  log: string[];
  waitingForInput: WaitingForInput | null;
  turnHistory: unknown[];
  mulliganCount: number[];
  mulliganDone: boolean[];

  // Triggers
  _triggers: RegisteredTrigger[];
  _tempTriggers: TempTrigger[];
  _triggerDepth: number;
  _triggeredOnceThisTurn: Record<string, boolean>;

  // Spell tracking
  _spellsThisTurn: number[];
  _beholding: (GameCard | null)[];

  // Turn tracking
  _creatureDiedThisTurn: Record<number, boolean>;
  _castCreatureThisTurn: Record<number, boolean>;
  _castNoncreatureThisTurn: Record<number, boolean>;
  _abilityUsedThisTurn: Record<string, boolean>;
  _damageDealtThisTurn: Record<number, number> | null;
  _lifeLostThisTurn: Record<number, number> | null;
  _attackedThisTurn: Record<number, boolean>;
  _drewExtraThisTurn: Record<number, boolean> | null;
  _lastDiscardedNonland: Record<number, boolean> | null;
  _exiledThisResolution: boolean;
  _cardLeftGraveyardThisTurn: Record<number, boolean> | null;
  _lastPreventedDamage: number;

  // Phase processing (trampoline)
  _processingPhases: boolean;
  _continueProcessing: boolean;

  // Priority
  _priorityPassed: boolean;
  _upkeepPriorityDone: boolean;
  _combatBeginTriggered: boolean;
  _postAttackersPriority: boolean;
  _postAttackersAPPriority: boolean;
  _postBlockersAPPriority: boolean;
  _postBlockersNAPPriority: boolean;

  // Pending input states
  _pendingScry: unknown;
  _pendingLoot: unknown;
  _pendingRamp: unknown;
  _pendingBlight: unknown;
  _pendingBuffChoice: unknown;
  _pendingMultiBuffChoice: unknown;
  _pendingEndure: unknown;
  _pendingManaChoice: unknown;
  _pendingBeholdChoice: unknown;
  _pendingCastOnStack: unknown;
  _pendingUnlessPay: unknown;
  _pendingHandExile: unknown;
  _pendingLookTop: unknown;
  _pendingRummage: unknown;
  _pendingOptionalDiscard: unknown;
  _pendingTravelingBotanist: unknown;
  _pendingMillLandChoice: unknown;
  _pendingSagaChapter: unknown;
  _pendingHideaway: unknown;
  _pendingSearchChoice: unknown;
  _pendingLegendaryChoice: unknown;
  _pendingExileChoice: unknown;
  _pendingTargetChoice: unknown;
  _pendingSpellCopy: Record<number, boolean>;

  // Exile
  _exiledPlayable: Record<string, ExiledPlayableEntry> | null;
  _temporaryExiles: Record<string, TemporaryExileInfo>;
  _permanentExiles: Record<string, PermanentExileEntry[]>;

  // Ring (LTR)
  _ringLevel: [number, number];
  _ringBearer: [string | null, string | null];
  _pendingRingBearer: unknown;

  // Misc
  _damageShield: Record<number, number> | null;
  _extraCombat: boolean;
  _resumingFromStackPriority: boolean;
  _skipLegendaryCheck: boolean;
  _legendaryChoice: string;
  _suspendedSpells: Record<number, SuspendedSpell[]>;
  _aiActions: unknown[];

  // Allow extra properties (dynamic state)
  [key: string]: unknown;
}

// ============================================
// Registered trigger
// ============================================

export interface RegisteredTrigger extends TriggerDefinition {
  cardUid: string;
  cardName: string;
  controllerId: number;
}

export interface TempTrigger {
  cardUid: string;
  controllerId?: number;
  controller?: number;
  event: string;
  effects: Effect[];
  duration: string;
  condition?: string;
  sourceCard?: GameCard;
  once?: boolean;
  expiresAt?: string;
  _tempId: number;
}

// ============================================
// Exiled card tracking
// ============================================

export interface ExiledPlayableEntry {
  card: GameCard;
  controller: number;
  turn: number;
  duration?: string;
  freeCast?: boolean;
}

export interface TemporaryExileInfo {
  exilerUid: string;
  originalOwner: number;
  originalZone: string;
}

export interface PermanentExileEntry {
  exiledCard: GameCard;
  exiledCardUid: string;
  originalOwner: number;
}

export interface SuspendedSpell {
  uid: string;
  timeCounters: number;
  originalCard: GameCard;
}

// ============================================
// Cast result
// ============================================

export interface CastResult {
  success: boolean;
  msg?: string;
  waitForInput?: boolean;
  waitForChoice?: boolean;
  pendingStack?: boolean;
  paused?: boolean;
}

// ============================================
// External AI/Stack interfaces (dependency injection)
// ============================================

/**
 * Interface for the AI module.
 * The game state module does NOT directly import the AI;
 * instead it receives an object implementing this interface.
 */
export interface GameAIInterface {
  playMainPhase(state: FullGameState, playerId: number): void;
  playInstantPhase(state: FullGameState, playerId: number, phase: string): void;
  declareAttackers(state: FullGameState, playerId: number): void;
  declareBlockers(state: FullGameState, playerId: number): void;
  orderBlockers(state: FullGameState, playerId: number): void;
  discard(state: FullGameState, playerId: number, count: number): void;
}

/**
 * Interface for the stack module.
 */
export interface GameStackInterface {
  push(stack: GameStack, item: StackItem): void;
  resolve(stack: GameStack, state: FullGameState): string[];
  resolveEffects(state: FullGameState, playerId: number, card: GameCard, effects: Effect[], targets: TargetInfo[]): void;
}
