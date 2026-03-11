import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { logoutUser } from '../../lib/firebase';
import {
  connectSocket, disconnectSocket, createRoom, joinRoom, sendStartGame, sendDraftEvent,
} from '../../lib/multiplayerSocket';
import './LobbyScreen.css';

const AVAILABLE_SETS = [
  { code: 'tdm', name: 'Tarkir Dragonstorm (TDM)' },
  { code: 'ltr', name: 'Lord of the Rings (LTR)' },
];

interface SeatSlot {
  displayName: string;
  seatIndex: number;
  isBot: boolean;
}

function buildSeats(humanPlayers: { displayName: string; seatIndex: number }[]): SeatSlot[] {
  const seats: SeatSlot[] = [];
  const occupied = new Map(humanPlayers.map(p => [p.seatIndex, p.displayName]));
  for (let i = 0; i < 8; i++) {
    if (occupied.has(i)) {
      seats.push({ seatIndex: i, displayName: occupied.get(i)!, isBot: false });
    } else {
      seats.push({ seatIndex: i, displayName: 'Bot', isBot: true });
    }
  }
  return seats;
}

export function LobbyScreen() {
  const {
    currentUser, setCurrentUser, setScreen,
    mpRole, mpRoomCode,
    setMpRoom, setMpConnected, clearMp,
    mySeatIndex, setMySeatIndex,
    setPodPlayers,
    draftSetCode, setDraftSetCode,
    deck, onlineDeck, setOnlineDeck,
  } = useAppStore();

  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [phase, setPhase] = useState<'idle' | 'lobby'>('idle');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [humanPlayers, setHumanPlayers] = useState<{ displayName: string; seatIndex: number }[]>([]);
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null);

  const seats = buildSeats(humanPlayers);
  const isHost = mpRole === 'host';

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

    // Host: room was created for us
    socket.on('room_created', ({ code, seatIndex }: { code: string; seatIndex: number }) => {
      setMpRoom('host', code);
      setMySeatIndex(seatIndex);
      const myName = currentUser?.displayName || 'Host';
      setHumanPlayers([{ displayName: myName, seatIndex: 0 }]);
      setPhase('lobby');
      setError('');
    });

    // Guest: we joined successfully
    socket.on('room_joined', ({ code, seatIndex, players }: {
      code: string;
      seatIndex: number;
      players: { displayName: string; seatIndex: number }[];
    }) => {
      setMpRoom('guest', code);
      setMySeatIndex(seatIndex);
      setHumanPlayers(players);
      setMpConnected(true);
      setPhase('lobby');
      setError('');
    });

    socket.on('join_error', ({ message }: { message: string }) => {
      setError(message);
    });

    // Any player joined or left
    socket.on('room_updated', ({ players }: { players: { displayName: string; seatIndex: number }[] }) => {
      setHumanPlayers(players);
      setMpConnected(players.length >= 2);
    });

    // Game started (for existing 1v1 mode)
    socket.on('game_started', (data: any) => {
      if (!data.isHost) {
        if (data.guestDeck) setOnlineDeck(data.guestDeck);
      }
      setScreen('online_game');
    });

    socket.on('opponent_disconnected', () => {
      setMpConnected(false);
    });

    socket.on('host_disconnected', () => {
      setError('Host desconectou.');
      setPhase('idle');
      clearMp();
      setMySeatIndex(null);
    });

    // Draft start signal from host
    socket.on('draft_event', (data: any) => {
      if (data.type === 'draft_start_signal') {
        // Update set code and pod players for guest
        if (data.setCode) setDraftSetCode(data.setCode);
        if (data.podPlayers) setPodPlayers(data.podPlayers);
        setScreen('online_draft');
      }
    });

    setConnecting(true);
    if (!socket.connected) socket.connect();

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('disconnect');
      socket.off('room_created');
      socket.off('room_joined');
      socket.off('join_error');
      socket.off('room_updated');
      socket.off('game_started');
      socket.off('opponent_disconnected');
      socket.off('host_disconnected');
      socket.off('draft_event');
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

  function handleStartDraft() {
    // Build pod players list (bots fill empty seats)
    const podPlayers = seats.map(s => ({
      displayName: s.displayName,
      seatIndex: s.seatIndex,
      isBot: s.isBot,
    }));
    setPodPlayers(podPlayers);
    setDraftSetCode(draftSetCode);
    // Signal all players to navigate to online_draft
    sendDraftEvent({ type: 'draft_start_signal', setCode: draftSetCode, podPlayers });
    // Host navigates immediately (they also receive the event from server broadcast)
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
    setMySeatIndex(null);
    disconnectSocket();
    setScreen('home');
  }

  function handleBack() {
    clearMp();
    setMySeatIndex(null);
    setHumanPlayers([]);
    setPhase('idle');
    setError('');
  }

  function handleCopyCode() {
    if (mpRoomCode) {
      navigator.clipboard.writeText(mpRoomCode).catch(() => {});
    }
  }

  const myName = currentUser?.displayName || 'Jogador';

  return (
    <div className="lobby-screen">
      <div className="lobby-header">
        <h2 className="lobby-title">Jogar Online</h2>
        <div className="lobby-user-info">
          <span className="lobby-username">{myName}</span>
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

      {/* ── Idle: create or join ───────────────────────────────────────── */}
      {phase === 'idle' && (
        <div className="lobby-body glass">
          <div className="lobby-tabs">
            <button className={`lobby-tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>
              Criar Pod
            </button>
            <button className={`lobby-tab ${tab === 'join' ? 'active' : ''}`} onClick={() => setTab('join')}>
              Entrar em Pod
            </button>
          </div>

          {tab === 'create' && (
            <div className="lobby-panel">
              <p className="lobby-hint">Crie um pod de 8 jogadores. Assentos vazios serão preenchidos por bots.</p>
              <button className="btn btn-gold lobby-action-btn" onClick={handleCreateRoom} disabled={!socketConnected}>
                Criar Pod
              </button>
            </div>
          )}

          {tab === 'join' && (
            <div className="lobby-panel">
              <p className="lobby-hint">Digite o código do pod do seu amigo.</p>
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

      {/* ── Lobby: 8-seat pod view ─────────────────────────────────────── */}
      {phase === 'lobby' && (
        <div className="lobby-body glass pod-lobby-body">
          {/* Room code */}
          <div className="pod-code-row">
            <span className="pod-code-label">Código da Sala:</span>
            <span className="lobby-room-code pod-room-code">{mpRoomCode}</span>
            <button className="btn btn-muted btn-sm" onClick={handleCopyCode}>Copiar</button>
          </div>

          {/* Set selector — host only */}
          {isHost && (
            <div className="pod-set-row">
              <label className="pod-set-label">Set do Draft:</label>
              <select
                className="pod-set-select"
                value={draftSetCode}
                onChange={e => setDraftSetCode(e.target.value)}
              >
                {AVAILABLE_SETS.map(s => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          {!isHost && (
            <div className="pod-set-row">
              <span className="pod-set-label">Aguardando host iniciar o draft...</span>
            </div>
          )}

          {/* 8-seat oval table */}
          <div className="pod-seats-container">
            <div className="pod-table-oval">
              <span className="pod-table-label">Mesa de Draft</span>
            </div>
            <div className="pod-seats-grid">
              {seats.map(seat => {
                const isMe = seat.seatIndex === mySeatIndex && !seat.isBot;
                const isHostSeat = seat.seatIndex === 0;
                return (
                  <div
                    key={seat.seatIndex}
                    className={`pod-seat ${seat.isBot ? 'bot' : 'human'} ${isMe ? 'me' : ''}`}
                  >
                    <div className="pod-seat-number">#{seat.seatIndex + 1}</div>
                    <div className="pod-seat-icon">{seat.isBot ? '' : ''}</div>
                    <div className="pod-seat-name">{seat.displayName}</div>
                    {isMe && <div className="pod-seat-badge me-badge">Você</div>}
                    {isHostSeat && !seat.isBot && !isMe && <div className="pod-seat-badge host-badge">Host</div>}
                    {seat.isBot && <div className="pod-seat-badge bot-badge">Bot</div>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pod-player-count">
            {humanPlayers.length} / 8 jogadores humanos &bull; {8 - humanPlayers.length} bots
          </div>

          {/* Host controls */}
          {isHost && (
            <div className="pod-host-controls">
              <button
                className="btn btn-gold lobby-start-btn"
                onClick={handleStartDraft}
                style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}
              >
                Iniciar Draft
              </button>
              <button
                className="btn btn-gold lobby-start-btn"
                onClick={handleStartGame}
                disabled={humanPlayers.length < 2 || (!onlineDeck && !deck)}
                title="Jogar partida 1v1 com deck pronto"
              >
                Jogar 1v1 (deck pronto)
              </button>
            </div>
          )}

          <button className="btn btn-muted lobby-leave-btn" onClick={handleBack}>
            Sair do Pod
          </button>
        </div>
      )}

      <button className="lobby-back-home" onClick={() => setScreen('home')}>
        Voltar ao Menu Principal
      </button>
    </div>
  );
}
