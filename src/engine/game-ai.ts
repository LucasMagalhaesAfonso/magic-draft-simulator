// @ts-nocheck
// game-ai.ts — Re-exports from game-ai-part1.ts and game-ai-part2.ts

export {
  playMainPhase,
  declareAttackers,
  _threatScore,
} from './game-ai-part1';

export {
  orderBlockers,
  declareBlockers,
  discard,
  _chooseTargets,
  _pickBestCardToExileFromHand,
  playInstantPhase,
  _cloneStateForSim,
  _findBestSpellOrder,
  _shouldUseCombatTrick,
} from './game-ai-part2';
