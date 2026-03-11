import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getCardsBySet } from '../../lib/database';
import { getSocket, sendDraftEvent } from '../../lib/multiplayerSocket';
import type { Card } from '../../lib/types';

// ── Timer formula ─────────────────────────────────────────────────────────────
function getPickTimer(pickInRound: number): number {
  return Math.max(20, 75 - pickInRound * 5);
}

// ── Auto-pick logic ───────────────────────────────────────────────────────────
function autoPick(pack: Card[], myPicks: Card[], selectedCard: Card | null): Card {
  if (selectedCard && pack.find(c => c.id === selectedCard.id)) return selectedCard;
  const colorScore: Record<string, number> = {};
  for (const c of myPicks) {
    const colors = Array.isArray(c.colors) ? c.colors : [];
    for (const col of colors) colorScore[col] = (colorScore[col] || 0) + 1;
  }
  const rarityBonus: Record<string, number> = { mythic: 5, rare: 3, uncommon: 1, common: 0 };
  return [...pack].sort((a, b) => {
    const scoreCard = (card: Card) => {
      const colors = Array.isArray(card.colors) ? card.colors : [];
      const fit = colors.reduce((s, c) => s + (colorScore[c] || 0), 0);
      return fit * 2 + (rarityBonus[card.rarity] || 0);
    };
    return scoreCard(b) - scoreCard(a);
  })[0];
}

// ── Shuffle utility ───────────────────────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Phase type ────────────────────────────────────────────────────────────────
type Phase = 'waiting' | 'picking' | 'waiting_pack' | 'done';

interface DraftState {
  phase: Phase;
  round: number;    // 0, 1, 2
  pick: number;     // 0-14 within round
  currentPack: Card[];
  selectedCard: Card | null;
  myPicks: Card[];
  opponentStatus: string;
  timer: number;
}

const PICKS_PER_ROUND = 15;
const TOTAL_ROUNDS = 3;

