import { io, type Socket } from 'socket.io-client';

// ── Server URL ────────────────────────────────────────────────────────────────
// In dev: localhost:3001. In prod: set VITE_SOCKET_SERVER_URL in .env
const SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:3001';

// ── Types ─────────────────────────────────────────────────────────────────────
export type MultiplayerRole = 'host' | 'guest' | null;

export interface RoomInfo {
  code: string;
  role: MultiplayerRole;
  opponentName: string | null;
}

export interface ChatMessage {
  text?: string;
  emote?: string;
  senderName: string;
  isHost: boolean;
  timestamp: number;
  isSelf?: boolean;
}

export type PlayerAction =
  | { type: 'nextPhase' }
  | { type: 'castSpell'; cardUid: string; targets?: any[] }
  | { type: 'tapLand'; cardUid: string }
  | { type: 'activateAbility'; cardUid: string; abilityIndex: number; targets?: any[] }
  | { type: 'declareAttacker'; cardUid: string }
  | { type: 'declareBlocker'; blockerUid: string; attackerUid: string }
  | { type: 'confirmBlockers' }
  | { type: string; [key: string]: any }; // catch-all for all other actions

// ── Singleton socket ──────────────────────────────────────────────────────────
let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io(SERVER_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
  }
  return _socket;
}

export function connectSocket(): Socket {
  const socket = getSocket();
  if (!socket.connected) socket.connect();
  return socket;
}

export function disconnectSocket() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

// ── Typed emit helpers ────────────────────────────────────────────────────────
export function createRoom(displayName: string) {
  getSocket().emit('create_room', { displayName });
}

export function joinRoom(code: string, displayName: string) {
  getSocket().emit('join_room', { code, displayName });
}

export function sendGameStateUpdate(snapshot: any) {
  getSocket().emit('game_state_update', JSON.stringify(snapshot));
}

export function sendPlayerAction(action: PlayerAction) {
  getSocket().emit('player_action', action);
}

export function sendChatMessage(text: string) {
  getSocket().emit('chat_message', { text });
}

export function sendEmote(emote: string) {
  getSocket().emit('chat_message', { emote });
}

export function sendStartGame(data: { hostDeck: any; guestDeck?: any }) {
  getSocket().emit('start_game', data);
}

export function requestResync() {
  getSocket().emit('request_resync');
}

export function sendDraftEvent(data: { type: string; [key: string]: any }) {
  getSocket().emit('draft_event', data);
}
