// ============================================
// Core MTG Card Types
// ============================================

export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic';
export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack' | 'command';

export interface CardFace {
  name: string;
  mana_cost: string;
  type_line: string;
  oracle_text: string;
  power?: string;
  toughness?: string;
  image_normal?: string;
}

export interface Card {
  id: string;
  oracle_id: string;
  name: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  oracle_text: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors: Color[];
  color_identity: Color[];
  keywords: string[];
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: Rarity;
  image_small: string;
  image_normal: string;
  image_art_crop: string;
  layout: string;
  produced_mana?: Color[];
  back_face?: CardFace;
}

// ============================================
// Game-Specific Types
// ============================================

export interface GameCard extends Card {
  _uid: string;          // Unique instance ID
  _owner: number;        // Player who owns this card (0 or 1)
  _controller: number;   // Player who currently controls it
  _zone: Zone;
  _tapped: boolean;

  // Combat
  _attacking: boolean;
  _blocking: string | null; // UID of card being blocked
  _blockedBy: string[];

  // Modifiers
  _powerMod: number;
  _toughnessMod: number;
  _tempPowerMod: number;
  _tempToughnessMod: number;
  _counters: Record<string, number>; // e.g. '+1/+1': 2, '-1/-1': 1
  _stunCounters: number;

  // State
  _summoningSick: boolean;
  _hasDiedThisTurn: boolean;
  _damageMarked: number;
  _tempKeywords: string[];
  _attachedTo?: string;
  _attachments: string[];

  // Sagas
  _isSaga?: boolean;
  _sagaChapter?: number;
  _sagaMaxChapter?: number;

  // DFC
  _transformed?: boolean;
  _frontFaceData?: Partial<Card>;

  // Combat tracking
  _hasDealtDamage?: boolean;

  // Granted keywords from external sources
  _grantedKeywords?: string[];

  // Misc
  _evoked?: boolean;
  _championedCard?: GameCard;
  _hideawayCard?: GameCard;
  _regenerateShield?: boolean;
  _exiledPlayable?: boolean;
}

// ============================================
// Effect System Types
// ============================================

export type EffectType =
  | 'damage' | 'destroy' | 'exile' | 'draw' | 'gainLife' | 'loseLife'
  | 'buff' | 'bounce' | 'scry' | 'surveil' | 'mill' | 'ramp'
  | 'create_token' | 'destroy_all' | 'exile_all' | 'damage_all_creatures'
  | 'counters' | 'counter_self' | 'counter_all' | 'discard' | 'fight'
  | 'tap' | 'untap' | 'drain' | 'prevent_damage'
  | 'loot' | 'bounce_self' | 'look_top' | 'damage_all'
  | 'grant' | 'grant_all' | 'anthem' | 'threaten' | 'stun'
  | 'search_library' | 'create_token_copy' | 'gain_control'
  | 'copy_spell' | 'extra_combat' | 'modal'
  | string; // extensible

export interface Effect {
  type: EffectType;
  amount?: number | string;
  target?: string;
  keyword?: string;
  keywords?: string[];
  power?: number;
  toughness?: number;
  token?: TokenDefinition;
  condition?: string;
  duration?: string;
  optional?: boolean;
  self?: boolean;
}

export interface TokenDefinition {
  name: string;
  power: number;
  toughness: number;
  colors: Color[];
  types: string;
  keywords?: string[];
}

export interface TriggerDefinition {
  event: string;
  condition?: string;
  effects: Effect[];
  self?: boolean;
  optional?: boolean;
}

export interface ActivatedAbility {
  cost: string;
  effects: Effect[];
  zone?: string;
  once_per_turn?: boolean;
  tap?: boolean;
}

export interface CardEffectEntry {
  cast?: Effect[];
  etb?: Effect[];
  triggered?: TriggerDefinition[];
  activated?: ActivatedAbility[];
  static?: StaticAbility[];
  modal?: ModalDefinition;
  harmonize?: string;
  omen?: boolean;
}

export interface StaticAbility {
  type: string;
  keywords?: string[];
  amount?: number;
  target?: string;
  condition?: string;
}

export interface ModalDefinition {
  type: 'modal';
  modes: ModalMode[];
  chooseTwo?: boolean;
}

export interface ModalMode {
  description: string;
  effects: Effect[];
}

// ============================================
// Game State Types
// ============================================

export type Phase =
  | 'untap' | 'upkeep' | 'draw'
  | 'main1'
  | 'combat_begin' | 'declare_attackers' | 'declare_blockers' | 'combat_damage' | 'combat_end'
  | 'main2'
  | 'end_step' | 'cleanup';

export interface Player {
  id: number;
  name: string;
  life: number;
  library: GameCard[];
  hand: GameCard[];
  battlefield: GameCard[];
  graveyard: GameCard[];
  exile: GameCard[];
  manaPool: ManaPool;
  poisonCounters: number;
}

export interface ManaPool {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number; // colorless
}

export interface GameState {
  players: [Player, Player];
  activePlayer: number;
  phase: Phase;
  turn: number;
  stack: StackItem[];
  priority: number;
  winner: number | null;
  waitingForInput: WaitingForInput | null;
}

export interface StackItem {
  id: string;
  card?: GameCard;
  effects: Effect[];
  controller: number;
  targets: string[];
}

export interface WaitingForInput {
  type: string;
  playerId: number;
  data?: Record<string, unknown>;
}

// ============================================
// Draft Types
// ============================================

export interface DraftState {
  packs: Card[][][];     // [player][pack][card]
  currentPack: number;
  currentPick: number;
  playerPool: Card[];
  botPools: Card[][];
  picks: Card[];
}

export interface DeckList {
  mainboard: Card[];
  sideboard: Card[];
  lands: Record<string, number>; // e.g. { Plains: 8, Island: 9 }
}

// ============================================
// App Navigation
// ============================================

export type Screen = 'home' | 'draft' | 'deckbuilder' | 'game' | 'settings' | 'sealed' | 'login' | 'online_lobby' | 'online_game' | 'online_draft' | 'pod_lobby';

// ============================================
// Multiplayer Types
// ============================================

export type MultiplayerRole = 'host' | 'guest' | null;

export interface OnlineUser {
  uid: string;
  email: string;
  displayName: string;
}

// ============================================
// Database Row Types (from SQLite)
// ============================================

export interface CardRow {
  id: string;
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  cmc: number;
  type_line: string;
  oracle_text: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  colors: string | null;       // JSON array
  color_identity: string | null; // JSON array
  keywords: string | null;      // JSON array
  set_code: string;
  set_name: string | null;
  collector_number: string | null;
  rarity: string;
  image_small: string | null;
  image_normal: string | null;
  image_art_crop: string | null;
  layout: string | null;
  produced_mana: string | null;  // JSON array
  back_face_name: string | null;
  back_face_mana_cost: string | null;
  back_face_type_line: string | null;
  back_face_oracle_text: string | null;
  back_face_power: string | null;
  back_face_toughness: string | null;
  back_face_image_normal: string | null;
}
