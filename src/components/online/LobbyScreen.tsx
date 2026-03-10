import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { logoutUser } from '../../lib/firebase';
import {
  connectSocket, disconnectSocket, createRoom, joinRoom, sendStartGame,
  type ChatMessage,
} from '../../lib/multiplayerSocket';
import type { DeckList } from '../../lib/types';
import './LobbyScreen.css';

type LobbyTab = 'create' | 'join';
type LobbyPhase = 'idle' | 'waiting' | 'ready';

export function LobbyScreen() {
  const {
    currentUser, setCurrentUser, setScreen,
    mpRole, mpRoomCode, mpOpponentName, mpConnected,
    setMpRoom, setMpConnected, clearMp,
    deck, onlineDeck, setOnlineDeck,
  } = useAppStore();

  const [tab, setTab] = useState<LobbyTab>('create');
  const [joinCode, setJoinCode] = useState('');
  const [phase, setPhase] = useState<LobbyPhase>('idle');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null);

  // Connect to socket server on mount
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      setConnecting(false);
      setError('');
    });

    socket.on('connect_error', () => {
      setSocketConnected(false);
      setError('Não foi possível conectar ao servidor. Tentando novamente...');
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
      setMpConnected(false);
    });

    // Room events
    socket.on('room_created', ({ code, role }: any) => {
      setMpRoom(role, code);
      setPhase('waiting');
      setError('');
    });

    socket.on('room_joined', ({ code, role, opponentName }: any) => {
      setMpRoom(role, code, opponentName);
      setMpConnected(true);
      setPhase('ready');
      setError('');
    });

    socket.on('join_error', ({ message }: any) => {
      setError(message);
    });

    socket.on('opponent_joined', ({ opponentName }: any) => {
      setMpRoom('host', mpRoomCode, opponentName);
      setMpConnected(true);
      setPhase('ready');
    });

    socket.on('game_started', (data: any) => {
      if (!data.isHost) {
        // Guest: receive deck info and go to game
        if (data.guestDeck) setOnlineDeck(data.guestDeck);
      }
      setScreen('online_game');
    });

    socket.on('opponent_disconnected', () => {
      setMpConnected(false);
      setPhase('waiting');
      setError('Oponente desconectou. Aguardando reconexão...');
    });

    // Trigger connection
    setConnecting(true);
    if (!socket.connected) socket.connect();

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('disconnect');
      socket.off('room_created');
      socket.off('room_joined');
      socket.off('join_error');
      socket.off('opponent_joined');
      socket.off('game_started');
      socket.off('opponent_disconnected');
    };
  }, []);

  function handleCreateRoom() {
    if (!socketConnected) { setError('Ainda conectando...'); return; }
    createRoom(currentUser?.displayName || 'Host');
  }

  function handleJoinRoom() {
    if (!socketConnected) { setError('Ainda conectando...'); return; }
    if (!joinCode.trim()) { setError('Digite o código da sala.'); return; }
    joinRoom(joinCode.trim().toUpperCase(), currentUser?.displayName || 'Guest');
  }

  function handleStartGame() {
    if (!onlineDeck && !deck) { setError('Selecione um deck para jogar.'); return; }
    const selectedDeck = onlineDeck || deck;
    sendStartGame({ hostDeck: selectedDeck });
    setScreen('online_game');
  }

  async function handleLogout() {
    await logoutUser();
    setCurrentUser(null);
    clearMp();
    disconnectSocket();
    setScreen('home');
  }

  function handleBack() {
    clearMp();
    setPhase('idle');
    setError('');
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="lobby-screen">
      <div className="lobby-header">
        <h2 className="lobby-title">⚔️ Jogar Online</h2>
        <div className="lobby-user-info">
          <span className="lobby-username">👤 {currentUser?.displayName}</span>
          <button className="btn btn-muted btn-sm" onClick={handleLogout}>Sair</button>
        </div>
      </div>

      <div className="lobby-status-bar">
        <span className={`lobby-connection-dot ${socketConnected ? 'connected' : 'disconnected'}`} />
        <span className="lobby-connection-label">
          {connecting && !socketConnected ? 'Conectando ao servidor...' : socketConnected ? 'Servidor online' : 'Servidor offline'}
        </span>
      </div>

      {error && <div className="lobby-error">{error}</div>}

      {/* ── Idle phase: tabs ─────────────────────────────────────────────── */}
      {phase === 'idle' && (
        <div className="lobby-body glass">
          <div className="lobby-tabs">
            <button className={`lobby-tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>
              Criar Sala
            </button>
            <button className={`lobby-tab ${tab === 'join' ? 'active' : ''}`} onClick={() => setTab('join')}>
              Entrar em Sala
            </button>
          </div>

          {tab === 'create' && (
            <div className="lobby-panel">
              <p className="lobby-hint">Crie uma sala e compartilhe o código com seu amigo.</p>
              <button className="btn btn-gold lobby-action-btn" onClick={handleCreateRoom} disabled={!socketConnected}>
                🎲 Criar Sala
              </button>
            </div>
          )}

          {tab === 'join' && (
            <div className="lobby-panel">
              <p className="lobby-hint">Digite o código da sala do seu amigo.</p>
              <div className="lobby-code-input-row">
                <input
                  type="text"
                  className="lobby-code-input"
                  placeholder="ABCDEF"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={6}
                />
                <button className="btn btn-gold" onClick={handleJoinRoom} disabled={!socketConnected}>
                  Entrar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Waiting phase: show code ─────────────────────────────────────── */}
      {phase === 'waiting' && mpRole === 'host' && (
        <div className="lobby-body glass">
          <p className="lobby-hint">Compartilhe este código com seu amigo:</p>
          <div className="lobby-room-code">{mpRoomCode}</div>
          <p className="lobby-waiting-label">⏳ Aguardando oponente...</p>
          <button className="btn btn-muted" onClick={handleBack}>Cancelar</button>
        </div>
      )}

      {/* ── Ready phase: both connected ──────────────────────────────────── */}
      {phase === 'ready' && (
        <div className="lobby-body glass">
          <div className="lobby-players">
            <div className="lobby-player-slot filled">
              <span className="lobby-player-icon">👤</span>
              <span>{currentUser?.displayName}</span>
              <span className="lobby-player-you">(você)</span>
            </div>
            <div className="lobby-vs">VS</div>
            <div className="lobby-player-slot filled">
              <span className="lobby-player-icon">👤</span>
              <span>{mpOpponentName || 'Oponente'}</span>
              {mpConnected
                ? <span className="lobby-player-connected">● online</span>
                : <span className="lobby-player-disconnected">● reconectando...</span>
              }
            </div>
          </div>

          <div className="lobby-deck-select">
            <p className="lobby-hint">Deck selecionado:</p>
            {onlineDeck || deck
              ? <div className="lobby-deck-name">🃏 {`${(onlineDeck || deck)?.mainboard?.length ?? 0} cartas`}</div>
              : <div className="lobby-no-deck">Nenhum deck — faça um draft primeiro</div>
            }
          </div>

          {mpRole === 'host' && (
            <>
              {!mpConnected && (
                <p className="lobby-waiting-label">⏳ Aguardando oponente humano entrar na sala...</p>
              )}
              <button
                className="btn btn-gold lobby-start-btn"
                onClick={handleStartGame}
                disabled={!mpConnected || (!onlineDeck && !deck)}
              >
                🚀 Iniciar Partida
              </button>
            </>
          )}
          {mpRole === 'guest' && (
            <p className="lobby-waiting-label">⏳ Aguardando host iniciar...</p>
          )}

          <button className="btn btn-muted lobby-leave-btn" onClick={handleBack}>
            Sair da Sala
          </button>
        </div>
      )}

      <button className="lobby-back-home" onClick={() => setScreen('home')}>
        ← Voltar ao Menu Principal
      </button>
    </div>
  );
}
