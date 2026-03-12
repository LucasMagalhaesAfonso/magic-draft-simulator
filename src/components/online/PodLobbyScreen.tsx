import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getSocket, sendDraftEvent, sendStartGame } from '../../lib/multiplayerSocket';
import { buildDeck } from '../../draft/bot-ai';
import type { Card, DeckList } from '../../lib/types';
import type { PodPickEntry } from '../../store/useAppStore';
import './PodLobbyScreen.css';

const COLOR_BG: Record<string, string> = {
  W: '#f5f0d8',
  U: '#3a8bc0',
  B: '#4a3560',
  R: '#c83030',
  G: '#2e7d32',
};

function getColorIdentity(picks: Card[]): string[] {
  const seen = new Set<string>();
  for (const c of picks) {
    const colors = Array.isArray(c.color_identity) ? c.color_identity : [];
    for (const col of colors) seen.add(col);
  }
  return Array.from(seen);
}

function makeDeckFromPicks(picks: Card[]): DeckList {
  const result = buildDeck(picks);
  // Convert DeckBuildResult to DeckList
  const lands: Record<string, number> = {};
  for (const [name, count] of Object.entries(result.lands)) {
    lands[name] = count;
  }
  return { mainboard: result.deck, sideboard: result.sideboard, lands };
}

interface ChallengeState {
  type: 'sent' | 'received';
  fromSeat: number;
  toSeat: number;
  fromName: string;
}

