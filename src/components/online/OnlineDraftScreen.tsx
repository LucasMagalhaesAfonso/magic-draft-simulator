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
// Generates a single pack: 1 rare/mythic + 3 uncommons + 11 commons (15 cards).
// Draws independently each time (with replacement across packs), like real paper.
function generatePack(cards: Card[]): Card[] {
  const commons    = cards.filter(c => c.rarity === 'common');
  const uncommons  = cards.filter(c => c.rarity === 'uncommon');
  const rares      = cards.filter(c => c.rarity === 'rare');
  const mythics    = cards.filter(c => c.rarity === 'mythic');
  const rarePool   = [...rares, ...mythics]; // ~1/8 chance mythic in real packs

  const pick = (pool: Card[], n: number): Card[] => {
    if (pool.length === 0) return [];
    const s = shuffle(pool);
    const result: Card[] = [];
    const used = new Set<string>();
    for (const c of s) {
      if (result.length >= n) break;
      if (!used.has(c.name)) { result.push(c); used.add(c.name); }
    }
    // fill remainder if not enough unique names
    while (result.length < n && result.length < pool.length) {
      const c = s[result.length];
      if (c && !result.includes(c)) result.push(c);
      else break;
    }
    return result;
  };

  const rare    = pick(rarePool, 1);
  const uncommon = pick(uncommons, 3);
  const common  = pick(commons, 11);
  return [...rare, ...uncommon, ...common];
}

