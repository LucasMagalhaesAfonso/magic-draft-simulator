// @ts-nocheck
// game-state-serializer.ts — Serialize game state for LLM consumption

import * as Cards from './cards';
import * as CardUtils from './card-utils';
import * as Mana from './mana';
import { getPlayableCards } from './game-state';

const CardEngine = { ...Cards, ...CardUtils };

export interface LlmActionMap {
  // index → card uid (or 'pass')
  mainActions: Array<{ uid: string | null; label: string; type: 'land' | 'spell' | 'pass' }>;
  attackers: Array<{ uid: string; label: string }>;
}

function formatCard(c: any): string {
  const tl = (c.type_line || '').toLowerCase();
  const isCreature = tl.includes('creature');
  const statsStr = isCreature
    ? ` [${CardEngine.getPower(c)}/${CardEngine.getToughness(c)}]`
    : '';
  const keywords: string[] = [];
  for (const kw of ['Flying', 'Trample', 'Deathtouch', 'Lifelink', 'First Strike', 'Double Strike', 'Vigilance', 'Haste', 'Menace', 'Reach']) {
    if (CardEngine.hasKeyword(c, kw)) keywords.push(kw);
  }
  const kwStr = keywords.length > 0 ? ` {${keywords.join(', ')}}` : '';
  const sick = c._summoningSick ? ' [summoning sick]' : '';
  const tapped = c._tapped ? ' [tapped]' : '';
  return `${c.name} (${c.mana_cost || 'land'})${statsStr}${kwStr}${sick}${tapped}`;
}

export function serializeStateForLlm(state: any, playerId: number): { prompt: string; actionMap: LlmActionMap } {
  const oppId = playerId === 0 ? 1 : 0;
  const me = state.players[playerId];
  const opp = state.players[oppId];

  // Mana
  const myBf = me.zones.battlefield;
  const untappedLands = myBf.cards.filter((c: any) => CardEngine.isLand(c) && !c._tapped).length;
  const poolMana = Mana.poolTotal(state.manaPool[playerId]);
  const totalMana = untappedLands + poolMana;

  // My creatures
  const myCreatures = myBf.cards.filter((c: any) => CardEngine.isCreature(c));
  // Opp creatures
  const oppBf = opp.zones.battlefield;
  const oppCreatures = oppBf.cards.filter((c: any) => CardEngine.isCreature(c));
  const oppUntappedLands = oppBf.cards.filter((c: any) => CardEngine.isLand(c) && !c._tapped).length;

  // Hand
  const hand = me.zones.hand.getAll();
  const handLands = hand.filter((c: any) => CardEngine.isLand(c));
  const handNonlands = hand.filter((c: any) => !CardEngine.isLand(c));

  // Legal plays
  const playable = getPlayableCards(state, playerId).filter((c: any) => !CardEngine.isLand(c));

  // Build action map
  const actionMap: LlmActionMap = { mainActions: [], attackers: [] };

  // Main phase actions
  actionMap.mainActions.push({ uid: null, label: 'Pass (skip remaining main phase)', type: 'pass' });
  if (handLands.length > 0 && !state.landPlayedThisTurn) {
    const bestLand = handLands[0];
    actionMap.mainActions.push({ uid: bestLand._uid, label: `Play land: ${bestLand.name}`, type: 'land' });
  }
  for (const card of playable) {
    actionMap.mainActions.push({ uid: card._uid, label: `Cast: ${formatCard(card)}`, type: 'spell' });
  }

  // Attackers (creatures that can attack)
  const attackCandidates = myBf.cards.filter((c: any) => CardEngine.canAttack(c));
  for (const c of attackCandidates) {
    actionMap.attackers.push({ uid: c._uid, label: formatCard(c) });
  }

  // GY
  const myGY = me.zones.graveyard.getAll().slice(-3).reverse(); // last 3

  // Build prompt
  const prompt = `You are playing a game of Magic: The Gathering. You are Player ${playerId + 1} (the AI opponent). Make optimal strategic decisions.

=== GAME STATE ===
Turn: ${state.turn} | Phase: ${state.phase}
Your life total: ${me.life} | Opponent life total: ${opp.life}
Mana available: ${totalMana} total (${untappedLands} untapped lands${poolMana > 0 ? ` + ${poolMana} in pool` : ''})
Land drop available this turn: ${!state.landPlayedThisTurn ? 'YES' : 'NO'}

=== YOUR HAND (${hand.length} cards) ===
${hand.length === 0 ? '(empty)' : hand.map((c: any, i: number) => `  [H${i}] ${formatCard(c)}`).join('\n')}

=== YOUR BATTLEFIELD ===
Lands: ${myBf.cards.filter((c: any) => CardEngine.isLand(c)).length} (${untappedLands} untapped)
Creatures (${myCreatures.length}):
${myCreatures.length === 0 ? '  (none)' : myCreatures.map((c: any) => `  - ${formatCard(c)}`).join('\n')}
Other permanents:
${myBf.cards.filter((c: any) => !CardEngine.isLand(c) && !CardEngine.isCreature(c)).map((c: any) => `  - ${formatCard(c)}`).join('\n') || '  (none)'}

=== OPPONENT'S BATTLEFIELD ===
Lands: ${oppBf.cards.filter((c: any) => CardEngine.isLand(c)).length} (${oppUntappedLands} untapped — watch for instant-speed responses)
Creatures (${oppCreatures.length}):
${oppCreatures.length === 0 ? '  (none)' : oppCreatures.map((c: any) => `  - ${formatCard(c)}`).join('\n')}
Other permanents:
${oppBf.cards.filter((c: any) => !CardEngine.isLand(c) && !CardEngine.isCreature(c)).map((c: any) => `  - ${formatCard(c)}`).join('\n') || '  (none)'}

=== YOUR GRAVEYARD (recent) ===
${myGY.length === 0 ? '(empty)' : myGY.map((c: any) => `  - ${c.name}`).join('\n')}

=== LEGAL MAIN PHASE ACTIONS ===
${actionMap.mainActions.map((a, i) => `  [${i}] ${a.label}`).join('\n')}

=== CREATURES AVAILABLE TO ATTACK (after main phase) ===
${actionMap.attackers.length === 0 ? '  (no creatures can attack)' : actionMap.attackers.map((a, i) => `  [${i}] ${a.label}`).join('\n')}

=== INSTRUCTIONS ===
Decide:
1. Which main phase actions to take (ordered list of indices from LEGAL MAIN PHASE ACTIONS). Consider: tempo, board state, mana curve, combat math, holding instants for combat tricks. You can include multiple actions — they execute in order. End with [0] (pass) to explicitly signal you are done, or omit it (implicit pass).
2. Which creatures to attack with (list of indices from CREATURES AVAILABLE TO ATTACK, or empty array for no attack). Consider: racing, blocking, leaving blockers, evasion, combat math.

Respond with ONLY valid JSON, no markdown, no explanation outside the JSON:
{
  "main_action_indices": [1, 3],
  "attacker_indices": [0, 2],
  "reasoning": "one sentence max"
}`;

  return { prompt, actionMap };
}
