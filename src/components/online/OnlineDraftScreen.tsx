import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getCardsBySet } from '../../lib/database';
import { getSocket, sendDraftEvent } from '../../lib/multiplayerSocket';
import type { Card } from '../../lib/types';
import './OnlineDraftScreen.css';

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

// ── Bot pick logic ────────────────────────────────────────────────────────────
function botPick(pack: Card[]): Card {
  const order: Card['rarity'][] = ['mythic', 'rare', 'uncommon', 'common'];
  for (const r of order) {
    const c = pack.filter(x => x.rarity === r);
    if (c.length) return c[Math.floor(Math.random() * c.length)];
  }
  return pack[0];
}

// ── Shuffle ───────────────────────────────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Pack generation ───────────────────────────────────────────────────────────
function generateAllPacks(cards: Card[]): Card[][][] {
  const allPacks: Card[][][] = [];
  const usedIds = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const roundPacks: Card[][] = [];
    for (let seat = 0; seat < 8; seat++) {
      const available = cards.filter(c => !usedIds.has(c.id));
      const shuffled = shuffle(available);
      const pack = shuffled.slice(0, 15);
      pack.forEach(c => usedIds.add(c.id));
      roundPacks.push(pack);
    }
    allPacks.push(roundPacks);
  }
  return allPacks;
}

// ── Rarity color ─────────────────────────────────────────────────────────────
function rarityColor(rarity: string): string {
  switch (rarity) {
    case 'mythic': return '#e05c10';
    case 'rare': return '#b8862c';
    case 'uncommon': return '#8fa3ad';
    default: return '#aaa';
  }
}

// ── Color identity dots ───────────────────────────────────────────────────────
const COLOR_LABELS: Record<string, string> = { W: '#f5f0d8', U: '#3a8bc0', B: '#4a3560', R: '#c83030', G: '#2e7d32' };

type DraftPhase = 'initializing' | 'picking' | 'waiting_others' | 'round_transition' | 'done';

interface SeatInfo {
  seatIndex: number;
  displayName: string;
  isBot: boolean;
}

interface DraftState {
  phase: DraftPhase;
  round: number;
  pickInRound: number;
  currentPack: Card[];
  selectedCard: Card | null;
  myPicks: Card[];
  timer: number;
  seatsPicked: Set<number>;
  seatsInRoom: SeatInfo[];
  lastPickBySeat: Record<number, string>;
}

const PICKS_PER_ROUND = 15;
const TOTAL_ROUNDS = 3;

