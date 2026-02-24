import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getCardsBySet } from '../lib/database';
import * as DraftEngine from '../draft/draft-engine';
import { buildDeck, recordHumanPick } from '../draft/bot-ai';
import { CardImage } from './card/CardImage';
import type { Card } from '../lib/types';
import './DraftScreen.css';

// ── Helpers ──────────────────────────────────────────────────────────

type PoolTab = 'all' | 'creatures' | 'spells';

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C'];
const COLOR_LABELS: Record<string, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolor', C: 'Colorless',
};

function rarityClass(rarity: string): string {
  const r = (rarity || '').toLowerCase();
  if (r === 'mythic') return 'rarity-mythic';
  if (r === 'rare') return 'rarity-rare';
  if (r === 'uncommon') return 'rarity-uncommon';
  return 'rarity-common';
}

function getCardColor(card: Card): string {
  const colors = card.colors || card.color_identity || [];
  if (colors.length === 0) return 'C';
  if (colors.length > 1) return 'M';
  return colors[0];
}

function groupByColor(cards: Card[]): Record<string, Card[]> {
  const groups: Record<string, Card[]> = {};
  for (const color of COLOR_ORDER) groups[color] = [];
  for (const card of cards) {
    const color = getCardColor(card);
    if (!groups[color]) groups[color] = [];
    groups[color].push(card);
  }
  return groups;
}

// ── Main Component ────────────────────────────────────────────────────

