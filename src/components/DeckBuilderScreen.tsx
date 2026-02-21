import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { buildDeck } from '../draft/bot-ai';
import type { Card } from '../lib/types';
import './DeckBuilderScreen.css';

import manaw from '../assets/mana-W.png';
import manau from '../assets/mana-U.png';
import manab from '../assets/mana-B.png';
import manar from '../assets/mana-R.png';
import manag from '../assets/mana-G.png';

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
const MANA_SYMBOLS: Record<string, string> = {
  W: manaw,
  U: manau,
  B: manab,
  R: manar,
  G: manag,
};
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
const MANA_COLORS: Record<string, string> = { W: '#f9faf4', U: '#0e68ab', B: '#6b4fa0', R: '#d3202a', G: '#00733e', M: '#f0c040', C: '#888' };
const CARD_BACK = 'https://backs.scryfall.io/large/59/482d0001-547e-4a13-a0f7-451e2a1b5940.jpg';
const imgError = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.src = CARD_BACK; };

export function DeckBuilderScreen() {
  const { draftPool, deck, setDeck, setScreen, landArts, selectedSet } = useAppStore();

  const [mainboard, setMainboard] = useState<Card[]>(deck?.mainboard ?? []);
  const [sideboard, setSideboard] = useState<Card[]>(() => {
    if (deck?.sideboard) return deck.sideboard;
    if (!deck?.mainboard || deck.mainboard.length === 0) return [...draftPool];
    // Remove mainboard copies one-by-one (count-based, handles duplicates correctly)
    const poolCopy = [...draftPool];
    for (const mainCard of deck.mainboard) {
      const idx = poolCopy.findIndex(c => c.id === mainCard.id);
      if (idx !== -1) poolCopy.splice(idx, 1);
    }
    return poolCopy;
  });
  const [lands, setLands] = useState<Record<string, number>>(deck?.lands ?? { W: 0, U: 0, B: 0, R: 0, G: 0 });
  const [zoomCard, setZoomCard] = useState<Card | null>(null);
  const [sideView, setSideView] = useState<'sideboard' | 'all'>('sideboard');
  // columnOverrides: mainboard index → manual column override (so user can move cards between CMC cols)
  const [columnOverrides, setColumnOverrides] = useState<Record<number, number>>({});
  // typeOverrides: mainboard index → manual type row override
  const [typeOverrides, setTypeOverrides] = useState<Record<number, string>>({});
  const [typeRows, setTypeRows] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Fetch basic land card images from DB — prefer selected set, fallback to any
  const [landCardImages, setLandCardImages] = useState<Record<string, string>>({});
  useEffect(() => {
    const LAND_NAME_TO_COLOR: Record<string, string> = {
      Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G',
    };
    async function fetchLandImages() {
      const { getCardsBySet, getCardByName } = await import('../lib/database');
      const imgs: Record<string, string> = {};
      // First try from the current set (gives the right art)
      try {
        const setCards = await getCardsBySet(selectedSet);
        for (const card of setCards) {
          const color = LAND_NAME_TO_COLOR[card.name];
          if (color && card.image_normal && !imgs[color]) {
            imgs[color] = card.image_normal;
          }
        }
      } catch { /* ignore */ }
      // Fallback: any set for colors still missing
      for (const [name, color] of Object.entries(LAND_NAME_TO_COLOR)) {
        if (!imgs[color]) {
          try {
            const card = await getCardByName(name);
            if (card?.image_normal) imgs[color] = card.image_normal;
          } catch { /* ignore */ }
        }
      }
      if (Object.keys(imgs).length > 0) setLandCardImages(imgs);
    }
    fetchLandImages();
  }, [selectedSet]);

  // Type grouping helpers
  function getTypeGroup(card: Card): string {
    const tl = (card.type_line || '').toLowerCase();
    if (tl.includes('creature')) return 'creature';
    if (tl.includes('instant') || tl.includes('sorcery')) return 'spell';
    if (tl.includes('land')) return 'land';
    return 'other'; // artifact, enchantment, planeswalker
  }
  const TYPE_GROUPS = ['creature', 'spell', 'other', 'land'] as const;
  const TYPE_LABELS: Record<string, string> = { creature: 'Creature', spell: 'Instant/Sorc', other: 'Artifact/Ench', land: 'Land' };

  // ── Custom mouse drag (HTML5 DnD doesn't work in Tauri WebView) ──────────────
  interface CustomDragState {
    card: Card;
    fromSide: boolean;
    mainIdx?: number;
    startX: number;
    startY: number;
    started: boolean; // true once moved > threshold
  }
  const customDragRef = useRef<CustomDragState | null>(null);
  // Track current mainboard in a ref so mouse event closures always see it
  const mainboardRef = useRef(mainboard);
  mainboardRef.current = mainboard;

  // Ghost card that follows the cursor during drag
  const [ghost, setGhost] = useState<{ card: Card; x: number; y: number; overCol: number | null; overSide: boolean; overType: string | null } | null>(null);
  // Highlighted CMC column / type row during drag
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  const [dragOverType, setDragOverType] = useState<string | null>(null);

  const basicLandsTotal = Object.values(lands).reduce((s, n) => s + n, 0);
  const nonBasicLandsInMain = mainboard.filter(c => {
    const tl = (c.type_line || '').toLowerCase();
    return tl.includes('land') && !tl.includes('basic');
  }).length;
  const totalLands = basicLandsTotal + nonBasicLandsInMain;
  const totalCards = mainboard.length + basicLandsTotal; // non-basics already in mainboard
  const stats = useMemo(() => computeStats(mainboard), [mainboard]);

  const cmcGroups = useMemo(() => {
    const groups: Record<number, Array<{ card: Card; mainIdx: number }>> = {};
    mainboard.forEach((c, mainIdx) => {
      const tl = (c.type_line || '').toLowerCase();
      const isLand = tl.includes('land');
      // slot 8 = dedicated Land column; all lands default there
      const baseCmc = isLand ? 8 : Math.min(computeCardCmc(c), 7);
      const slot = columnOverrides[mainIdx] !== undefined ? columnOverrides[mainIdx] : baseCmc;
      (groups[slot] ??= []).push({ card: c, mainIdx });
    });
    for (const g of Object.values(groups)) {
      g.sort((a, b) => a.card.name.localeCompare(b.card.name));
    }
    return groups;
  }, [mainboard, columnOverrides]);

  // Always include slots 1-7 for the spell curve + slot 8 for the Land column
  const maxCmc = Math.max(...Object.keys(cmcGroups).map(Number), 8);
  const cmcSlots = Array.from({ length: maxCmc + 1 }, (_, i) => i).filter(i => i !== 0 || (cmcGroups[0]?.length ?? 0) > 0);

  // Basic lands grouped by color (one entry per color, not one per count)
  const basicLandEntries = useMemo(() =>
    COLOR_ORDER
      .filter(c => (lands[c] ?? 0) > 0)
      .map(c => ({ color: c, name: LAND_NAMES[c], art: landArts[c] || landCardImages[c] || MANA_SYMBOLS[c], count: lands[c] ?? 0 })),
    [lands, landArts, landCardImages]);

  function handleAutoBuild() {
    const pool = [...mainboard, ...sideboard];
    const result = buildDeck(pool);
    setMainboard(result.deck);
    setSideboard(result.sideboard);
    setLands(result.lands);
    setColumnOverrides({});
    setTypeOverrides({});
  }

  // Auto-build on first open when no saved deck and pool is available
  useEffect(() => {
    if (!deck && draftPool.length > 0 && mainboard.length === 0) {
      const result = buildDeck(draftPool);
      setMainboard(result.deck);
      setSideboard(result.sideboard);
      setLands(result.lands);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remove card at specific mainboard index, shifting column/type overrides
  function removeFromMainboard(idx: number) {
    setMainboard(prev => [...prev.slice(0, idx), ...prev.slice(idx + 1)]);
    setColumnOverrides(prev => {
      const next: Record<number, number> = {};
      for (const [k, v] of Object.entries(prev)) {
        const ki = parseInt(k);
        if (ki === idx) continue;
        next[ki > idx ? ki - 1 : ki] = v;
      }
      return next;
    });
    setTypeOverrides(prev => {
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        const ki = parseInt(k);
        if (ki === idx) continue;
        next[ki > idx ? ki - 1 : ki] = v;
      }
      return next;
    });
  }

  function moveToMain(card: Card) {
    // Remove only the FIRST matching card (not all copies with same id)
    setSideboard(prev => { const i = prev.findIndex(c => c.id === card.id); return i === -1 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)]; });
    setMainboard(prev => [...prev, card]);
  }

  function moveToSide(card: Card, mainIdx?: number) {
    if (mainIdx !== undefined) {
      removeFromMainboard(mainIdx);
      setSideboard(prev => [...prev, card]);
    } else {
      // fallback: find first matching by id
      const idx = mainboard.findIndex(c => c.id === card.id);
      if (idx !== -1) {
        removeFromMainboard(idx);
        setSideboard(prev => [...prev, card]);
      }
    }
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
    setToast(`Deck saved! (${totalCards} cards)`);
    setTimeout(() => setToast(null), 2500);
  }

  // ── Right-click zoom ────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent, card: Card) => {
    e.preventDefault();
    setZoomCard(card);
  }, []);

  // ── Custom mouse drag (works in Tauri WebView) ───────────────────────────────
  // Walk up the DOM from an element to find a data attribute value
  function findDataAttr(el: Element | null, attr: string): string | null {
    let curr = el;
    while (curr) {
      if (curr instanceof HTMLElement && curr.dataset[attr] !== undefined) return curr.dataset[attr]!;
      curr = curr.parentElement;
    }
    return null;
  }

  function startCardDrag(e: React.MouseEvent, card: Card, fromSide: boolean, mainIdx?: number) {
    // Only left button
    if (e.button !== 0) return;
    e.preventDefault(); // prevent browser text-selection from swallowing mousemove events
    customDragRef.current = { card, fromSide, mainIdx, startX: e.clientX, startY: e.clientY, started: false };
  }

  // The handlers ref pattern: closures stay up to date without re-registering listeners
  const mouseHandlersRef = useRef({
    onMove: (_e: MouseEvent) => {},
    onUp: (_e: MouseEvent) => {},
  });

  mouseHandlersRef.current.onMove = (e: MouseEvent) => {
    const ds = customDragRef.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX, dy = e.clientY - ds.startY;
    if (!ds.started && Math.sqrt(dx * dx + dy * dy) < 6) return;
    ds.started = true;

    // Find what's under cursor — ghost has pointer-events:none so elementFromPoint works
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cmcStr = findDataAttr(el, 'cmc');
    const zone = findDataAttr(el, 'zone');
    const typeStr = findDataAttr(el, 'type');
    const overCol = cmcStr !== null ? parseInt(cmcStr) : null;
    const overSide = zone === 'side';
    const overType = typeStr;

    if (!ds.started) document.body.style.cursor = 'grabbing';
    setGhost({ card: ds.card, x: e.clientX, y: e.clientY, overCol, overSide, overType });
    setDragOverCol(overCol);
    setDragOverType(overType);
  };

  mouseHandlersRef.current.onUp = (e: MouseEvent) => {
    const ds = customDragRef.current;
    if (!ds) return;
    customDragRef.current = null;
    document.body.style.cursor = '';
    setGhost(null);
    setDragOverCol(null);
    setDragOverType(null);

    if (!ds.started) return; // pure click — let onClick handle it

    // Find drop target
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cmcStr = findDataAttr(el, 'cmc');
    const zone = findDataAttr(el, 'zone');
    const typeStr = findDataAttr(el, 'type');
    const dropCol = cmcStr !== null ? parseInt(cmcStr) : null;
    const dropSide = zone === 'side';
    const dropType = typeStr;

    if (!ds.fromSide && ds.mainIdx !== undefined) {
      if (dropCol !== null) {
        // Main → different column (and/or type row)
        setColumnOverrides(prev => ({ ...prev, [ds.mainIdx!]: dropCol }));
        if (dropType) setTypeOverrides(prev => ({ ...prev, [ds.mainIdx!]: dropType }));
      } else if (dropSide) {
        // Main → sideboard
        moveToSide(ds.card, ds.mainIdx);
      }
    } else if (ds.fromSide) {
      if (dropCol !== null) {
        // Side → specific column (and/or type row)
        const naturalCol = Math.min(computeCardCmc(ds.card), 7);
        const newIdx = mainboardRef.current.length;
        setSideboard(prev => { const i = prev.findIndex(c => c.id === ds.card.id); return i === -1 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)]; });
        setMainboard(prev => [...prev, ds.card]);
        if (dropCol !== naturalCol) setColumnOverrides(prev => ({ ...prev, [newIdx]: dropCol }));
        if (dropType) setTypeOverrides(prev => ({ ...prev, [newIdx]: dropType }));
      } else if (zone === 'main') {
        // Side → main area (no specific column)
        moveToMain(ds.card);
      }
    }
  };

  useEffect(() => {
    const mm = (e: MouseEvent) => mouseHandlersRef.current.onMove(e);
    const mu = (e: MouseEvent) => mouseHandlersRef.current.onUp(e);
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
    return () => {
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
    };
  }, []);

  const listSource = (sideView === 'sideboard' ? sideboard : draftPool)
    .slice()
    .sort((a, b) => computeCardCmc(a) - computeCardCmc(b) || a.name.localeCompare(b.name));

  // Count how many copies of each card id are in mainboard
  const mainCountMap: Record<string, number> = {};
  for (const c of mainboard) mainCountMap[c.id] = (mainCountMap[c.id] || 0) + 1;

  // Build list with per-position inMain status.
  // Sideboard view: cards shown ARE in the sideboard → inMain is always false (clicking moves to main).
  // Pool view: the N-th occurrence is "in main" if ≥N copies are in mainboard (first N get checkmarks).
  const seenInList: Record<string, number> = {};
  const listWithMain = listSource.map(card => {
    if (sideView === 'sideboard') {
      return { card, inMain: false };
    }
    const seen = (seenInList[card.id] || 0) + 1;
    seenInList[card.id] = seen;
    const inMain = seen <= (mainCountMap[card.id] || 0);
    return { card, inMain };
  });

  return (
    <div className="db-screen animate-fade-in" onClick={() => setZoomCard(null)}>
      {toast && <div className="db-toast">{toast}</div>}
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
            onError={imgError}
          />
        </div>
      )}

      {/* ── Drag ghost card ─────────────────────────────────── */}
      {ghost && (
        <div
          className={`db-drag-ghost${ghost.overCol !== null ? ' over-col' : ghost.overSide ? ' over-side' : ''}`}
          style={{ left: ghost.x - 40, top: ghost.y - 56, pointerEvents: 'none' }}
        >
          <img src={ghost.card.image_normal || ghost.card.image_small} alt={ghost.card.name} onError={imgError} />
          {ghost.overCol !== null && <div className="db-drag-ghost-label">→ {ghost.overCol}{ghost.overCol === 7 ? '+' : ''} mana{ghost.overType ? ` · ${TYPE_LABELS[ghost.overType]}` : ''}</div>}
          {ghost.overSide && <div className="db-drag-ghost-label db-drag-ghost-side">→ Sideboard</div>}
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
          <span className="db-deck-lands">{mainboard.length - nonBasicLandsInMain} spells · {totalLands} lands</span>
        </div>
        <div className="db-toolbar-hint">Right-click to zoom · Click to move · Drag to reorder</div>
        <div className="db-toolbar-right">
          <button className={`btn btn-muted${typeRows ? ' btn-active' : ''}`} onClick={() => setTypeRows(t => !t)} title="Group cards by type within each CMC column">≡ Types</button>
          <button className="btn btn-muted" onClick={handleAutoBuild}>⚡ Auto-Build</button>
          <button className="btn btn-muted" onClick={handleSave}>💾 Save</button>
          <button className="btn btn-gold" onClick={handleStartGame}>▶ Play vs AI</button>
        </div>
      </div>

      <div className="db-body">
        {/* ── Left: CMC Visual ──────────────────────────────── */}
        <div className="db-visual-area" data-zone="main">

          {typeRows ? (
            /* ── 2D Grid: rows = type, columns = CMC ─────────── */
            <div className="db-type-grid">
              {/* CMC header */}
              <div className="db-type-header-row">
                <div className="db-type-row-spacer" />
                {cmcSlots.filter(c => c !== 8).map(cmc => (
                  <div key={cmc} className="db-type-col-header">{cmc === 7 ? '7+' : cmc}</div>
                ))}
                <div className="db-type-col-header db-land-col-header">Land</div>
              </div>

              {/* Creature / Spell / Other rows */}
              {(['creature', 'spell', 'other'] as const).map(tg => (
                <div key={tg} className="db-type-grid-row">
                  <div className="db-type-row-label">{TYPE_LABELS[tg]}</div>
                  {cmcSlots.filter(c => c !== 8).map(cmc => {
                    const cellEntries = (cmcGroups[cmc] ?? []).filter(({ card, mainIdx }) =>
                      (typeOverrides[mainIdx] || getTypeGroup(card)) === tg
                    );
                    const isOver = dragOverCol === cmc && dragOverType === tg;
                    return (
                      <div
                        key={cmc}
                        className={`db-type-cell${isOver ? ' type-drag-over' : ''}`}
                        data-cmc={cmc}
                        data-type={tg}
                      >
                        <div className="db-card-stack" data-cmc={cmc} data-type={tg}>
                          {cellEntries.map(({ card, mainIdx }, idx) => (
                            <div
                              key={card.id + '-' + mainIdx}
                              className={`db-stack-card${columnOverrides[mainIdx] !== undefined || typeOverrides[mainIdx] ? ' col-overridden' : ''}${ghost?.card === card ? ' dragging' : ''}`}
                              style={{ zIndex: idx }}
                              data-cmc={cmc}
                              data-type={tg}
                              onMouseDown={e => startCardDrag(e, card, false, mainIdx)}
                              onContextMenu={e => handleContextMenu(e, card)}
                              onClick={() => { if (customDragRef.current?.started) return; moveToSide(card, mainIdx); }}
                              title={card.name + ' — click to sideboard · drag to move'}
                            >
                              <img src={card.image_normal || card.image_small} alt={card.name} loading="lazy" onError={imgError} draggable={false} />
                              <div className="db-stack-label">{card.name}</div>
                            </div>
                          ))}
                          {cellEntries.length === 0 && <div className="db-type-drop-target" data-cmc={cmc} data-type={tg} />}
                        </div>
                      </div>
                    );
                  })}
                  {/* Land column is empty for non-land rows */}
                  <div className="db-type-cell db-type-cell-land" data-cmc={8} data-type={tg} />
                </div>
              ))}

              {/* Land row */}
              <div className="db-type-grid-row db-type-land-row">
                <div className="db-type-row-label">Land</div>
                {cmcSlots.filter(c => c !== 8).map(cmc => (
                  <div key={cmc} className="db-type-cell" data-cmc={cmc} data-type="land" />
                ))}
                {/* Land column with all lands */}
                <div
                  className={`db-type-cell db-type-cell-land${dragOverCol === 8 ? ' col-drag-over' : ''}`}
                  data-cmc={8}
                  data-type="land"
                >
                  <div className="db-card-stack" data-cmc={8} data-type="land">
                    {basicLandEntries.map((bl, idx) => (
                      <div
                        key={bl.color}
                        className="db-stack-card db-basic-land"
                        style={{ zIndex: idx }}
                        data-cmc={8}
                        data-type="land"
                        onClick={() => adjustLand(bl.color, -1)}
                        title={bl.name + ' ×' + bl.count + ' — click to remove one'}
                      >
                        <img src={bl.art} alt={bl.name} loading="lazy" onError={imgError} draggable={false} />
                        <div className="db-basic-badge">×{bl.count}</div>
                      </div>
                    ))}
                    {(cmcGroups[8] ?? []).map(({ card, mainIdx }, idx) => (
                      <div
                        key={card.id + '-' + mainIdx}
                        className={`db-stack-card${columnOverrides[mainIdx] !== undefined ? ' col-overridden' : ''}${ghost?.card === card ? ' dragging' : ''}`}
                        style={{ zIndex: basicLandEntries.length + idx }}
                        data-cmc={8}
                        data-type="land"
                        onMouseDown={e => startCardDrag(e, card, false, mainIdx)}
                        onContextMenu={e => handleContextMenu(e, card)}
                        onClick={() => { if (customDragRef.current?.started) return; moveToSide(card, mainIdx); }}
                        title={card.name + ' — click to sideboard'}
                      >
                        <img src={card.image_normal || card.image_small} alt={card.name} loading="lazy" onError={imgError} draggable={false} />
                        <div className="db-stack-label">{card.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

          ) : (
            /* ── Normal CMC columns ───────────────────────────── */
            <div className="db-cmc-columns">
              {cmcSlots.map(cmc => {
                const entries = cmcGroups[cmc] ?? [];
                const landTotal = entries.length + (cmc === 8 ? basicLandsTotal : 0);
                return (
                  <div
                    key={cmc}
                    className={`db-cmc-col${dragOverCol === cmc ? ' col-drag-over' : ''}`}
                    data-cmc={cmc}
                  >
                    <div className="db-cmc-header" data-cmc={cmc}>
                      <span className="db-cmc-num">{cmc === 8 ? 'Land' : cmc === 7 ? '7+' : cmc}</span>
                      {(cmc === 8 ? landTotal : entries.length) > 0 && (
                        <span className="db-cmc-count">{cmc === 8 ? landTotal : entries.length}</span>
                      )}
                    </div>
                    <div className="db-card-stack" data-cmc={cmc}>
                      {/* Basic lands: render first (lower z-index so they're behind) */}
                      {cmc === 8 && basicLandEntries.map((bl, idx) => (
                        <div
                          key={bl.color}
                          className="db-stack-card db-basic-land"
                          style={{ zIndex: idx }}
                          data-cmc={8}
                          onClick={() => adjustLand(bl.color, -1)}
                          onContextMenu={e => { e.preventDefault(); setZoomCard({ name: bl.name, image_normal: bl.art, image_small: bl.art } as unknown as Card); }}
                          title={bl.name + ' ×' + bl.count + ' — click to remove one · right-click to zoom'}
                        >
                          <img
                            src={bl.art}
                            alt={bl.name}
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.src = MANA_SYMBOLS[bl.color];
                            }}
                            draggable={false}
                          />
                          <div className="db-basic-badge">×{bl.count}</div>
                        </div>
                      ))}
                      {/* Non-basic lands + spells: render second (higher z-index so duals appear in front) */}
                      {entries.map(({ card, mainIdx }, idx) => (
                        <div
                          key={card.id + '-' + mainIdx}
                          className={`db-stack-card${columnOverrides[mainIdx] !== undefined ? ' col-overridden' : ''}${ghost?.card === card ? ' dragging' : ''}`}
                          style={{ zIndex: basicLandEntries.length + idx }}
                          data-cmc={cmc}
                          onMouseDown={e => startCardDrag(e, card, false, mainIdx)}
                          onContextMenu={e => handleContextMenu(e, card)}
                          onClick={() => { if (customDragRef.current?.started) return; moveToSide(card, mainIdx); }}
                          title={card.name + ' — click to sideboard · right-click to zoom · drag to reorder'}
                        >
                          <img src={card.image_normal || card.image_small} alt={card.name} loading="lazy" onError={imgError} draggable={false} />
                          <div className="db-stack-label">{card.name}</div>
                        </div>
                      ))}
                      {entries.length === 0 && cmc !== 8 && <div className="db-cmc-empty" data-cmc={cmc} />}
                      {cmc === 8 && entries.length === 0 && basicLandEntries.length === 0 && <div className="db-cmc-empty" data-cmc={8} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
                <img src={MANA_SYMBOLS[color]} alt={LAND_NAMES[color]} className="db-mana-symbol" />
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
            className={`db-side-panel glass${ghost?.overSide ? ' drag-over' : ''}`}
            data-zone="side"
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
            {ghost?.overSide && (
              <div className="db-drop-hint-side">Drop here to sideboard</div>
            )}
            <div className="db-side-grid" data-zone="side">
              {listWithMain.map(({ card, inMain }, idx) => (
                <div
                  key={card.id + '-' + idx}
                  className={`db-side-thumb ${inMain ? 'in-main' : ''}`}
                  onMouseDown={e => { if (!inMain) startCardDrag(e, card, true); }}
                  onContextMenu={e => handleContextMenu(e, card)}
                  onClick={() => { if (customDragRef.current?.started) return; !inMain ? moveToMain(card) : moveToSide(card); }}
                  title={card.name + (inMain ? ' — click to remove from deck' : ' — click to add · right-click to zoom · drag to column')}
                >
                  <img
                    src={card.image_normal || card.image_small}
                    alt={card.name}
                    loading="lazy"
                    onError={imgError}
                    draggable={false}
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
