// TestGame — Builder for creating minimal game states for card testing
// Uses real engine functions so tests validate actual behavior

import * as GameState from '../../src/engine/game-state';
import { _fireETBOnEnter, _registerCardTriggers } from '../../src/engine/game-state';
import * as CardUtils from '../../src/engine/card-utils';
import { CardEffectsDB } from '../../src/engine/card-effects';
import { Zone, PlayerZones } from '../../src/engine/zones';
import * as Mana from '../../src/engine/mana';
import * as Combat from '../../src/engine/combat';

let uidCounter = 0;

export interface CardDef {
  name: string;
  type_line: string;
  oracle_text?: string;
  mana_cost?: string;
  power?: string;
  toughness?: string;
  keywords?: string[];
  colors?: string[];
  color_identity?: string[];
  rarity?: string;
  card_faces?: any;
  set?: string;
  [key: string]: any;
}

/** Create a GameCard with all runtime fields the engine expects */
export function makeCard(def: CardDef, owner: number = 0): any {
  uidCounter++;
  return {
    // Scryfall-like fields
    id: `test-${uidCounter}`,
    name: def.name,
    type_line: def.type_line || '',
    oracle_text: def.oracle_text || '',
    mana_cost: def.mana_cost || '',
    power: def.power || '0',
    toughness: def.toughness || '0',
    keywords: def.keywords || [],
    colors: def.colors || [],
    color_identity: def.color_identity || [],
    rarity: def.rarity || 'common',
    card_faces: def.card_faces || null,
    set: def.set || 'test',
    cmc: def.cmc ?? 0,

    // Runtime fields
    _uid: `test-uid-${uidCounter}`,
    _ownerId: owner,
    _controller: owner,
    _zone: 'battlefield',
    _tapped: false,
    _summoningSick: false,
    _powerMod: 0,
    _toughnessMod: 0,
    _tempPowerMod: 0,
    _tempToughnessMod: 0,
    _counters: {},
    _tempKeywords: [],
    _attachedTo: null,
    _attachments: [],
    _attacking: false,
    _blocking: null,
    _blockedBy: [],
    _damage: 0,
    _damageMarked: 0,
    _regenerateShield: false,
    _isToken: false,
    _etbFired: false,

    // Spread any extra fields from def
    ...Object.fromEntries(
      Object.entries(def).filter(([k]) => !['name', 'type_line', 'oracle_text', 'mana_cost', 'power', 'toughness', 'keywords', 'colors', 'color_identity', 'rarity', 'card_faces', 'set'].includes(k))
    ),
  };
}

export interface TestGameOptions {
  realETBHooks?: boolean;
}

export class TestGame {
  state: any;

  constructor(opts: TestGameOptions = {}) {
    // Build minimal state without decks (no mulligan)
    this.state = {
      players: [
        { id: 0, life: 20, zones: new PlayerZones(), isHuman: false },
        { id: 1, life: 20, zones: new PlayerZones(), isHuman: false },
      ],
      activePlayer: 0,
      phase: 'main1',
      phaseIndex: 3, // main1 index
      turn: 1,
      combat: Combat.createCombatState(),
      stack: { items: [], resolve: null },
      manaPool: [Mana.createPool(), Mana.createPool()],
      landPlayedThisTurn: false,
      winner: null,
      log: [],
      waitingForInput: null,
      turnHistory: [],
      mulliganCount: [0, 0],
      mulliganDone: [true, true],
      _triggers: [],
      _gameQueue: [],
      _processingQueue: false,
      _spellsThisTurn: [0, 0],
      _creatureSpellsThisTurn: [0, 0],
      _noncreatureSpellsThisTurn: [0, 0],
      _beholding: [null, null],
      _stopAtPhases: [],
      _myStopPhases: [],
    };

    // Combat module calls gameState.fireTrigger() as a method on state
    const state = this.state;
    state.fireTrigger = (event: string, data: any) => {
      return GameState.fireTrigger(state, event, data);
    };

    if (opts.realETBHooks) {
      // Use real ETB hooks from game-state (needed for cast flow tests)
      const state = this.state;
      state.players.forEach((p: any, pid: number) => {
        p.zones.battlefield.onAdd = (card: any) => {
          if (card._etbFired) { delete card._etbFired; return; }
          if (card._isToken || card._token) return;
          GameState._registerCardTriggers(state, card, pid);
          GameState._fireETBOnEnter(state, card, pid);
        };
      });
    } else {
      // Install simplified hooks (no ETB auto-fire)
      this.state.players.forEach((p: any) => {
        p.zones.battlefield.onAdd = () => {};
      });
    }
  }

  /** Place card on battlefield (no summoning sickness) */
  addToBattlefield(pid: number, def: CardDef): any {
    const card = makeCard(def, pid);
    card._zone = 'battlefield';
    card._summoningSick = false;
    card._controller = pid;
    this.state.players[pid].zones.battlefield.add(card);
    return card;
  }