// ── Component ─────────────────────────────────────────────────────────────────
export function OnlineDraftScreen() {
  const {
    mpRole,
    mySeatIndex,
    podPlayers,
    draftSetCode,
    setScreen,
    setOnlineDraftPicks,
    setPodPicks,
    currentUser,
  } = useAppStore();

  const isHost = mpRole === 'host';
  const myName = currentUser?.displayName || 'Jogador';

  const [state, setState] = useState<DraftState>({
    phase: 'initializing',
    round: 0,
    pickInRound: 0,
    currentPack: [],
    selectedCard: null,
    myPicks: [],
    timer: getPickTimer(0),
    seatsPicked: new Set(),
    seatsInRoom: [],
    lastPickBySeat: {},
  });

  // Host-only refs (large data, not state)
  const allPacksRef = useRef<Card[][][]>([]); // [round][seat][card]
  const currentRoundPacksRef = useRef<Card[][]>([]); // remaining cards per seat this round
  const allPicksBySeatRef = useRef<Record<number, Card[]>>({}); // seat → picks array
  const pickedThisTurnRef = useRef<Set<number>>(new Set());
  const currentRoundRef = useRef(0);
  const currentPickInRoundRef = useRef(0);
  const humanSeatsRef = useRef<number[]>([]);
  const botSeatsRef = useRef<number[]>([]);
  const initDoneRef = useRef(false);
  const myRemainingPackRef = useRef<Card[]>([]); // after picking, wait for new_pack

  // ── Host initializes draft ────────────────────────────────────────────────
  useEffect(() => {
    if (!isHost || initDoneRef.current) return;
    initDoneRef.current = true;

    async function init() {
      const cards = await getCardsBySet(draftSetCode);
      if (!cards || cards.length < 120) {
        console.error('[OnlineDraft] Not enough cards for draft:', cards?.length);
        return;
      }

      const allPacks = generateAllPacks(cards);
      allPacksRef.current = allPacks;

      // Initialize picks storage
      const picks: Record<number, Card[]> = {};
      for (let i = 0; i < 8; i++) picks[i] = [];
      allPicksBySeatRef.current = picks;

      // Determine human vs bot seats from podPlayers
      const humanSeats = podPlayers.filter(p => !p.isBot).map(p => p.seatIndex);
      const botSeats = podPlayers.filter(p => p.isBot).map(p => p.seatIndex);
      humanSeatsRef.current = humanSeats;
      botSeatsRef.current = botSeats;

      // Init current round packs for round 0
      currentRoundPacksRef.current = allPacks[0].map(pack => [...pack]);
      currentRoundRef.current = 0;
      currentPickInRoundRef.current = 0;
      pickedThisTurnRef.current = new Set();

      // Auto-pick for bots in round 0
      for (const botSeat of botSeats) {
        const pack = currentRoundPacksRef.current[botSeat];
        const pick = botPick(pack);
        currentRoundPacksRef.current[botSeat] = pack.filter(c => c.id !== pick.id);
        allPicksBySeatRef.current[botSeat].push(pick);
        sendDraftEvent({ type: 'bot_picked', seatIndex: botSeat, cardName: pick.name });
      }

      // Send round_start to everyone (server broadcasts to all including host)
      sendDraftEvent({
        type: 'round_start',
        round: 0,
        pickInRound: 0,
        packsForSeats: humanSeats.map(s => ({ seatIndex: s, pack: allPacks[0][s] })),
        podPlayers: podPlayers,
      });
    }

    init();
  }, [isHost]);

  // ── Socket listener for draft events ─────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    function handleDraftEvent(data: any) {
      if (data.type === 'round_start') {
        const myPack = (data.packsForSeats as { seatIndex: number; pack: Card[] }[])
          .find(p => p.seatIndex === mySeatIndex)?.pack ?? [];
        myRemainingPackRef.current = myPack;
        setState(s => ({
          ...s,
          phase: 'picking',
          round: data.round,
          pickInRound: data.pickInRound ?? 0,
          currentPack: myPack,
          selectedCard: null,
          timer: getPickTimer(data.pickInRound ?? 0),
          seatsPicked: new Set(),
          seatsInRoom: data.podPlayers ?? s.seatsInRoom,
          lastPickBySeat: {},
        }));
      }

      if (data.type === 'new_pack') {
        const myPack = (data.packsForSeats as { seatIndex: number; pack: Card[] }[])
          .find(p => p.seatIndex === mySeatIndex)?.pack ?? [];
        myRemainingPackRef.current = myPack;
        setState(s => ({
          ...s,
          phase: 'picking',
          pickInRound: data.pickInRound ?? s.pickInRound,
          currentPack: myPack,
          selectedCard: null,
          timer: getPickTimer(data.pickInRound ?? s.pickInRound),
          seatsPicked: new Set(),
        }));
      }

      if (data.type === 'pick_confirmed') {
        setState(s => {
          const next = new Set(s.seatsPicked);
          next.add(data.seatIndex as number);
          const nextLast = { ...s.lastPickBySeat, [data.seatIndex]: data.cardName };
          return { ...s, seatsPicked: next, lastPickBySeat: nextLast };
        });
      }

      if (data.type === 'bot_picked') {
        setState(s => ({
          ...s,
          lastPickBySeat: { ...s.lastPickBySeat, [data.seatIndex]: data.cardName },
        }));
      }

      if (data.type === 'round_transition') {
        setState(s => ({ ...s, phase: 'round_transition', round: data.round }));
      }

      if (data.type === 'draft_complete') {
        const allPicks = data.allPicks as Record<number, Card[]>;
        // Store pod picks
        const podPicksResult = (data.podPlayers as SeatInfo[]).map(p => ({
          seatIndex: p.seatIndex,
          displayName: p.displayName,
          isBot: p.isBot,
          picks: allPicks[p.seatIndex] ?? [],
        }));
        setPodPicks(podPicksResult);
        // My picks
        const myPicks = allPicks[mySeatIndex!] ?? [];
        setOnlineDraftPicks(myPicks);
        setState(s => ({ ...s, phase: 'done', myPicks }));
        setScreen('pod_lobby');
      }

      // Host processes incoming human picks
      if (isHost && data.type === 'pick') {
        const seatIdx = data.seatIndex as number;
        const cardId = data.cardId as string;
        const cardName = data.cardName as string;

        // Remove from that seat's remaining pack
        currentRoundPacksRef.current[seatIdx] = currentRoundPacksRef.current[seatIdx].filter(c => c.id !== cardId);
        // Find card object and store pick
        const picked = allPacksRef.current.flat().flat().find(c => c.id === cardId);
        if (picked) allPicksBySeatRef.current[seatIdx].push(picked);

        pickedThisTurnRef.current.add(seatIdx);

        // Broadcast pick_confirmed so all can see who picked
        sendDraftEvent({ type: 'pick_confirmed', seatIndex: seatIdx, cardName });

        // Check if all human seats have picked
        const humanSeats = humanSeatsRef.current;
        const allHumansPicked = humanSeats.every(s => pickedThisTurnRef.current.has(s));
        if (allHumansPicked) {
          currentPickInRoundRef.current++;
          if (currentPickInRoundRef.current >= PICKS_PER_ROUND) {
            // End of round
            const nextRound = currentRoundRef.current + 1;
            if (nextRound >= TOTAL_ROUNDS) {
              // Draft complete
              const podPlayersSnap = podPlayers;
              sendDraftEvent({
                type: 'draft_complete',
                allPicks: allPicksBySeatRef.current,
                podPlayers: podPlayersSnap,
              });
            } else {
              sendDraftEvent({ type: 'round_transition', round: nextRound });
              currentRoundRef.current = nextRound;
              currentPickInRoundRef.current = 0;
              pickedThisTurnRef.current = new Set();
              // Start new round
              const newRoundPacks = allPacksRef.current[nextRound].map(pack => [...pack]);
              currentRoundPacksRef.current = newRoundPacks;
              // Bot picks for new round
              for (const botSeat of botSeatsRef.current) {
                const pack = currentRoundPacksRef.current[botSeat];
                const pick = botPick(pack);
                currentRoundPacksRef.current[botSeat] = pack.filter(c => c.id !== pick.id);
                allPicksBySeatRef.current[botSeat].push(pick);
                sendDraftEvent({ type: 'bot_picked', seatIndex: botSeat, cardName: pick.name });
              }
              sendDraftEvent({
                type: 'round_start',
                round: nextRound,
                pickInRound: 0,
                packsForSeats: humanSeats.map(s => ({ seatIndex: s, pack: currentRoundPacksRef.current[s] })),
                podPlayers: podPlayers,
              });
            }
          } else {
            // Rotate packs
            const direction = currentRoundRef.current % 2 === 0 ? 'left' : 'right';
            const newPacks: Card[][] = new Array(8);
            for (let i = 0; i < 8; i++) {
              if (direction === 'left') {
                newPacks[i] = currentRoundPacksRef.current[(i - 1 + 8) % 8];
              } else {
                newPacks[i] = currentRoundPacksRef.current[(i + 1) % 8];
              }
            }
            currentRoundPacksRef.current = newPacks;

            // Bot picks on new packs
            for (const botSeat of botSeatsRef.current) {
              const pack = currentRoundPacksRef.current[botSeat];
              if (!pack || pack.length === 0) continue;
              const pick = botPick(pack);
              currentRoundPacksRef.current[botSeat] = pack.filter(c => c.id !== pick.id);
              allPicksBySeatRef.current[botSeat].push(pick);
              sendDraftEvent({ type: 'bot_picked', seatIndex: botSeat, cardName: pick.name });
            }

            pickedThisTurnRef.current = new Set();
            sendDraftEvent({
              type: 'new_pack',
              round: currentRoundRef.current,
              pickInRound: currentPickInRoundRef.current,
              packsForSeats: humanSeats.map(s => ({ seatIndex: s, pack: currentRoundPacksRef.current[s] })),
            });
          }
        }
      }
    }

    socket.on('draft_event', handleDraftEvent);
    return () => { socket.off('draft_event', handleDraftEvent); };
  }, [isHost, mySeatIndex, podPlayers]);

  // ── Timer countdown ───────────────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== 'picking') return;
    if (state.timer <= 0) {
      const card = autoPick(state.currentPack, state.myPicks, state.selectedCard);
      if (card) handlePick(card);
      return;
    }
    const t = setInterval(() => {
      setState(s => ({ ...s, timer: s.timer - 1 }));
    }, 1000);
    return () => clearInterval(t);
  }, [state.phase, state.timer]);

  // ── Handle pick ───────────────────────────────────────────────────────────
  const handlePick = useCallback((card: Card) => {
    setState(s => {
      if (s.phase !== 'picking') return s;
      const remaining = s.currentPack.filter(c => c.id !== card.id);
      myRemainingPackRef.current = remaining;
      return {
        ...s,
        phase: 'waiting_others',
        currentPack: [],
        selectedCard: null,
        myPicks: [...s.myPicks, card],
      };
    });
    sendDraftEvent({
      type: 'pick',
      seatIndex: mySeatIndex,
      cardId: card.id,
      cardName: card.name,
    });
  }, [mySeatIndex]);

  function handleSelectCard(card: Card) {
    if (state.phase !== 'picking') return;
    setState(s => ({ ...s, selectedCard: s.selectedCard?.id === card.id ? null : card }));
  }

  function handleConfirmPick() {
    if (state.phase !== 'picking' || !state.selectedCard) return;
    handlePick(state.selectedCard);
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderSeatRow(seat: SeatInfo) {
    const hasPicked = state.seatsPicked.has(seat.seatIndex) || seat.isBot;
    const isMe = seat.seatIndex === mySeatIndex && !seat.isBot;
    const last = state.lastPickBySeat[seat.seatIndex];
    return (
      <div key={seat.seatIndex} className={`od-seat-row ${hasPicked ? 'picked' : ''} ${isMe ? 'me' : ''}`}>
        <span className="od-seat-num">#{seat.seatIndex + 1}</span>
        <span className="od-seat-name">{seat.displayName}</span>
        {seat.isBot && <span className="od-seat-tag bot">Bot</span>}
        {isMe && <span className="od-seat-tag me">Você</span>}
        {hasPicked
          ? <span className="od-seat-status done">Pickado {last ? `— ${last}` : ''}</span>
          : <span className="od-seat-status waiting">Aguardando...</span>
        }
      </div>
    );
  }

  const timerPct = (state.timer / getPickTimer(state.pickInRound)) * 100;
  const timerRed = state.timer <= 10;

  const passDirection = state.round % 2 === 0 ? 'ESQUERDA' : 'DIREITA';

  // ── Phase: initializing ───────────────────────────────────────────────────
  if (state.phase === 'initializing') {
    return (
      <div className="od-screen">
        <div className="od-loading">
          <div className="od-spinner" />
          <p>{isHost ? 'Gerando packs...' : 'Aguardando host iniciar...'}</p>
        </div>
      </div>
    );
  }

  // ── Phase: round_transition ───────────────────────────────────────────────
  if (state.phase === 'round_transition') {
    return (
      <div className="od-screen">
        <div className="od-loading">
          <div className="od-spinner" />
          <p>Round {state.round + 1} / {TOTAL_ROUNDS} — Preparando novos packs...</p>
        </div>
      </div>
    );
  }

  // ── Phase: done ───────────────────────────────────────────────────────────
  if (state.phase === 'done') {
    return (
      <div className="od-screen">
        <div className="od-loading">
          <p>Draft concluido! Redirecionando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="od-screen">
      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div className="od-header">
        <div className="od-header-info">
          <span className="od-round-label">Round {state.round + 1} / {TOTAL_ROUNDS}</span>
          <span className="od-pick-label">Pick {state.pickInRound + 1} / {PICKS_PER_ROUND}</span>
          <span className="od-pass-label">Passa: {passDirection}</span>
        </div>
        <div className="od-header-right">
          <span className="od-mypicks-count">{state.myPicks.length} picks</span>
        </div>
      </div>

      {/* ── Timer bar ──────────────────────────────────────────────────────── */}
      <div className="od-timer-bar-wrap">
        <div
          className={`od-timer-bar ${timerRed ? 'red' : ''}`}
          style={{ width: `${timerPct}%` }}
        />
        <span className={`od-timer-text ${timerRed ? 'red' : ''}`}>{state.timer}s</span>
      </div>

      <div className="od-body">
        {/* ── Left: Seat status ─────────────────────────────────────────────── */}
        <div className="od-left-panel">
          <div className="od-panel-title">Status do Pod</div>
          <div className="od-seats-list">
            {state.seatsInRoom.length > 0
              ? state.seatsInRoom.map(renderSeatRow)
              : Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="od-seat-row">
                  <span className="od-seat-num">#{i + 1}</span>
                  <span className="od-seat-name od-seat-placeholder">—</span>
                </div>
              ))
            }
          </div>
        </div>

        {/* ── Center: Current pack ───────────────────────────────────────────── */}
        <div className="od-center">
          {state.phase === 'picking' && (
            <>
              <div className="od-pack-grid">
                {state.currentPack.map(card => {
                  const selected = state.selectedCard?.id === card.id;
                  return (
                    <div
                      key={card.id}
                      className={`od-card ${selected ? 'selected' : ''}`}
                      onClick={() => handleSelectCard(card)}
                      onDoubleClick={() => handlePick(card)}
                      title={`${card.name}\n${card.oracle_text}`}
                    >
                      {card.image_normal
                        ? <img src={card.image_normal} alt={card.name} className="od-card-img" loading="lazy" />
                        : (
                          <div className="od-card-placeholder">
                            <div className="od-card-name">{card.name}</div>
                            <div className="od-card-cost">{card.mana_cost}</div>
                            <div className="od-card-type">{card.type_line}</div>
                          </div>
                        )
                      }
                      <div className="od-card-rarity-dot" style={{ background: rarityColor(card.rarity) }} />
                    </div>
                  );
                })}
              </div>
              <div className="od-pack-actions">
                {state.selectedCard && (
                  <div className="od-selected-name">{state.selectedCard.name}</div>
                )}
                <button
                  className="btn btn-gold od-confirm-btn"
                  onClick={handleConfirmPick}
                  disabled={!state.selectedCard}
                >
                  Confirmar Pick
                </button>
                <div className="od-hint">Clique duplo para picar diretamente</div>
              </div>
            </>
          )}

          {state.phase === 'waiting_others' && (
            <div className="od-waiting-pack">
              <div className="od-spinner" />
              <p>Aguardando outros jogadores picarem...</p>
              <p className="od-waiting-sub">
                {Array.from(state.seatsPicked).length} / {state.seatsInRoom.filter(s => !s.isBot).length} confirmados
              </p>
            </div>
          )}
        </div>

        {/* ── Right: My picks ───────────────────────────────────────────────── */}
        <div className="od-right-panel">
          <div className="od-panel-title">Meus Picks ({state.myPicks.length})</div>
          <div className="od-my-picks-list">
            {state.myPicks.map((card, idx) => (
              <div key={`${card.id}-${idx}`} className="od-pick-row">
                <span className="od-pick-rarity-dot" style={{ background: rarityColor(card.rarity) }} />
                <span className="od-pick-name">{card.name}</span>
                <span className="od-pick-colors">
                  {(Array.isArray(card.colors) ? card.colors : []).map(c => (
                    <span key={c} className="od-color-dot" style={{ background: COLOR_LABELS[c] ?? '#888' }} />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
