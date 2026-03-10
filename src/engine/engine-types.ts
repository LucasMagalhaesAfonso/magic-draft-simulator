// engine-types.ts — Runtime game types for the engine
// Extends the base types from lib/types.ts with all runtime properties

import type { Card, Color, Effect, TriggerDefinition, ActivatedAbility, CardEffectEntry, StaticAbility } from '../lib/types';

// Re-export commonly used types
export type { Color, Effect, TriggerDefinition, ActivatedAbility, CardEffectEntry, StaticAbility };
export type { Card } from '../lib/types';

// ManaPool with index signature for dynamic access (engine needs string indexing)
export interface ManaPool {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
  [key: string]: number;
}

// ============================================
// Runtime Game Card (extends base Card)
// ============================================

export interface GameCard extends Card {
  _uid: string;
  _owner: number;
  _controller: number;
  _zone: string;
  _tapped: boolean;

  // Combat
  _attacking: boolean;
  _blocking: string | null;
  _blockedBy: string[];
  _hasDealtDamage?: boolean;

  // Modifiers
  _powerMod: number;
  _toughnessMod: number;
  _tempPowerMod: number;
  _tempToughnessMod: number;
  _counters: Record<string, number>;
  _stunCounters: number;
  _damage: number;

  // State
  _summoningSick: boolean;
  _hasDiedThisTurn: boolean;
  _damageMarked: number;
  _tempKeywords: string[];
  _attachedTo?: string;
  _attachedToOwner?: number;
  _attachments: string[];
  _isToken: boolean;
  _isFoodToken?: boolean;

  // Dynamic P/T
  _vividPower?: boolean;
  _vividPowerValue?: number;
  _dynamicPower?: number;

  // Granted keywords from external sources
  _grantedKeywords?: string[];

  // Grants
  _grantAttackingTokens?: string;
  _grantDragons?: string | string[];
  _losesAllAbilities?: boolean;

  // Sagas
  _isSaga?: boolean;
  _sagaChapter?: number;
  _sagaMaxChapter?: number;

  // DFC
  _transformed?: boolean;
  _frontFaceData?: Partial<Card>;
  _backFace?: CardFace;

  // Misc
  _evoked?: boolean;
  _championedCard?: GameCard;
  _championedPlayer?: number;
  _hideawayCard?: GameCard;
  _regenerateShield?: boolean;
  _exiledPlayable?: boolean;
  _harmonizeGranted?: boolean;
  _cantBlockThisTurn?: boolean;
  _cantAttack?: boolean;
  _unblockable?: boolean;
  _starPower?: boolean;
  _starBasedOn?: string;
  _starValue?: number;
  _goaded?: boolean;
  _goadedBy?: number;
  _opponentsCantGainLife?: boolean;
  _exiledUntilLeaves?: any[];
  _exiledByUid?: string;
  _loyaltyUsedThisTurn?: boolean;

  // Adventure
  adventure?: {
    name: string;
    mana_cost: string;
    type_line: string;
    oracle_text: string;
  };

  // Backface shortcut
  backFace?: CardFace;
}

interface CardFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  image_normal?: string;
}

// ============================================
// Parsed Mana Cost
// ============================================

export interface ParsedManaCost {
  generic: number;
  colored: Record<string, number>;
  hybrids: string[][];
  variableX: number;
  total: number;
}

// ============================================
// Combat Simulation Types
// ============================================

export interface CreatureSnapshot {
  uid: string;
  power: number;
  toughness: number;
  damage: number;
  flying: boolean;
  reach: boolean;
  firstStrike: boolean;
  doubleStrike: boolean;
  deathtouch: boolean;
  trample: boolean;
  lifelink: boolean;
  indestructible: boolean;
  menace: boolean;
  vigilance: boolean;
  wither: boolean;
  defender: boolean;
  isToken: boolean;
  cmc: number;
  card: GameCard;
}

export interface CombatResult {
  deadAttackers: Set<number>;
  deadBlockers: Set<number>;
  playerDamage: number;
  lifelinkGain: number;
}

export interface BlockingResult {
  assignment: Record<number, number[]>;
  score: number;
  result: CombatResult;
}

export interface AttackResult {
  attackerIndices: number[];
  score: number;
  lethal?: boolean;
}

// ============================================
// Game State (lightweight for engine use)
// ============================================

export interface EngineGameState {
  players: EnginePlayer[];
  activePlayer: number;
  phase: string;
  turn: number;
  manaPool: ManaPool[];
  [key: string]: unknown; // Allow extra properties
}

export interface EnginePlayer {
  id: number;
  name: string;
  life: number;
  zones: {
    library: { cards: GameCard[]; getAll(): GameCard[] };
    hand: { cards: GameCard[]; getAll(): GameCard[] };
    battlefield: { cards: GameCard[] };
    graveyard: { cards: GameCard[] };
    exile: { cards: GameCard[] };
  };
  _protectionFromEverything?: boolean;
  [key: string]: any;
}
