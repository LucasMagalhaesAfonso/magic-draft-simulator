import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { buildDeck } from '../draft/bot-ai';
import { CardImage } from './card/CardImage';
import { BoosterOpenAnimation } from './BoosterOpenAnimation';
import type { Card } from '../lib/types';
import tdmBooster from '../assets/tdm-booster-pack.png';
import ltrBooster from '../assets/ltr-booster-pack.png';
import './SealedRevealScreen.css';

const BOOSTER_IMAGES: Record<string, string> = {
  tdm: tdmBooster,
  ltr: ltrBooster,
};

function rarityOf(card: Card): string {
  return (card.rarity || '').toLowerCase();
}

function rarityOrder(card: Card): number {
  const r = rarityOf(card);
  if (r === 'mythic') return 0;
  if (r === 'rare') return 1;
  if (r === 'uncommon') return 2;
  return 3; // common
}

function isHighRarity(card: Card): boolean {
  const r = rarityOf(card);
  return r === 'rare' || r === 'mythic';
}

type OpenPhase = 'idle' | 'rare_spotlight' | 'revealed';

export function SealedRevealScreen() {
  const { sealedPacks, selectedSet, setDraftPool, setDeck, setScreen, setSealedPacks } = useAppStore();
  const boosterImg = BOOSTER_IMAGES[selectedSet] || BOOSTER_IMAGES.tdm;
  const packs = sealedPacks || [];

  const [openedPacks, setOpenedPacks] = useState<Set<number>>(new Set());
  const [activePack, setActivePack] = useState<number | null>(null);
  const [openPhase, setOpenPhase] = useState<OpenPhase>('idle');
  // Rare spotlight state
  const [spotlightCard, setSpotlightCard] = useState<Card | null>(null);
  const [spotlightDismissed, setSpotlightDismissed] = useState(false);
  // Booster animation overlay
  const [animatingPackIdx, setAnimatingPackIdx] = useState<number | null>(null);
  // Prevent overlay from being accidentally closed right after cards appear
  const [overlayClickable, setOverlayClickable] = useState(false);

  const useSpotlight = false;

  function openPack(idx: number) {
    if (openedPacks.has(idx)) {
      // Re-show already opened pack immediately
      setActivePack(idx);
      setOpenPhase('revealed');
      return;
    }
    // Show booster opening animation first, then reveal
    setAnimatingPackIdx(idx);
  }

  function handleAnimFinish(idx: number) {
    setAnimatingPackIdx(null);
    setActivePack(idx);
    setSpotlightDismissed(false);

    const packCards = packs[idx];
    const rareCard = [...packCards].sort((a, b) => rarityOrder(a) - rarityOrder(b)).find(isHighRarity);

    setOverlayClickable(false);
    setTimeout(() => setOverlayClickable(true), 600);

    if (useSpotlight && rareCard) {
      setSpotlightCard(rareCard);
      setOpenPhase('rare_spotlight');
      setOpenedPacks(prev => new Set([...prev, idx]));
    } else {
      setOpenPhase('revealed');
      setOpenedPacks(prev => new Set([...prev, idx]));
    }
  }

  function dismissSpotlight() {
    setSpotlightDismissed(true);
    setTimeout(() => {
      setOpenPhase('revealed');
      setSpotlightCard(null);
    }, 350);
  }

  function closeOverlay() {
    setActivePack(null);
    setOpenPhase('idle');
    setSpotlightCard(null);
    setSpotlightDismissed(false);
  }

  function openAllRemaining() {
    const allOpened = new Set(packs.map((_, i) => i));
    setOpenedPacks(allOpened);
    if (activePack === null) {
      setActivePack(0);
      setOpenPhase('revealed');
    }
  }

  function handleProceed() {
    const pool = packs.flat();
    const result = buildDeck(pool);
    setDraftPool(pool);
    setDeck({ mainboard: result.deck, sideboard: result.sideboard, lands: result.lands });
    setSealedPacks(null);
    setScreen('deckbuilder');
  }

  const allOpened = openedPacks.size === packs.length;

  // Cards for active pack, sorted rarity → uncommon → common
  const activeCards = activePack !== null ? [...packs[activePack]].sort((a, b) => rarityOrder(a) - rarityOrder(b)) : [];
  const rareCount = activePack !== null ? packs[activePack].filter(isHighRarity).length : 0;

  const useDramaticDeal = false;

  return (
    <>
    {/* Booster animation — portal to body to escape stacking contexts */}
    {animatingPackIdx !== null && createPortal(
      <BoosterOpenAnimation onFinish={() => handleAnimFinish(animatingPackIdx!)} setCode={selectedSet} />,
      document.body
    )}
    <div className="sealed-reveal-screen animate-fade-in">

      {/* ── Background particles ── */}
      <div className="sealed-bg-particles">
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} className="sealed-bg-particle" style={{
            left: `${(i * 37 + 7) % 100}%`,
            animationDelay: `${(i * 0.41) % 3}s`,
            animationDuration: `${3 + (i * 0.5) % 4}s`,
          }} />
        ))}
      </div>

      {/* ── Top bar ── */}
      <div className="sealed-topbar">
        <div className="sealed-topbar-title">📦 Sealed Pool — Open Your Boosters</div>
        <div className="sealed-topbar-actions">
          {!allOpened && (
            <button className="btn btn-muted" onClick={openAllRemaining}>Open All</button>
          )}
          <button className="btn btn-gold" onClick={handleProceed}>Build Deck →</button>
          <button className="btn btn-muted" onClick={() => { setSealedPacks(null); setScreen('home'); }}>Quit</button>
        </div>
      </div>

      {/* ── Pack grid ── */}
      <div className="sealed-pack-grid">
        {packs.map((pack, idx) => {
          const isOpened = openedPacks.has(idx);
          const isActive = activePack === idx && openPhase !== 'idle';
          const rares = pack.filter(isHighRarity).length;
          return (
            <div
              key={idx}
              className={`sealed-pack${isActive ? ' active' : ''}${isOpened ? ' opened' : ''}`}
              onClick={() => openPack(idx)}
              title={isOpened ? `Pack ${idx + 1} — ver` : `Pack ${idx + 1} — abrir`}
            >
              {isOpened ? (
                /* Opened: show pack with cut top flying away */
                <div className="sealed-pack-img-wrap">
                  <img src={boosterImg} alt={`Pack ${idx + 1}`} className="sealed-pack-img sealed-pack-body-cut" draggable={false} />
                  <img src={boosterImg} alt="" className="sealed-pack-img sealed-pack-top-cut" draggable={false} />
                </div>
              ) : (
                <>
                  <img src={boosterImg} alt={`Pack ${idx + 1}`} className="sealed-pack-img" draggable={false} />
                </>
              )}
              <div className="sealed-pack-label">Pack {idx + 1}</div>
              {isOpened && rares > 0 && (
                <div className="sealed-pack-badge">✦ {rares}</div>
              )}
              {!isOpened && (
                <div className="sealed-pack-hint">Abrir</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Summary bar when all opened ── */}
      {allOpened && activePack === null && (
        <div className="sealed-summary-bar">
          <span>
            Pool: <strong>{packs.flat().length} cartas</strong>
            {' · '}
            <span style={{ color: '#f0c040' }}>✦ {packs.flat().filter(isHighRarity).length} rares/míticas</span>
          </span>
          <button className="btn btn-gold" onClick={handleProceed}>Build Deck →</button>
        </div>
      )}

      {/* ── Pack opening overlay ── */}
      {activePack !== null && (
        <div className="sealed-overlay" onClick={openPhase === 'revealed' && overlayClickable ? closeOverlay : undefined}>

          {/* ── Rare Spotlight (Mode C / D / F / G) ── */}
          {openPhase === 'rare_spotlight' && spotlightCard && (
            <div
              className={`rare-spotlight-overlay ${spotlightDismissed ? 'dismissing' : 'entering'}`}
              onClick={dismissSpotlight}
            >
              {/* Spotlight particles */}
              <div className="spotlight-particles">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div key={i} className={`spotlight-particle ${rarityOf(spotlightCard) === 'mythic' ? 'mythic' : 'rare'}`} style={{
                    left: `${(i * 23 + 15) % 90 + 5}%`,
                    animationDelay: `${(i * 0.18) % 1.5}s`,
                    animationDuration: `${1.2 + (i * 0.15) % 1.0}s`,
                  }} />
                ))}
              </div>

              {/* Spotlight beam */}
              <div className={`spotlight-beam ${rarityOf(spotlightCard) === 'mythic' ? 'mythic' : 'rare'}`} />

              {/* Rarity banner */}
              <div className={`spotlight-banner ${rarityOf(spotlightCard) === 'mythic' ? 'mythic' : 'rare'}`}>
                <span className="spotlight-banner-star">✦</span>
                <span className="spotlight-banner-text">
                  {rarityOf(spotlightCard) === 'mythic' ? 'MÍTICA!' : 'RARA!'}
                </span>
                <span className="spotlight-banner-star">✦</span>
              </div>

              {/* The rare card */}
              <div className="spotlight-card">
                <CardImage card={spotlightCard} size="medium" />
              </div>

              {/* Click to continue hint */}
              <div className="spotlight-hint">Clique para continuar</div>
            </div>
          )}

          {/* Cards revelados */}
          {openPhase === 'revealed' && (
            <div className="sealed-cards-panel" onClick={e => e.stopPropagation()}>
              <div className="sealed-cards-header">
                <span className="sealed-cards-title">Pack {activePack + 1}</span>
                <span className="sealed-cards-count">{activeCards.length} cartas</span>
                {rareCount > 0 && (
                  <span className="sealed-cards-rares">✦ {rareCount} rare{rareCount > 1 ? 's' : ''}/mítica{rareCount > 1 ? 's' : ''}</span>
                )}
                <button className="sealed-close-btn" onClick={closeOverlay}>✕</button>
              </div>

              <div className="sealed-cards-grid">
                {activeCards.map((card, i) => (
                  <div
                    key={i}
                    className={`sealed-card-item ${rarityOf(card)} ${useDramaticDeal ? (i % 2 === 0 ? 'deal-left' : 'deal-right') : ''}`}
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <CardImage card={card} size="medium" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
