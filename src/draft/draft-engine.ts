// draft-engine.ts — Pure draft logic (no UI)
// Ported from legacy draft.js, UI removed (will be React components)

import type { Card } from '../lib/types';
import { generate } from './booster';
import { createBot, pickCard, newPack, buildDeck, type BotState, type DeckBuildResult } from './bot-ai';

// ============================================
// Types
// ============================================

export interface DraftState {
  round: number;
  pick: number;
  packs: Card[][][];           // [round][player] = cards
  currentPacks: Card[][];      // current round packs per player
  bots: BotState[];
  playerPool: Card[];
  selectedCard: Card | null;
  finished: boolean;
}

export interface DraftCallbacks {
  onStateChange?: (state: DraftState) => void;
  onDraftFinished?: (playerPool: Card[], botPools: Card[][]) => void;
}

// ============================================
// Constants
// ============================================

const PLAYERS = 8;
const ROUNDS = 3;

// ============================================
// Draft Engine
// ============================================

let state: DraftState | null = null;
let callbacks: DraftCallbacks = {};

export function setCallbacks(cb: DraftCallbacks): void {
  callbacks = cb;
}

export function getState(): DraftState | null {
  return state;
}

export function start(cardPool: Card[]): DraftState {
  // Create 7 bots (player 0 is human)
  const bots: BotState[] = [];
  for (let i = 1; i < PLAYERS; i++) {
    bots.push(createBot(i));
  }

  // Generate all packs (8 players x 3 rounds)
  const allPacks: Card[][][] = [];
  for (let r = 0; r < ROUNDS; r++) {
    const roundPacks: Card[][] = [];
    for (let p = 0; p < PLAYERS; p++) {
      roundPacks.push(generate(cardPool));
    }
    allPacks.push(roundPacks);
  }

  state = {
    round: 0,
    pick: 0,
    packs: allPacks,
    currentPacks: allPacks[0],
    bots,
    playerPool: [],
    selectedCard: null,
    finished: false,
  };

  callbacks.onStateChange?.(state);
  return state;
}

export function getPlayerPack(): Card[] {
  if (!state || state.finished) return [];
  return state.currentPacks[0] || [];
}

export function selectCard(cardId: string): void {
  if (!state) return;
  const pack = getPlayerPack();
  const card = pack.find(c => c.id === cardId);
  if (!card) return;
  state.selectedCard = card;
  callbacks.onStateChange?.(state);
}

export function confirmPick(): void {
  if (!state || !state.selectedCard) return;

  // Player picks
  state.playerPool.push(state.selectedCard);
  state.currentPacks[0] = state.currentPacks[0].filter(c => c.id !== state!.selectedCard!.id);

  // Bots pick
  for (let i = 0; i < state.bots.length; i++) {
    const botPack = state.currentPacks[i + 1];
    if (botPack && botPack.length > 0) {
      const picked = pickCard(state.bots[i], botPack);
      if (picked) {
        state.currentPacks[i + 1] = botPack.filter(c => c.id !== picked.id);
      }
    }
  }

  // Pass packs
  _passPacks();
  state.pick++;
  state.selectedCard = null;

  // Check if round ended
  const playerPack = state.currentPacks[0];
  if (!playerPack || playerPack.length === 0) {
    state.round++;
    state.pick = 0;

    if (state.round >= ROUNDS) {
      state.finished = true;
      _finishDraft();
      return;
    }

    // Start new round
    state.currentPacks = state.packs[state.round];
    for (const bot of state.bots) {
      newPack(bot);
    }
  }

  callbacks.onStateChange?.(state);
}

function _passPacks(): void {
  if (!state) return;
  const packs = state.currentPacks;
  const direction = state.round % 2 === 0 ? 1 : -1;

  if (direction === 1) {
    // Pass left
    const last = packs[0];
    for (let i = 0; i < packs.length - 1; i++) {
      packs[i] = packs[i + 1];
    }
    packs[packs.length - 1] = last;
  } else {
    // Pass right
    const first = packs[packs.length - 1];
    for (let i = packs.length - 1; i > 0; i--) {
      packs[i] = packs[i - 1];
    }
    packs[0] = first;
  }
}

/**
 * Simulate the rest of the draft (bot picks for human too).
 * Used for "skip to game" feature.
 */
