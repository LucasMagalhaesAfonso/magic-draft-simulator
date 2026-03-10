/**
 * useGameEngineMultiplayer
 *
 * Host mode: wraps useGameEngine normally. After every action, broadcasts
 *            the game snapshot to the guest via WebSocket.
 *
 * Guest mode: does NOT run the engine locally. Instead:
 *   - Receives game snapshots from host, sets them as the local snap state.
 *   - All actions are forwarded to the host as player_action events.
 *   - The guest's perspective is swapped in the snapshot (players[0] = guest).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  getSocket, sendGameStateUpdate, sendPlayerAction, requestResync,
} from '../lib/multiplayerSocket';

// ── Host hook ─────────────────────────────────────────────────────────────────
export function useMultiplayerHost(baseActions: any, snap: any, gsRef: any, enabled: boolean) {
  const { setMpConnected } = useAppStore();
  const lastSentRef = useRef<string>('');

  // Broadcast snapshot to guest after every snap change
  useEffect(() => {
    if (!enabled || !snap) return;
    const guestSnap = flipSnapshotForGuest(snap);
    const serialized = JSON.stringify(guestSnap);
    if (serialized === lastSentRef.current) return; // no change
    lastSentRef.current = serialized;
    sendGameStateUpdate(guestSnap);
  }, [snap, enabled]);

  // Listen for guest actions and dispatch them on the engine
  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    socket.on('player_action', (action: any) => {
      console.log('[MP Host] Received guest action:', action.type);
      dispatchGuestAction(action, baseActions);
    });

    socket.on('resync_requested', () => {
      console.log('[MP Host] Guest requested resync');
      if (snap) sendGameStateUpdate(flipSnapshotForGuest(snap));
    });

    socket.on('opponent_disconnected', () => {
      setMpConnected(false);
    });

    socket.on('opponent_joined', () => {
      setMpConnected(true);
      if (snap) sendGameStateUpdate(flipSnapshotForGuest(snap));
    });

    return () => {
      socket.off('player_action');
      socket.off('resync_requested');
      socket.off('opponent_disconnected');
      socket.off('opponent_joined');
    };
  }, [baseActions, snap, enabled]);
}

// ── Guest hook ────────────────────────────────────────────────────────────────
export function useMultiplayerGuest(enabled: boolean) {
  const { setMpConnected } = useAppStore();
  const [snap, setSnap] = useState<any>(null);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    socket.on('connect', () => {
      setMpConnected(true);
      requestResync();
    });

    socket.on('disconnect', () => {
      setMpConnected(false);
    });

    socket.on('game_state_update', (data: any) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        // Re-hydrate Set fields
        if (parsed.humanPlayableUids && Array.isArray(parsed.humanPlayableUids)) {
          parsed.humanPlayableUids = new Set(parsed.humanPlayableUids);
        }
        setSnap(parsed);
      } catch (e) {
        console.warn('[MP Guest] Failed to parse game_state_update:', e);
      }
    });

    socket.on('opponent_disconnected', () => {
      setMpConnected(false);
    });

    // Request current state on mount
    requestResync();

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('game_state_update');
      socket.off('opponent_disconnected');
    };
  }, [enabled]);

  // Guest actions: forward all to host as player_action events
  const actions = enabled ? buildGuestActions() : null;

  return { snap: enabled ? snap : null, actions };
}

// ── Snapshot perspective flip ─────────────────────────────────────────────────
// Engine always runs host = players[0]. Before sending to guest, swap players.
function flipSnapshotForGuest(snap: any): any {
  if (!snap || !snap.players || snap.players.length < 2) return snap;

  const flipped = { ...snap };

  // Swap players array
  flipped.players = [
    sanitizePlayerForOpponent(snap.players[1]), // guest sees themselves as [0]
    sanitizePlayerForOpponent(snap.players[0]), // host becomes opponent [1]
  ];

  // Flip activePlayer index
  flipped.activePlayer = snap.activePlayer === 0 ? 1 : 0;

  // Flip waitingForInput.playerId
  if (snap.waitingForInput?.playerId !== undefined) {
    flipped.waitingForInput = {
      ...snap.waitingForInput,
      playerId: snap.waitingForInput.playerId === 0 ? 1 : 0,
    };
  }

  // Flip manaPool
  if (snap.manaPool && Array.isArray(snap.manaPool)) {
    flipped.manaPool = [snap.manaPool[1], snap.manaPool[0]];
  }

  // Flip combat: swap attacker/blocker player indices in attackers/blockers
  if (snap.combat) {
    flipped.combat = flipCombatForGuest(snap.combat);
  }

  // Flip log entries that reference "You"/"Opponent" — leave as-is (cosmetic only)

  // Serialize Sets as arrays for JSON transport
  if (snap.humanPlayableUids instanceof Set) {
    // Flip UIDs: the guest's playable cards are from their perspective
    flipped.humanPlayableUids = Array.from(snap.humanPlayableUids as Set<string>);
  }

  return flipped;
}

function sanitizePlayerForOpponent(player: any): any {
  if (!player) return player;
  // Deep clone to avoid mutating original
  return {
    ...player,
    zones: {
      ...player.zones,
      // Hide library cards (only expose count)
      library: player.zones?.library
        ? { ...player.zones.library, _cards: [] }
        : player.zones?.library,
    },
  };
}

function flipCombatForGuest(combat: any): any {
  if (!combat) return combat;
  const flip = (idx: number) => idx === 0 ? 1 : 0;
  return {
    ...combat,
    attackers: (combat.attackers || []).map((a: any) => ({
      ...a,
      controllerId: a.controllerId !== undefined ? flip(a.controllerId) : a.controllerId,
    })),
    blockers: (combat.blockers || []).map((b: any) => ({
      ...b,
      controllerId: b.controllerId !== undefined ? flip(b.controllerId) : b.controllerId,
    })),
  };
}

// ── Guest action proxy ────────────────────────────────────────────────────────
// All GameActions methods are forwarded to host as { type, ...params }
function buildGuestActions(): any {
  return new Proxy({}, {
    get(_target, prop: string) {
      return (...args: any[]) => {
        const action = buildActionPayload(prop, args);
        console.log('[MP Guest] Sending action:', action.type);
        sendPlayerAction(action);
      };
    },
  });
}

function buildActionPayload(type: string, args: any[]): any {
  // Map known action signatures to typed payloads
  switch (type) {
    case 'nextPhase':        return { type };
    case 'tapLand':          return { type, cardUid: args[0] };
    case 'castSpell':        return { type, cardUid: args[0], targets: args[1] };
    case 'activateAbility':  return { type, cardUid: args[0], abilityIndex: args[1], targets: args[2] };
    case 'declareAttacker':  return { type, cardUid: args[0] };
    case 'confirmAttackers': return { type };
    case 'declareBlocker':   return { type, blockerUid: args[0], attackerUid: args[1] };
    case 'confirmBlockers':  return { type };
    case 'resolveScry':      return { type, choices: args[0] };
    case 'resolveDiscard':   return { type, uids: args[0] };
    case 'resolveModal':     return { type, modeIndices: args[0] };
    case 'resolveManaColor': return { type, color: args[0] };
    case 'resolveTargetChoiceSingle': return { type, uid: args[0] };
    case 'resolveChooseTarget':       return { type, targets: args[0] };
    default:                 return { type, args };
  }
}

// ── Host: dispatch guest action onto engine ───────────────────────────────────
function dispatchGuestAction(action: any, actions: any) {
  if (!actions) return;

  // Guest's player index in the flipped snap = 0, but engine uses 1 for guest.
  // The action types map directly to engine actions — the engine handles player[1].
  // For cardUids, they remain the same (UIDs don't change with perspective flip).

  try {
    switch (action.type) {
      case 'nextPhase':        actions.nextPhase?.(); break;
      case 'tapLand':          actions.tapLand?.(action.cardUid); break;
      case 'castSpell':        actions.castSpell?.(action.cardUid, action.targets); break;
      case 'activateAbility':  actions.activateAbility?.(action.cardUid, action.abilityIndex, action.targets); break;
      case 'declareAttacker':  actions.declareAttacker?.(action.cardUid); break;
      case 'confirmAttackers': actions.confirmAttackers?.(); break;
      case 'declareBlocker':   actions.declareBlocker?.(action.blockerUid, action.attackerUid); break;
      case 'confirmBlockers':  actions.confirmBlockers?.(); break;
      case 'resolveScry':      actions.resolveScry?.(action.choices); break;
      case 'resolveDiscard':   actions.resolveDiscard?.(action.uids); break;
      case 'resolveModal':     actions.resolveModal?.(action.modeIndices); break;
      case 'resolveManaColor': actions.resolveManaColor?.(action.color); break;
      case 'resolveTargetChoiceSingle': actions.resolveTargetChoiceSingle?.(action.uid); break;
      case 'resolveChooseTarget':       actions.resolveChooseTarget?.(action.targets); break;
      default:
        // Generic: try calling the action by name with args array
        if (typeof actions[action.type] === 'function') {
          actions[action.type](...(action.args || []));
        } else {
          console.warn('[MP Host] Unknown guest action:', action.type);
        }
    }
  } catch (e) {
    console.warn('[MP Host] Error dispatching guest action:', action.type, e);
  }
}
