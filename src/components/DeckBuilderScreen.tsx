import { useState, useMemo, useRef, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { buildDeck } from '../draft/bot-ai';
import type { Card } from '../lib/types';
import './DeckBuilderScreen.css';

const LAND_NAMES: Record<string, string> = {
  W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest',
};
const LAND_IMAGES: Record<string, string> = {
  W: 'https://cards.scryfall.io/art_crop/front/b/5/b5309e43-e3ef-40f0-b668-12a378658dff.jpg',
  U: 'https://cards.scryfall.io/art_crop/front/4/9/49999b95-5e62-414c-b975-4191b9c1ab39.jpg',
  B: 'https://cards.scryfall.io/art_crop/front/a/a/aa0a4c76-da88-480e-b785-68e99c916c9c.jpg',
  R: 'https://cards.scryfall.io/art_crop/front/1/3/13e6b953-f7a3-4bf7-ac34-d879c5b74d2e.jpg',
  G: 'https://cards.scryfall.io/art_crop/front/c/c/cc9f0bb5-6827-4f26-9897-c63fd5b33d52.jpg',
};
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
const MANA_COLORS: Record<string, string> = { W: '#f5e9c9', U: '#4a90d9', B: '#9b59b6', R: '#e74c3c', G: '#27ae60', M: '#f0c040', C: '#888' };

export function DeckBuilderScreen() {
  const { draftPool, deck, setDeck, setScreen } = useAppStore();

  const [mainboard, setMainboard] = useState<Card[]>(deck?.mainboard ?? []);
  const [sideboard, setSideboard] = useState<Card[]>(
    deck?.sideboard ?? draftPool.filter(c => !deck?.mainboard.find(d => d.id === c.id))
  );
  const [lands, setLands] = useState<Record<string, number>>(deck?.lands ?? { W: 0, U: 0, B: 0, R: 0, G: 0 });
  const [zoomCard, setZoomCard] = useState<Card | null>(null);
  const [sideView, setSideView] = useState<'sideboard' | 'all'>('sideboard');
  const [dragOver, setDragOver] = useState<'main' | 'side' | null>(null);
  const draggedRef = useRef<{ card: Card; fromSide: boolean } | null>(null);

  const basicLandsTotal = Object.values(lands).reduce((s, n) => s + n, 0);
  const nonBasicLandsInMain = mainboard.filter(c => {
    const tl = (c.type_line || '').toLowerCase();
    return tl.includes('land') && !tl.includes('basic');
  }).length;
  const totalLands = basicLandsTotal + nonBasicLandsInMain;
  const totalCards = mainboard.length + basicLandsTotal; // non-basics already in mainboard
  const stats = useMemo(() => computeStats(mainboard), [mainboard]);

  const cmcGroups = useMemo(() => {
    const groups: Record<number, Card[]> = {};
    for (const c of mainboard) {
      const slot = Math.min(computeCardCmc(c), 7);
      (groups[slot] ??= []).push(c);
    }
    for (const g of Object.values(groups)) {
      g.sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  }, [mainboard]);

  // Always include slots 0-7 so the 7+ column is always visible
  const maxCmc = Math.max(...Object.keys(cmcGroups).map(Number), 7);
  const cmcSlots = Array.from({ length: maxCmc + 1 }, (_, i) => i);

  function handleAutoBuild() {
    const pool = [...mainboard, ...sideboard];
    const result = buildDeck(pool);
    setMainboard(result.deck);
    setSideboard(result.sideboard);
    setLands(result.lands);
  }

  function moveToMain(card: Card) {
    // Remove only the FIRST matching card (not all copies with same id)
    setSideboard(prev => { const i = prev.findIndex(c => c.id === card.id); return i === -1 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)]; });
    setMainboard(prev => [...prev, card]);
  }

  function moveToSide(card: Card) {
    // Remove only the FIRST matching card (not all copies with same id)
    setMainboard(prev => { const i = prev.findIndex(c => c.id === card.id); return i === -1 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)]; });
    setSideboard(prev => [...prev, card]);
  }

  function adjustLand(color: string, delta: number) {
    setLands(prev => ({ ...prev, [color]: Math.max(0, (prev[color] ?? 0) + delta) }));
  }

  function handleStartGame() {
    setDeck({ mainboard, sideboard, lands });
    setScreen('game');
  }

  function handleSave() {
    setDeck({ mainboard, sideboard, lands });
    alert('Deck saved! (' + totalCards + ' cards)');
  }

  // ── Right-click zoom ────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent, card: Card) => {
    e.preventDefault();
    setZoomCard(card);
  }, []);

  // ── Drag & Drop ────────────────────────────────────────────
  function onDragStart(card: Card, fromSide: boolean) {
    draggedRef.current = { card, fromSide };
  }

  function onDropMain(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const d = draggedRef.current;
    if (d && d.fromSide) moveToMain(d.card);
    draggedRef.current = null;
  }

  function onDropSide(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const d = draggedRef.current;
    if (d && !d.fromSide) moveToSide(d.card);
    draggedRef.current = null;
  }

  const listSource = (sideView === 'sideboard' ? sideboard : draftPool)
    .slice()
    .sort((a, b) => computeCardCmc(a) - computeCardCmc(b) || a.name.localeCompare(b.name));

  // Count how many copies of each card id are in mainboard (to handle duplicates correctly)
  const mainCountMap: Record<string, number> = {};
  for (const c of mainboard) mainCountMap[c.id] = (mainCountMap[c.id] || 0) + 1;

  // Build list with per-position inMain status — the N-th copy is "in main" only if ≥N copies are in mainboard
  const seenInList: Record<string, number> = {};
  const listWithMain = listSource.map(card => {
    const seen = (seenInList[card.id] || 0) + 1;
    seenInList[card.id] = seen;
    const inMain = seen <= (mainCountMap[card.id] || 0);
    return { card, inMain };
  });

  return (
    <div className="db-screen animate-fade-in" onClick={() => setZoomCard(null)}>
      {/* ── Card Zoom Overlay ────────────────────────────────── */}
      {zoomCard && (
        <div
          className="db-zoom-overlay"
          onClick={e => { e.stopPropagation(); setZoomCard(null); }}
        >
          <img
            src={zoomCard.image_normal || zoomCard.image_small}
            alt={zoomCard.name}
            className="db-zoom-img"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="db-toolbar glass">
        <div className="db-toolbar-left">
          <button className="btn btn-muted" onClick={() => setScreen('draft')}>← Draft</button>
          <span
            className="db-deck-size"
            style={{ color: totalCards === 40 ? 'var(--success)' : totalCards > 40 ? 'var(--danger)' : 'var(--gold)' }}
          >
            {totalCards}/40
          </span>
          <span className="db-deck-lands">{mainboard.length} spells · {totalLands} lands</span>
        </div>
        <div className="db-toolbar-hint">Right-click card to zoom · Drag to move</div>
        <div className="db-toolbar-right">
          <button className="btn btn-muted" onClick={handleAutoBuild}>⚡ Auto-Build</button>
          <button className="btn btn-muted" onClick={handleSave}>💾 Save</button>
          <button className="btn btn-gold" onClick={handleStartGame}>▶ Play vs AI</button>
        </div>
      </div>

      <div className="db-body">
        {/* ── Left: CMC Visual ──────────────────────────────── */}
        <div
          className={`db-visual-area${dragOver === 'main' ? ' drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver('main'); }}
          onDragLeave={() => setDragOver(null)}
          onDrop={onDropMain}
        >
          {dragOver === 'main' && (
            <div className="db-drop-hint">Drop here to add to deck</div>
          )}
          <div className="db-cmc-columns">
            {cmcSlots.map(cmc => {
              const cards = cmcGroups[cmc] ?? [];
              return (
                <div key={cmc} className="db-cmc-col">
                  <div className="db-cmc-header">
                    <span className="db-cmc-num">{cmc}{cmc === 7 ? '+' : ''}</span>
                    {cards.length > 0 && <span className="db-cmc-count">{cards.length}</span>}
                  </div>
                  <div className="db-card-stack">
                    {cards.map((card, idx) => (
                      <div
                        key={card.id + '-' + idx}
                        className="db-stack-card"
                        style={{ zIndex: idx }}
                        draggable
                        onDragStart={() => onDragStart(card, false)}
                        onContextMenu={e => handleContextMenu(e, card)}
                        onClick={() => moveToSide(card)}
                        title={card.name + ' — click to sideboard · right-click to zoom · drag to move'}
                      >
                        <img
                          src={card.image_normal || card.image_small}
                          alt={card.name}
                          loading="lazy"
                        />
                        <div className="db-stack-label">{card.name}</div>
                      </div>
                    ))}
                    {cards.length === 0 && <div className="db-cmc-empty" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right panel ───────────────────────────────────── */}
        <div className="db-right-panel">

          {/* Mana curve */}
          <div className="db-mini-curve glass">
            <div className="db-mini-curve-bars">
              {[1,2,3,4,5,6,7].map(cmc => {
                const count = stats.curve[cmc] ?? 0;
                const max = Math.max(...Object.values(stats.curve), 1);
                return (
                  <div key={cmc} className="db-mini-col">
                    <span className="db-mini-count">{count || ''}</span>
                    <div className="db-mini-bar-wrap">
                      <div className="db-mini-bar" style={{ height: (count / max * 48) + 'px' }} />
                    </div>
                    <span className="db-mini-cmc">{cmc}{cmc >= 7 ? '+' : ''}</span>
                  </div>
                );
              })}
            </div>
            <div className="db-color-row">
              {COLOR_ORDER.filter(c => stats.pips[c] > 0).map(c => (
                <div key={c} className="db-color-pip">
                  <div className="db-pip-dot" style={{ background: MANA_COLORS[c] }} />
                  <span>{stats.pips[c]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Lands */}
          <div className="db-lands-mini glass">
            <div className="db-lands-title">Lands ({totalLands})</div>
            {COLOR_ORDER.map(color => (
              <div key={color} className="db-land-row">
                <img src={LAND_IMAGES[color]} alt={LAND_NAMES[color]} className="db-land-img" />
                <span className="db-land-name">{LAND_NAMES[color]}</span>
                <div className="db-land-controls">
                  <button className="db-land-btn" onClick={() => adjustLand(color, -1)}>−</button>
                  <span className="db-land-count">{lands[color] ?? 0}</span>
                  <button className="db-land-btn" onClick={() => adjustLand(color, +1)}>+</button>
                </div>
              </div>
            ))}
          </div>

          {/* Sideboard / Pool */}
          <div
            className={`db-side-panel glass${dragOver === 'side' ? ' drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver('side'); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={onDropSide}
          >
            <div className="db-view-tabs">
              <button
                className={sideView === 'sideboard' ? 'db-tab active' : 'db-tab'}
                onClick={() => setSideView('sideboard')}
              >
                Side ({sideboard.length})
              </button>
              <button
                className={sideView === 'all' ? 'db-tab active' : 'db-tab'}
                onClick={() => setSideView('all')}
              >
                Pool ({draftPool.length})
              </button>
            </div>
            {dragOver === 'side' && (
              <div className="db-drop-hint-side">Drop here to sideboard</div>
            )}
            <div className="db-side-grid">
              {listWithMain.map(({ card, inMain }, idx) => (
                <div
                  key={card.id + '-' + idx}
                  className={`db-side-thumb ${inMain ? 'in-main' : ''}`}
                  draggable={!inMain}
                  onDragStart={() => !inMain && onDragStart(card, true)}
                  onContextMenu={e => handleContextMenu(e, card)}
                  onClick={() => !inMain ? moveToMain(card) : moveToSide(card)}
                  title={card.name + (inMain ? ' — click to remove from deck' : ' — click to add to deck · right-click to zoom')}
                >
                  <img
                    src={card.image_normal || card.image_small}
                    alt={card.name}
                    loading="lazy"
                  />
                  {inMain && <div className="db-side-check">✓</div>}
                  <div className="db-side-name">{card.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compute CMC from mana_cost string as fallback when card.cmc is 0 or missing */
function computeCardCmc(card: Card): number {
  if (card.cmc > 0) return card.cmc;
  // Lands are genuinely 0 cmc
  if ((card.type_line || '').toLowerCase().includes('land')) return 0;
  // Try to derive from mana_cost string (e.g. "{8}{C}{C}" → 10)
  if (!card.mana_cost) return 0;
  let total = 0;
  for (const m of card.mana_cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1];
    if (/^\d+$/.test(sym)) total += parseInt(sym, 10);
    else if (sym !== 'X') total += 1; // W/U/B/R/G/C/S each = 1
  }
  return total;
}

function computeStats(cards: Card[]) {
  const curve: Record<number, number> = {};
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of cards) {
    const slot = Math.min(computeCardCmc(card), 7);
    curve[slot] = (curve[slot] ?? 0) + 1;
    const cost = card.mana_cost ?? '';
    for (const m of cost.matchAll(/{([WUBRG])}/g)) pips[m[1]] = (pips[m[1]] ?? 0) + 1;
  }
  return { curve, pips };
}