export function PodLobbyScreen() {
  const {
    podPicks,
    mySeatIndex,
    mpRole,
    setScreen,
    setOnlineDeck,
    setMpRoom,
    setMpConnected,
    deck,
    setDeck,
    currentUser,
    setOnlineDraftPicks,
    setDraftPool,
    setDeckbuilderReturn,
  } = useAppStore();

  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
  const isHost = mpRole === 'host';
  const myName = currentUser?.displayName || 'Jogador';

  useEffect(() => {
    const socket = getSocket();

    function handleDraftEvent(data: any) {
      if (data.type === 'challenge') {
        if ((data.toSeat as number) === mySeatIndex) {
          setChallenge({ type: 'received', fromSeat: data.fromSeat, toSeat: data.toSeat, fromName: data.fromName });
        }
      }

      if (data.type === 'challenge_accept') {
        // Both challenged players navigate to online game
        const isInvolved = data.fromSeat === mySeatIndex || data.toSeat === mySeatIndex;
        if (!isInvolved) return;

        // Use pre-built deck if available, otherwise auto-build from picks
        const myEntry = podPicks?.find(p => p.seatIndex === mySeatIndex);
        const myDeckList = deck ?? (myEntry ? makeDeckFromPicks(myEntry.picks) : null);
        if (myDeckList) setOnlineDeck(myDeckList);

        const amChallenger = data.fromSeat === mySeatIndex;
        if (amChallenger) {
          sendStartGame({ hostDeck: myDeckList });
          setMpRoom('host', null);
          setScreen('online_game');
        } else {
          setMpRoom('guest', null);
          setMpConnected(true);
          setScreen('online_game');
        }
        setChallenge(null);
      }

      if (data.type === 'challenge_declined') {
        if (data.toSeat === mySeatIndex || data.fromSeat === mySeatIndex) {
          setChallenge(null);
        }
      }
    }

    socket.on('draft_event', handleDraftEvent);
    socket.on('game_started', (data: any) => {
      if (!data.isHost && data.guestDeck) setOnlineDeck(data.guestDeck);
      setScreen('online_game');
    });

    return () => {
      socket.off('draft_event', handleDraftEvent);
      socket.off('game_started');
    };
  }, [mySeatIndex, podPicks]);

  function handleChallenge(toEntry: PodPickEntry) {
    setChallenge({ type: 'sent', fromSeat: mySeatIndex!, toSeat: toEntry.seatIndex, fromName: myName });
    sendDraftEvent({
      type: 'challenge',
      fromSeat: mySeatIndex,
      toSeat: toEntry.seatIndex,
      fromName: myName,
    });
  }

  function handleAcceptChallenge() {
    if (!challenge || challenge.type !== 'received') return;
    sendDraftEvent({
      type: 'challenge_accept',
      fromSeat: challenge.fromSeat,
      toSeat: challenge.toSeat,
    });
    setChallenge(null);
  }

  function handleDeclineChallenge() {
    if (!challenge || challenge.type !== 'received') return;
    sendDraftEvent({
      type: 'challenge_declined',
      fromSeat: challenge.fromSeat,
      toSeat: challenge.toSeat,
    });
    setChallenge(null);
  }

  function handlePlayVsBot(entry: PodPickEntry) {
    // Build bot deck from their picks
    const botDeckList = makeDeckFromPicks(entry.picks);
    // Set AI deck (use aiDraftPool via setDeck as opponent)
    // The game engine uses deck for human and aiDeck for AI
    // For solo vs bot we need human deck (my picks) and AI deck (bot picks)
    const myEntry = podPicks?.find(p => p.seatIndex === mySeatIndex);
    if (myEntry) {
      const myDeckList = makeDeckFromPicks(myEntry.picks);
      setOnlineDraftPicks(myEntry.picks);
      setDeck(myDeckList);
    }
    // Store bot deck as onlineDeck so GameScreen can use it for AI
    setOnlineDeck(botDeckList);
    setScreen('game');
  }

  function handleGoToMenu() {
    setScreen('home');
  }

  function handleBuildMyDeck() {
    const myEntry = podPicks?.find(p => p.seatIndex === mySeatIndex);
    if (myEntry) {
      setDraftPool(myEntry.picks);         // draftPool is what DeckBuilderScreen shows
      setOnlineDraftPicks(myEntry.picks);  // keep for compatibility
      setDeckbuilderReturn('pod_lobby');   // "Jogar Online" returns here after building
      setScreen('deckbuilder');
    }
  }

  const entries = podPicks ?? [];

  return (
    <div className="pod-lobby-screen">
      {/* Challenge received popup */}
      {challenge?.type === 'received' && (
        <div className="pod-challenge-overlay">
          <div className="pod-challenge-popup glass">
            <div className="pod-challenge-title">Desafio Recebido!</div>
            <div className="pod-challenge-from">{challenge.fromName} te desafiou!</div>
            <div className="pod-challenge-buttons">
              <button className="btn btn-gold" onClick={handleAcceptChallenge}>Aceitar</button>
              <button className="btn btn-muted" onClick={handleDeclineChallenge}>Recusar</button>
            </div>
          </div>
        </div>
      )}

      {/* Challenge sent status */}
      {challenge?.type === 'sent' && (
        <div className="pod-challenge-sent">
          Desafio enviado para {entries.find(e => e.seatIndex === challenge.toSeat)?.displayName}...
          <button className="btn btn-muted btn-sm" onClick={() => setChallenge(null)}>Cancelar</button>
        </div>
      )}

      <div className="pod-lobby-header">
        <h2 className="pod-lobby-title">Pod Draft Concluido</h2>
        <div className="pod-lobby-header-actions">
          <button className="btn btn-gold btn-sm" onClick={handleBuildMyDeck}>
            Construir Meu Deck
          </button>
          <button className="btn btn-muted btn-sm" onClick={handleGoToMenu}>
            Voltar ao Menu
          </button>
        </div>
      </div>

      <p className="pod-lobby-subtitle">
        Draft finalizado! Desafie jogadores do pod ou jogue contra bots.
      </p>

      <div className="pod-lobby-grid">
        {entries.map(entry => {
          const isMe = entry.seatIndex === mySeatIndex && !entry.isBot;
          const colors = getColorIdentity(entry.picks);
          return (
            <div key={entry.seatIndex} className={`pod-player-card glass ${isMe ? 'me' : ''} ${entry.isBot ? 'bot' : ''}`}>
              <div className="pod-player-card-top">
                <div className="pod-player-card-seat">#{entry.seatIndex + 1}</div>
                <div className="pod-player-card-icon">{entry.isBot ? '' : ''}</div>
                {isMe && <div className="pod-player-card-badge me">Você</div>}
                {entry.isBot && <div className="pod-player-card-badge bot">Bot</div>}
              </div>
              <div className="pod-player-card-name">{entry.displayName}</div>
              <div className="pod-player-card-count">{entry.picks.length} cartas</div>
              <div className="pod-player-card-colors">
                {colors.map(c => (
                  <span key={c} className="pod-color-dot" style={{ background: COLOR_BG[c] ?? '#888' }} title={c} />
                ))}
                {colors.length === 0 && <span className="pod-no-color">—</span>}
              </div>
              <div className="pod-player-card-actions">
                {entry.isBot && (
                  <button
                    className="btn btn-gold btn-sm pod-player-btn"
                    onClick={() => handlePlayVsBot(entry)}
                  >
                    Jogar vs Bot
                  </button>
                )}
                {!entry.isBot && !isMe && (
                  <button
                    className="btn btn-gold btn-sm pod-player-btn"
                    onClick={() => handleChallenge(entry)}
                    disabled={challenge !== null}
                  >
                    Desafiar
                  </button>
                )}
                {isMe && (
                  <button
                    className="btn btn-muted btn-sm pod-player-btn"
                    onClick={handleBuildMyDeck}
                  >
                    Ver Picks
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