// ── Component ─────────────────────────────────────────────────────────────────
export function OnlineDraftScreen() {
  const { mpRole, selectedSet, setScreen, setDraftPool, setOnlineDraftPicks } = useAppStore();
  const isHost = mpRole === 'host';

  const [state, setState] = useState<DraftState>({
    phase: 'waiting',
    round: 0,
    pick: 0,
    currentPack: [],
    selectedCard: null,
    myPicks: [],
    opponentStatus: 'Aguardando...',
    timer: getPickTimer(0),
  });

  // Host pre-generates 6 packs: [round][player(0=host,1=guest)]
  // Each pack has 15 cards. Packs for same round swap between players after each pick.
  const hostPacks = useRef<Card[][][]>([]); // hostPacks[round] = [hostPack, guestPack]
  const myPackRef = useRef<Card[]>([]);     // current pack being drafted
  const pendingPackRef = useRef<Card[] | null>(null); // pack waiting from opponent after we pick

  // Track whether we've already started to avoid double-init
  const started = useRef(false);

  // ── Listen for draft events from opponent ─────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    function onDraftEvent(data: any) {
      const { type } = data;

      if (type === 'draft_start' && !isHost) {
        // Guest receives first pack
        myPackRef.current = data.pack;
        setState(prev => ({
          ...prev,
          phase: 'picking',
          round: data.round,
          pick: 0,
          currentPack: data.pack,
          timer: getPickTimer(0),
          opponentStatus: 'Oponente escolhendo...',
        }));
      }

      if (type === 'draft_round_start' && !isHost) {
        // Guest receives pack for new round
        myPackRef.current = data.pack;
        setState(prev => ({
          ...prev,
          phase: 'picking',
          round: data.round,
          pick: 0,
          currentPack: data.pack,
          timer: getPickTimer(0),
          opponentStatus: 'Oponente escolhendo...',
        }));
      }

      if (type === 'draft_pack') {
        // Receive a pack mid-round (after swap)
        myPackRef.current = data.pack;
        setState(prev => ({
          ...prev,
          phase: 'picking',
          currentPack: data.pack,
          selectedCard: null,
          timer: getPickTimer(data.pick),
          opponentStatus: 'Oponente escolhendo...',
        }));
      }

      if (type === 'draft_pick_pass') {
        // Opponent picked and is sending us their remaining pack
        // We use this as our next pack after we finish our current pick
        pendingPackRef.current = data.remainingPack;
        setState(prev => ({
          ...prev,
          opponentStatus: `Oponente escolheu${data.pickedCard ? ': ' + data.pickedCard.name : ''}`,
        }));
      }

      if (type === 'draft_complete') {
        setState(prev => ({ ...prev, phase: 'done', opponentStatus: 'Draft concluído!' }));
      }
    }

    socket.on('draft_event', onDraftEvent);
    return () => { socket.off('draft_event', onDraftEvent); };
  }, [isHost]);

  // ── Host initializes draft on mount ──────────────────────────────────────
  useEffect(() => {
    if (!isHost || started.current) return;
    started.current = true;

    async function initDraft() {
      const allCards = await getCardsBySet(selectedSet);
      if (allCards.length === 0) {
        console.error('[OnlineDraft] No cards found for set:', selectedSet);
        return;
      }

      // Generate 6 packs: 2 per round (one for each player)
      const packs: Card[][][] = [];
      const shuffled = shuffle(allCards);
      const pool = [...shuffled, ...shuffled, ...shuffled, ...shuffled]; // repeat to ensure enough cards

      for (let r = 0; r < TOTAL_ROUNDS; r++) {
        const hostPack = shuffle(allCards).slice(0, PICKS_PER_ROUND);
        const guestPack = shuffle(allCards).slice(0, PICKS_PER_ROUND);
        packs.push([hostPack, guestPack]);
      }
      hostPacks.current = packs;

      // Host keeps packs[0][0], sends packs[0][1] to guest
      const myFirstPack = packs[0][0];
      const guestFirstPack = packs[0][1];

      myPackRef.current = myFirstPack;

      sendDraftEvent({ type: 'draft_start', pack: guestFirstPack, round: 0 });

      setState(prev => ({
        ...prev,
        phase: 'picking',
        round: 0,
        pick: 0,
        currentPack: myFirstPack,
        timer: getPickTimer(0),
        opponentStatus: 'Oponente escolhendo...',
      }));
    }

    initDraft();
  }, [isHost, selectedSet]);

  // ── Handle pick ───────────────────────────────────────────────────────────
  const handlePick = useCallback((card: Card) => {
    setState(prev => {
      if (prev.phase !== 'picking') return prev;
      if (!prev.currentPack.find(c => c.id === card.id)) return prev;

      const remainingPack = prev.currentPack.filter(c => c.id !== card.id);
      const newPicks = [...prev.myPicks, card];
      const newPick = prev.pick + 1;
      const isLastPickInRound = newPick >= PICKS_PER_ROUND;
      const isLastRound = prev.round >= TOTAL_ROUNDS - 1;

      // Send our pick + remaining pack to opponent (they use it as their next pack)
      sendDraftEvent({
        type: 'draft_pick_pass',
        pickedCard: card,
        remainingPack,
        round: prev.round,
        pick: prev.pick,
      });

      if (isLastPickInRound) {
        if (isLastRound) {
          // Draft complete
          setOnlineDraftPicks(newPicks);
          setDraftPool(newPicks);
          if (isHost) sendDraftEvent({ type: 'draft_complete' });
          // Navigate after short delay
          setTimeout(() => setScreen('deckbuilder'), 1500);
          return {
            ...prev,
            phase: 'done',
            myPicks: newPicks,
            currentPack: [],
            selectedCard: null,
          };
        }

        // Start next round
        const nextRound = prev.round + 1;
        if (isHost) {
          const myNextPack = hostPacks.current[nextRound]?.[0] || [];
          const guestNextPack = hostPacks.current[nextRound]?.[1] || [];
          myPackRef.current = myNextPack;
          sendDraftEvent({ type: 'draft_round_start', pack: guestNextPack, round: nextRound });
          return {
            ...prev,
            phase: 'picking',
            round: nextRound,
            pick: 0,
            currentPack: myNextPack,
            selectedCard: null,
            myPicks: newPicks,
            timer: getPickTimer(0),
            opponentStatus: 'Oponente escolhendo...',
          };
        } else {
          // Guest: wait for host to send new round pack
          return {
            ...prev,
            phase: 'waiting_pack',
            pick: newPick,
            currentPack: [],
            selectedCard: null,
            myPicks: newPicks,
          };
        }
      }

      // Check if we have a pending pack from opponent
      const pending = pendingPackRef.current;
      if (pending) {
        pendingPackRef.current = null;
        myPackRef.current = pending;
        return {
          ...prev,
          phase: 'picking',
          pick: newPick,
          currentPack: pending,
          selectedCard: null,
          myPicks: newPicks,
          timer: getPickTimer(newPick),
          opponentStatus: 'Oponente escolhendo...',
        };
      }

      // Wait for opponent's pack
      return {
        ...prev,
        phase: 'waiting_pack',
        pick: newPick,
        currentPack: [],
        selectedCard: null,
        myPicks: newPicks,
      };
    });
  }, [isHost, setDraftPool, setOnlineDraftPicks, setScreen]);

  // ── Timer countdown ───────────────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== 'picking') return;
    if (state.timer <= 0) {
      const card = autoPick(state.currentPack, state.myPicks, state.selectedCard);
      if (card) handlePick(card);
      return;
    }
    const interval = setInterval(() => {
      setState(prev => ({ ...prev, timer: prev.timer - 1 }));
    }, 1000);
    return () => clearInterval(interval);
  }, [state.phase, state.timer, handlePick]);

  // ── When we receive a pending pack while in waiting_pack phase ────────────
  useEffect(() => {
    if (state.phase !== 'waiting_pack') return;
    const pending = pendingPackRef.current;
    if (!pending) return;
    pendingPackRef.current = null;
    setState(prev => ({
      ...prev,
      phase: 'picking',
      currentPack: pending,
      selectedCard: null,
      timer: getPickTimer(prev.pick),
      opponentStatus: 'Oponente escolhendo...',
    }));
  }, [state.phase, state.opponentStatus]); // re-check when opponent status changes (pick_pass event updates it)

  // ── Select card (single click) ────────────────────────────────────────────
  function handleSelect(card: Card) {
    if (state.phase !== 'picking') return;
    setState(prev => ({ ...prev, selectedCard: card }));
  }

  // ── Confirm pick ──────────────────────────────────────────────────────────
  function handleConfirm() {
    if (state.phase !== 'picking' || !state.selectedCard) return;
    handlePick(state.selectedCard);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const timerUrgent = state.timer <= 10;
  const progressPct = Math.min(100, (state.myPicks.length / (PICKS_PER_ROUND * TOTAL_ROUNDS)) * 100);

  return (
    <div style={styles.root}>
      {/* Header bar */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.roundLabel}>
            Rodada {state.round + 1}/{TOTAL_ROUNDS} — Pick {state.pick + 1}/{PICKS_PER_ROUND}
          </span>
          <span style={styles.picksCount}>{state.myPicks.length} cartas</span>
        </div>
        <div style={styles.headerCenter}>
          {state.phase === 'picking' && (
            <span style={{ ...styles.timer, ...(timerUrgent ? styles.timerUrgent : {}) }}>
              {state.timer}s
            </span>
          )}
          {state.phase === 'waiting_pack' && (
            <span style={styles.waitingLabel}>Aguardando pacote do oponente...</span>
          )}
          {state.phase === 'waiting' && (
            <span style={styles.waitingLabel}>Aguardando início do draft...</span>
          )}
          {state.phase === 'done' && (
            <span style={styles.doneLabel}>Draft concluído! Construindo deck...</span>
          )}
        </div>
        <div style={styles.headerRight}>
          <span style={styles.opponentStatus}>{state.opponentStatus}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={styles.progressBar}>
        <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
      </div>

      {/* Main content */}
      <div style={styles.body}>
        {/* Pack grid */}
        <div style={styles.packArea}>
          {state.phase === 'picking' && state.currentPack.length > 0 ? (
            <>
              <div style={styles.packGrid}>
                {state.currentPack.map(card => {
                  const isSelected = state.selectedCard?.id === card.id;
                  return (
                    <div
                      key={card.id}
                      style={{
                        ...styles.cardSlot,
                        ...(isSelected ? styles.cardSelected : {}),
                      }}
                      onClick={() => handleSelect(card)}
                      onDoubleClick={() => handlePick(card)}
                      title={card.name}
                    >
                      {card.image_normal || card.image_small ? (
                        <img
                          src={card.image_normal || card.image_small}
                          alt={card.name}
                          style={styles.cardImg}
                          draggable={false}
                        />
                      ) : (
                        <div style={styles.cardPlaceholder}>
                          <div style={styles.cardPlaceholderName}>{card.name}</div>
                          <div style={styles.cardPlaceholderType}>{card.type_line}</div>
                        </div>
                      )}
                      {isSelected && <div style={styles.selectedOverlay}>✓</div>}
                    </div>
                  );
                })}
              </div>
              {state.selectedCard && (
                <div style={styles.confirmRow}>
                  <span style={styles.selectedName}>{state.selectedCard.name}</span>
                  <button style={styles.confirmBtn} onClick={handleConfirm}>
                    Confirmar Pick
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={styles.emptyPack}>
              {state.phase === 'done'
                ? 'Draft encerrado! Redirecionando...'
                : state.phase === 'waiting'
                ? 'Aguardando início...'
                : 'Aguardando pacote...'}
            </div>
          )}
        </div>

        {/* Picks sidebar */}
        <div style={styles.sidebar}>
          <div style={styles.sidebarTitle}>Minhas picks ({state.myPicks.length})</div>
          <div style={styles.picksList}>
            {state.myPicks.map((card, i) => (
              <div key={`${card.id}-${i}`} style={styles.pickItem}>
                <span style={styles.pickNumber}>{i + 1}.</span>
                <span style={styles.pickName}>{card.name}</span>
                <span style={styles.pickRarity}>{card.rarity[0].toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg-primary, #1a1a2e)',
    color: 'var(--text-primary, #e0e0e0)',
    fontFamily: 'var(--font-primary, sans-serif)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    background: 'var(--bg-secondary, #16213e)',
    borderBottom: '1px solid var(--border, #333)',
    minHeight: 48,
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    maxWidth: 220,
    textAlign: 'right',
  },
  roundLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary, #e0e0e0)',
  },
  picksCount: {
    fontSize: 12,
    color: 'var(--text-muted, #888)',
  },
  timer: {
    fontSize: 28,
    fontWeight: 700,
    color: '#4ade80',
    minWidth: 64,
    textAlign: 'center',
    transition: 'color 0.3s',
  },
  timerUrgent: {
    color: '#ef4444',
    animation: 'pulse 0.5s ease-in-out infinite alternate',
  },
  waitingLabel: {
    fontSize: 14,
    color: 'var(--text-muted, #888)',
    fontStyle: 'italic',
  },
  doneLabel: {
    fontSize: 16,
    color: '#4ade80',
    fontWeight: 600,
  },
  opponentStatus: {
    fontSize: 12,
    color: 'var(--text-muted, #aaa)',
    wordBreak: 'break-word',
  },
  progressBar: {
    height: 4,
    background: 'var(--bg-tertiary, #0f3460)',
    flexShrink: 0,
  },
  progressFill: {
    height: '100%',
    background: 'var(--accent, #e94560)',
    transition: 'width 0.3s ease',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    gap: 0,
  },
  packArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    padding: '12px',
  },
  packGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
    gap: 8,
    overflowY: 'auto',
    flex: 1,
    paddingBottom: 8,
  },
  cardSlot: {
    position: 'relative',
    borderRadius: 8,
    cursor: 'pointer',
    border: '2px solid transparent',
    transition: 'border-color 0.15s, transform 0.1s',
    aspectRatio: '63/88',
    overflow: 'hidden',
    background: '#0d1117',
  },
  cardSelected: {
    borderColor: '#f59e0b',
    transform: 'scale(1.04)',
    boxShadow: '0 0 12px rgba(245, 158, 11, 0.6)',
  },
  cardImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    borderRadius: 6,
  },
  cardPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1c2035',
    padding: 8,
    textAlign: 'center',
  },
  cardPlaceholderName: {
    fontSize: 11,
    fontWeight: 600,
    color: '#e0e0e0',
    marginBottom: 4,
  },
  cardPlaceholderType: {
    fontSize: 9,
    color: '#888',
  },
  selectedOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    background: '#f59e0b',
    color: '#000',
    borderRadius: '50%',
    width: 20,
    height: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
  },
  confirmRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 0 0',
    flexShrink: 0,
  },
  selectedName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#f59e0b',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  confirmBtn: {
    background: 'var(--accent, #e94560)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '8px 20px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
  },
  emptyPack: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    color: 'var(--text-muted, #888)',
    fontStyle: 'italic',
  },
  sidebar: {
    width: 220,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-secondary, #16213e)',
    borderLeft: '1px solid var(--border, #333)',
    overflow: 'hidden',
  },
  sidebarTitle: {
    padding: '10px 12px',
    fontWeight: 700,
    fontSize: 13,
    color: 'var(--text-primary, #e0e0e0)',
    borderBottom: '1px solid var(--border, #333)',
    flexShrink: 0,
  },
  picksList: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 0',
  },
  pickItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    fontSize: 12,
    color: 'var(--text-primary, #ddd)',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  pickNumber: {
    color: 'var(--text-muted, #666)',
    minWidth: 22,
    fontSize: 11,
  },
  pickName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pickRarity: {
    fontSize: 10,
    fontWeight: 700,
    color: '#f59e0b',
    flexShrink: 0,
  },
};