export function simulateRest(): void {
  if (!state || state.finished) return;

  // Create a temporary bot for the human player
  const humanBot = createBot(99);
  humanBot.pool = [...state.playerPool];

  // Sync bot state from existing picks
  state.playerPool.forEach(card => {
    const colors = card.colors?.length ? card.colors : card.color_identity || [];
    colors.forEach(c => {
      if (humanBot.colorCount[c] !== undefined) humanBot.colorCount[c]++;
    });
    const cost = card.mana_cost || '';
    const pips = cost.match(/\{([WUBRG])\}/gi) || [];
    pips.forEach(p => {
      const color = p.replace(/[{}]/g, '').toUpperCase();
      if (humanBot.colorPips[color] !== undefined) humanBot.colorPips[color]++;
    });
    const tl = card.type_line || '';
    if (tl.includes('Creature')) humanBot.creatureCount++;
    else if (!tl.includes('Land')) humanBot.spellCount++;
    const cmcSlot = Math.min(Math.max(Math.ceil(card.cmc || 0), 0), 6);
    humanBot.curveCounts[cmcSlot] = (humanBot.curveCounts[cmcSlot] || 0) + 1;
  });
  humanBot.pickCount = state.playerPool.length;
  humanBot.packNumber = state.round;

  while (!state.finished) {
    const playerPack = state.currentPacks[0];
    if (!playerPack || playerPack.length === 0) {
      state.round++;
      state.pick = 0;
      if (state.round >= ROUNDS) {
        state.finished = true;
        break;
      }
      state.currentPacks = state.packs[state.round];
      for (const bot of state.bots) {
        newPack(bot);
      }
      newPack(humanBot);
      continue;
    }

    // Human bot picks
    const picked = pickCard(humanBot, playerPack);
    if (picked) {
      state.playerPool.push(picked);
      state.currentPacks[0] = playerPack.filter(c => c.id !== picked.id);
    }

    // Other bots pick
    for (let i = 0; i < state.bots.length; i++) {
      const botPack = state.currentPacks[i + 1];
      if (botPack && botPack.length > 0) {
        const bPicked = pickCard(state.bots[i], botPack);
        if (bPicked) {
          state.currentPacks[i + 1] = botPack.filter(c => c.id !== bPicked.id);
        }
      }
    }

    _passPacks();
    state.pick++;

    const nextPack = state.currentPacks[0];
    if (!nextPack || nextPack.length === 0) {
      state.round++;
      state.pick = 0;
      if (state.round >= ROUNDS) {
        state.finished = true;
        break;
      }
      state.currentPacks = state.packs[state.round];
      for (const bot of state.bots) {
        newPack(bot);
      }
      newPack(humanBot);
    }
  }

  _finishDraft();
}

function _finishDraft(): void {
  if (!state) return;
  const botPools = state.bots.map(b => b.pool);
  callbacks.onDraftFinished?.(state.playerPool, botPools);
}

/**
 * Build a deck from the player's pool using the bot AI.
 */
export function autoBuildDeck(pool: Card[]): DeckBuildResult {
  return buildDeck(pool);
}

/**
 * Generate a Sealed pool: 6 booster packs combined (84 cards).
 * Returns the combined pool — caller goes straight to deck builder.
 */
export function generateSealedPool(cardPool: Card[]): Card[] {
  const SEALED_PACKS = 6;
  const pool: Card[] = [];
  for (let i = 0; i < SEALED_PACKS; i++) {
    pool.push(...generate(cardPool));
  }
  return pool;
}

/**
 * Generate 6 sealed booster packs separately (for reveal animation).
 * Returns an array of 6 packs, each pack is an array of cards.
 */
export function generateSealedPacks(cardPool: Card[]): Card[][] {
  const SEALED_PACKS = 6;
  const packs: Card[][] = [];
  for (let i = 0; i < SEALED_PACKS; i++) {
    packs.push(generate(cardPool));
  }
  return packs;
}

/**
 * Generate a sealed pool for the AI opponent (also 6 packs).
 */
export function generateSealedAIPool(cardPool: Card[]): Card[] {
  return generateSealedPool(cardPool);
}

/**
 * Get bot pools (for opponent deck building in game).
 */
export function getBotPools(): Card[][] {
  if (!state) return [];
  return state.bots.map(b => b.pool);
}