  /** Place card in hand */
  addToHand(pid: number, def: CardDef): any {
    const card = makeCard(def, pid);
    card._zone = 'hand';
    this.state.players[pid].zones.hand.add(card);
    return card;
  }

  /** Place card on top of library */
  addToLibraryTop(pid: number, def: CardDef): any {
    const card = makeCard(def, pid);
    card._zone = 'library';
    this.state.players[pid].zones.library.addToTop(card);
    return card;
  }

  /** Place card in graveyard */
  addToGraveyard(pid: number, def: CardDef): any {
    const card = makeCard(def, pid);
    card._zone = 'graveyard';
    this.state.players[pid].zones.graveyard.add(card);
    return card;
  }

  /** Set mana pool directly */
  setMana(pid: number, pool: Partial<Record<string, number>>): void {
    this.state.manaPool[pid] = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...pool };
  }

  /** Add N basic lands of a color to battlefield */
  addLands(pid: number, color: string, count: number): void {
    const landNames: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
    const name = landNames[color] || 'Plains';
    for (let i = 0; i < count; i++) {
      this.addToBattlefield(pid, {
        name,
        type_line: `Basic Land — ${name}`,
        oracle_text: '',
      });
    }
  }

  // ─── Zone accessors ───
  battlefield(pid: number) { return this.state.players[pid].zones.battlefield.cards; }
  hand(pid: number) { return this.state.players[pid].zones.hand.cards; }
  graveyard(pid: number) { return this.state.players[pid].zones.graveyard.cards; }
  library(pid: number) { return this.state.players[pid].zones.library.cards; }
  life(pid: number) { return this.state.players[pid].life; }

  // ─── Engine actions ───

  /** Call real castSpell */
  cast(pid: number, cardUid: string, targets?: any) {
    return GameState.castSpell(this.state, pid, cardUid, targets);
  }

  /** Call real equipCreature */
  equip(equipmentUid: string, creatureUid: string) {
    // Find equipment to determine controller
    const pid = this._findCardController(equipmentUid);
    if (pid === null) return false;
    return GameState.equipCreature(this.state, pid, equipmentUid, creatureUid);
  }

  /** Call real fireTrigger */
  fireTrigger(event: string, data: any) {
    return GameState.fireTrigger(this.state, event, data);
  }

  /** Call real _resolveSimpleEffect */
  resolveEffect(pid: number, effect: any, data?: any) {
    return GameState._resolveSimpleEffect(this.state, pid, effect, data || {});
  }

  /** Set life directly */
  setLife(pid: number, amount: number) {
    this.state.players[pid].life = amount;
  }

  /** Toggle human mode for a player */
  setHuman(pid: number, isHuman: boolean): void {
    this.state.players[pid].isHuman = isHuman;
  }

  /** Parse mana cost string → pool object. "{2}{R}" → {R:1, C:2} */
  static manaForCost(manaCost: string): Record<string, number> {
    const pool: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    const symbols = manaCost.match(/\{([^}]+)\}/g) || [];
    for (const sym of symbols) {
      const inner = sym.slice(1, -1);
      if (/^\d+$/.test(inner)) {
        pool.C = (pool.C || 0) + parseInt(inner, 10);
      } else if ('WUBRG'.includes(inner)) {
        pool[inner] = (pool[inner] || 0) + 1;
      }
    }
    return pool;
  }

  /** Put card in hand, set exact mana, cast it. Returns {result, card} */
  castFromHand(pid: number, cardDef: CardDef, targets?: any): { result: any; card: any } {
    const card = this.addToHand(pid, cardDef);
    const pool = TestGame.manaForCost(cardDef.mana_cost || '');
    this.setMana(pid, pool);
    const result = this.cast(pid, card._uid, targets);
    return { result, card };
  }

  /** Set up combat phase (switch to combat_attackers) */
  startCombat(pid: number): void {
    this.state.activePlayer = pid;
    this.state.phase = 'combat_attackers';
    this.state.combat = Combat.createCombatState();
    this.state.combat.phase = 'declare_attackers';
  }

  /** Declare attacker (wrapper around Combat.declareAttacker) */
  declareAttacker(card: any): boolean {
    return Combat.declareAttacker(this.state.combat, card);
  }

  /** Resolve combat damage */
  resolveCombatDamage(): string[] {
    const ap = this.state.activePlayer;
    const dp = 1 - ap;
    return Combat.resolveCombatDamage(
      this.state.combat,
      this.state.players[ap],
      this.state.players[dp],
      this.state
    );
  }

  private _findCardController(uid: string): number | null {
    for (let pid = 0; pid < 2; pid++) {
      if (this.state.players[pid].zones.battlefield.has(uid)) return pid;
    }
    return null;
  }
}

// Re-export CardUtils for test assertions
export { CardUtils };