function generateAllPacks(cards: Card[]): Card[][][] {
  const allPacks: Card[][][] = [];
  for (let round = 0; round < 3; round++) {
    const roundPacks: Card[][] = [];
    for (let seat = 0; seat < 8; seat++) {
      roundPacks.push(generatePack(cards));
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
  const packQueueRef = useRef<Record<number, Card[][]>>({}); // seat → queue of packs waiting to be picked
  const allPicksBySeatRef = useRef<Record<number, Card[]>>({}); // seat → picks array
  const picksInRoundBySeatRef = useRef<Record<number, number>>({}); // seat → picks made this round
  const currentRoundRef = useRef(0);
  const humanSeatsRef = useRef<number[]>([]);
  const botSeatsRef = useRef<number[]>([]);
  const initDoneRef = useRef(false);
  const myRemainingPackRef = useRef<Card[]>([]); // after picking, wait for new_pack
  // Exposed so socket listener can call it too
  const drainBotQueuesRef = useRef<(startSeats: number[]) => void>(() => {});

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

      currentRoundRef.current = 0;

      // Helper: bot picks from its queued pack and passes remaining to next seat
      function drainBotQueues(startSeats: number[]) {
        const toProcess = [...startSeats];
        const visited = new Set<string>();
        while (toProcess.length > 0) {
          const seat = toProcess.shift()!;
          if (!botSeats.includes(seat)) continue;
          const queue = packQueueRef.current[seat] ?? [];
          if (queue.length === 0) continue;
          const pack = queue[0];
          if (!pack || pack.length === 0) { packQueueRef.current[seat] = queue.slice(1); continue; }
          const pick = botPick(pack);
          const remaining = pack.filter(c => c.id !== pick.id);
          packQueueRef.current[seat] = queue.slice(1);
          allPicksBySeatRef.current[seat] = [...(allPicksBySeatRef.current[seat] ?? []), pick];
          picksInRoundBySeatRef.current[seat] = (picksInRoundBySeatRef.current[seat] ?? 0) + 1;
          sendDraftEvent({ type: 'bot_picked', seatIndex: seat, cardName: pick.name });
          if (remaining.length > 0) {
            const dir = currentRoundRef.current % 2 === 0 ? 1 : -1;
            const nextSeat = (seat + dir + 8) % 8;
            packQueueRef.current[nextSeat] = [...(packQueueRef.current[nextSeat] ?? []), remaining];
            const key = `${nextSeat}-${packQueueRef.current[nextSeat].length}`;
            if (botSeats.includes(nextSeat) && !visited.has(key)) { visited.add(key); toProcess.push(nextSeat); }
          }
          if ((packQueueRef.current[seat] ?? []).length > 0) toProcess.push(seat);
        }
      }

      // Expose drainBotQueues for socket listener
      drainBotQueuesRef.current = drainBotQueues;

      // Initialize per-seat pick counters and pack queues
      for (let i = 0; i < 8; i++) {
        packQueueRef.current[i] = [allPacks[0][i].slice()];
        picksInRoundBySeatRef.current[i] = 0;
      }

      // Bot seats: pick immediately and pass packs
      drainBotQueues(botSeats);

      // Send round_start to everyone
      sendDraftEvent({
        type: 'round_start',
        round: 0,
        pickInRound: 0,
        packsForSeats: humanSeats.map(s => ({
          seatIndex: s,
          pack: packQueueRef.current[s][0] ?? [],
        })),
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
        const myEntry = (data.packsForSeats as { seatIndex: number; pack: Card[] }[])
          .find(p => p.seatIndex === mySeatIndex);
        if (!myEntry) return; // this pack delivery is for another seat
        const myPack = myEntry.pack;
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
        const humanSeats = humanSeatsRef.current;
        const botSeats = botSeatsRef.current;
        const round = currentRoundRef.current;

        // Pop the front pack from this seat's queue
        const queue = packQueueRef.current[seatIdx] ?? [];
        const pack = queue[0] ?? [];
        const remaining = cardId === '__empty__' ? [] : pack.filter(c => c.id !== cardId);
        packQueueRef.current[seatIdx] = queue.slice(1);

        // Record pick
        if (cardId !== '__empty__') {
          const picked = pack.find(c => c.id === cardId);
          if (picked) allPicksBySeatRef.current[seatIdx].push(picked);
        }
        picksInRoundBySeatRef.current[seatIdx] = (picksInRoundBySeatRef.current[seatIdx] ?? 0) + 1;

        sendDraftEvent({ type: 'pick_confirmed', seatIndex: seatIdx, cardName });

        // Pass remaining pack to next seat immediately
        if (remaining.length > 0) {
          const dir = round % 2 === 0 ? 1 : -1;
          const nextSeat = (seatIdx + dir + 8) % 8;
          const nextQueue = packQueueRef.current[nextSeat] ?? [];
          const nextWasEmpty = nextQueue.length === 0;
          packQueueRef.current[nextSeat] = [...nextQueue, remaining];
          if (botSeats.includes(nextSeat)) {
            drainBotQueuesRef.current([nextSeat]);
          } else if (nextWasEmpty) {
            // Human had no pack — send immediately
            sendDraftEvent({
              type: 'new_pack',
              round,
              pickInRound: picksInRoundBySeatRef.current[nextSeat] ?? 0,
              packsForSeats: [{ seatIndex: nextSeat, pack: packQueueRef.current[nextSeat][0] }],
            });
          }
        }

        // If this human seat has more packs queued, send the next one now
        if (packQueueRef.current[seatIdx].length > 0) {
          sendDraftEvent({
            type: 'new_pack',
            round,
            pickInRound: picksInRoundBySeatRef.current[seatIdx] ?? 0,
            packsForSeats: [{ seatIndex: seatIdx, pack: packQueueRef.current[seatIdx][0] }],
          });
        }

        // Check if all seats completed PICKS_PER_ROUND picks
        const allDone = [...humanSeats, ...botSeats].every(
          s => (picksInRoundBySeatRef.current[s] ?? 0) >= PICKS_PER_ROUND
        );
        if (allDone) {
          const nextRound = round + 1;
          if (nextRound >= TOTAL_ROUNDS) {
            sendDraftEvent({ type: 'draft_complete', allPicks: allPicksBySeatRef.current, podPlayers });
          } else {
            sendDraftEvent({ type: 'round_transition', round: nextRound });
            currentRoundRef.current = nextRound;
            for (let i = 0; i < 8; i++) {
              packQueueRef.current[i] = [allPacksRef.current[nextRound][i].slice()];
              picksInRoundBySeatRef.current[i] = 0;
            }
            drainBotQueuesRef.current(botSeats);
            sendDraftEvent({
              type: 'round_start',
              round: nextRound,
              pickInRound: 0,
              packsForSeats: humanSeats.map(s => ({ seatIndex: s, pack: packQueueRef.current[s][0] ?? [] })),
              podPlayers,
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
    // If pack is empty (shouldn't happen), skip to waiting
    if (state.currentPack.length === 0) {
      setState(s => ({ ...s, phase: 'waiting_others' }));
      sendDraftEvent({ type: 'pick', seatIndex: mySeatIndex, cardId: '__empty__', cardName: '' });
      return;
    }
    if (state.timer <= 0) {
      const card = autoPick(state.currentPack, state.myPicks, state.selectedCard);
      if (card) handlePick(card);
      return;
    }
    const t = setInterval(() => {
      setState(s => ({ ...s, timer: s.timer - 1 }));
    }, 1000);
    return () => clearInterval(t);
  }, [state.phase, state.timer, state.currentPack.length]);

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
    return (
      <div key={seat.seatIndex} className={`od-seat-row ${hasPicked ? 'picked' : ''} ${isMe ? 'me' : ''}`}>
        <span className="od-seat-num">#{seat.seatIndex + 1}</span>
        <span className="od-seat-name">{seat.displayName}</span>
        {seat.isBot && <span className="od-seat-tag bot">Bot</span>}
        {isMe && <span className="od-seat-tag me">Você</span>}
        {hasPicked
          ? <span className="od-seat-status done">✓ Pickado</span>
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