export function DraftScreen() {
  const { selectedSet, setDraftPool, setAiDraftPool, setDeck, setScreen } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftState, setDraftState] = useState<DraftEngine.DraftState | null>(null);
  const [currentPack, setCurrentPack] = useState<Card[]>([]);
  const [poolTab, setPoolTab] = useState<PoolTab>('all');
  const [tooltip, setTooltip] = useState<{ card: Card; x: number; y: number } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    initDraft();
    return () => {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    };
  }, []);

  async function initDraft() {
    try {
      setLoading(true);
      const cards = await getCardsBySet(selectedSet);
      if (cards.length < 14) {
        setError(
          `Set "${selectedSet.toUpperCase()}" has only ${cards.length} cards. Need at least 14.`
        );
        return;
      }

      DraftEngine.setCallbacks({
        onStateChange: (state) => {
          setDraftState({ ...state });
          setCurrentPack(DraftEngine.getPlayerPack());
        },
        onDraftFinished: (pool, botPools) => {
          setDraftState(prev =>
            prev ? { ...prev, finished: true, playerPool: pool } : null
          );
          if (botPools && botPools.length > 0) setAiDraftPool(botPools[0]);
          setCurrentPack([]);
        },
      });

      const state = DraftEngine.start(cards);
      setDraftState({ ...state });
      setCurrentPack(DraftEngine.getPlayerPack());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start draft');
    } finally {
      setLoading(false);
    }
  }

  function handleSelectCard(card: Card) {
    if (!draftState || draftState.finished) return;
    DraftEngine.selectCard(card.id);
  }

  function handlePickCard(card: Card) {
    if (!draftState || draftState.finished) return;
    // Record the pick for human learning before the pack is consumed
    recordHumanPick(card, currentPack);
    DraftEngine.selectCard(card.id);
    DraftEngine.confirmPick();
  }

  function handleSkipToGame() {
    DraftEngine.simulateRest();
    const state = DraftEngine.getState();
    if (!state) return;
    const result = buildDeck(state.playerPool);
    setDraftPool(state.playerPool);
    // Save first bot's pool so GameScreen can build a non-mirror AI deck
    if (state.bots && state.bots.length > 0) setAiDraftPool(state.bots[0].pool || []);
    setDeck({ mainboard: result.deck, sideboard: result.sideboard, lands: result.lands });
    setScreen('deckbuilder');
  }

  function handleBuildDeck() {
    const state = DraftEngine.getState();
    if (!state) return;
    const result = buildDeck(state.playerPool);
    setDraftPool(state.playerPool);
    // Save first bot's pool so GameScreen can build a non-mirror AI deck
    if (state.bots && state.bots.length > 0) setAiDraftPool(state.bots[0].pool || []);
    setDeck({ mainboard: result.deck, sideboard: result.sideboard, lands: result.lands });
    setScreen('deckbuilder');
  }

  function clampTooltip(cx: number, cy: number) {
    const W = 240, H = 380; // tooltip size + margin
    let x = cx + 20;
    let y = cy - 40;
    if (x + W > window.innerWidth) x = cx - W;
    if (y + H > window.innerHeight) y = window.innerHeight - H;
    if (y < 8) y = 8;
    return { x, y };
  }

  function handleMouseEnterCard(card: Card, e: React.MouseEvent) {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => {
      const { x, y } = clampTooltip(e.clientX, e.clientY);
      setTooltip({ card, x, y });
    }, 350);
  }

  function handleMouseLeaveCard() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltip(null);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (tooltip) {
      const { x, y } = clampTooltip(e.clientX, e.clientY);
      setTooltip(prev => prev ? { ...prev, x, y } : null);
    }
  }

  // ── Loading / Error states ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="draft-screen animate-fade-in">
        <div className="draft-loading">
          <div className="draft-spinner" />
          <p>Preparing draft...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="draft-screen animate-fade-in">
        <div className="draft-error">
          <h2>Error</h2>
          <p>{error}</p>
          <button className="btn" onClick={() => setScreen('home')}>Back to Home</button>
        </div>
      </div>
    );
  }

  // ── Finished state ──────────────────────────────────────────────────

  if (draftState?.finished) {
    return (
      <FinishedScreen
        pool={draftState.playerPool}
        onBuildDeck={handleBuildDeck}
      />
    );
  }

  // ── Draft state ─────────────────────────────────────────────────────

  const TOTAL_PICKS = 3 * 14; // 3 rounds × 14 picks per round
  const picksCompleted = (draftState?.round || 0) * 14 + (draftState?.pick || 0);
  const pct = Math.round((picksCompleted / TOTAL_PICKS) * 100);
  const selectedId = draftState?.selectedCard?.id;
  const pool = draftState?.playerPool || [];

  return (
    <div className="draft-screen animate-fade-in" onMouseMove={handleMouseMove}>
      {/* Top bar */}
      <div className="draft-topbar">
        <div className="draft-progress-info">
          <span className="draft-round">Round {(draftState?.round || 0) + 1}/3</span>
          <span className="draft-pick">Pick {(draftState?.pick || 0) + 1}</span>
          <div className="draft-progress-bar">
            <div className="draft-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="draft-progress-pct">{pct}%</span>
        </div>
        <div className="draft-topbar-actions">
          <button className="btn btn-muted" onClick={handleSkipToGame}>
            Skip to Game
          </button>
          <button className="btn btn-muted" onClick={() => setScreen('home')}>
            Quit
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="draft-body">
        {/* Pack area */}
        <div className="draft-pack-area">
          <div className="draft-section-title">
            Current Pack — {currentPack.length} cards remaining
          </div>
          <div className="draft-pack-grid">
            {currentPack.map((card, cIdx) => (
              <div
                key={`${card.id}-${cIdx}`}
                className={`draft-pack-card${selectedId === card.id ? ' selected' : ''}`}
                onClick={() => handleSelectCard(card)}
                onDoubleClick={() => handlePickCard(card)}
                onMouseEnter={(e) => handleMouseEnterCard(card, e)}
                onMouseLeave={handleMouseLeaveCard}
              >
                <CardImage
                  card={card}
                  size="medium"
                  selected={selectedId === card.id}
                />
                <div className={`draft-rarity-dot ${rarityClass(card.rarity)}`} />
              </div>
            ))}
          </div>

          {/* Pick confirm button */}
          {selectedId && (
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const sel = currentPack.find(c => c.id === selectedId);
                  if (sel) handlePickCard(sel);
                }}
              >
                Pick Card
              </button>
              <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                or double-click
              </span>
            </div>
          )}
        </div>

        {/* Pool sidebar */}
        <PoolSidebar pool={pool} tab={poolTab} setTab={setPoolTab} setTooltip={setTooltip} />
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="draft-card-tooltip"
          style={{ top: tooltip.y, left: tooltip.x, position: 'fixed', zIndex: 1000 }}
          onMouseEnter={handleMouseLeaveCard}
        >
          <img
            className="draft-tooltip-img"
            src={tooltip.card.image_normal || tooltip.card.image_small}
            alt={tooltip.card.name}
            onError={e => { e.currentTarget.src = 'https://backs.scryfall.io/large/59/482d0001-547e-4a13-a0f7-451e2a1b5940.jpg'; }}
          />
          <div className="draft-tooltip-info">
            <div className="draft-tooltip-name">{tooltip.card.name}</div>
            <div className="draft-tooltip-type">{tooltip.card.type_line}</div>
            {tooltip.card.oracle_text && (
              <div className="draft-tooltip-text">{tooltip.card.oracle_text}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pool Sidebar ──────────────────────────────────────────────────────

function PoolSidebar({
  pool,
  tab,
  setTab,
  setTooltip,
}: {
  pool: Card[];
  setTooltip: (t: { card: Card; x: number; y: number } | null) => void;
  tab: PoolTab;
  setTab: (t: PoolTab) => void;
}) {
  const filtered =
    tab === 'creatures'
      ? pool.filter(c => (c.type_line || '').includes('Creature'))
      : tab === 'spells'
      ? pool.filter(
          c =>
            !(c.type_line || '').includes('Creature') &&
            !(c.type_line || '').includes('Land')
        )
      : pool;

  const filteredGroups = groupByColor(filtered);

  return (
    <div className="draft-pool-sidebar">
      <div className="draft-pool-header">
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          Pool ({pool.length})
        </span>
        <div className="draft-pool-tabs">
          {(['all', 'creatures', 'spells'] as PoolTab[]).map(t => (
            <button
              key={t}
              className={`draft-pool-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'all' ? 'All' : t === 'creatures' ? 'Creatures' : 'Spells'}
            </button>
          ))}
        </div>
      </div>

      {pool.length === 0 ? (
        <div className="draft-pool-empty">No cards picked yet</div>
      ) : (
        <div className="draft-pool-content">
          {COLOR_ORDER.map(color => {
            const cards = (filteredGroups[color] || []).slice().sort(
              (a, b) => (a.cmc || 0) - (b.cmc || 0)
            );
            if (cards.length === 0) return null;
            return (
              <div key={color} className="draft-pool-group">
                <div className="draft-pool-group-label">
                  <span className={`mana-icon mana-${color}`} />
                  {COLOR_LABELS[color]} ({cards.length})
                </div>
                <div className="draft-pool-cards">
                  {cards.map((card, idx) => (
                    <div
                      key={`${card.id}-${idx}`}
                      className="draft-pool-item"
                      onMouseEnter={e => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setTooltip({ card, x: rect.left - 230, y: Math.min(rect.top, window.innerHeight - 380) });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      <div className="draft-pool-cmc">
                        {Math.round(card.cmc || 0)}
                      </div>
                      <div className="draft-pool-name">{card.name}</div>
                      <div className={`draft-pool-rarity ${rarityClass(card.rarity)}`}>
                        {(card.rarity || 'c')[0].toUpperCase()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Finished Screen ───────────────────────────────────────────────────

function FinishedScreen({
  pool,
  onBuildDeck,
}: {
  pool: Card[];
  onBuildDeck: () => void;
}) {
  const { setScreen } = useAppStore();

  return (
    <div className="draft-finished animate-fade-in">
      <div className="draft-finished-header">
        <div className="draft-finished-title">
          <h2>Draft Complete!</h2>
          <p>{pool.length} cards in your pool</p>
        </div>
        <div className="draft-finished-actions">
          <button className="btn btn-primary" onClick={onBuildDeck}>
            Build Deck
          </button>
          <button className="btn btn-muted" onClick={() => setScreen('home')}>
            Home
          </button>
        </div>
      </div>
      <div className="draft-finished-pool-grid">
        {pool.map((card, idx) => (
          <div key={`${card.id}-${idx}`} className="draft-finished-pool-card">
            <CardImage card={card} size="small" />
          </div>
        ))}
      </div>
    </div>
  );
}
