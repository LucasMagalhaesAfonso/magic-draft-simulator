import { useState, useEffect, useRef, memo } from 'react';
import type { Card } from '../../lib/types';
import { getTokenImageUrl, preloadTokenImage } from '../../engine/token-images';
import { useAppStore } from '../../store/useAppStore';
import { ManaCostPips } from '../game/GameOverlays';
import './CardImage.css';

const LAND_COLOR_MAP: Record<string, string> = {
  Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G',
};

interface CardImageProps {
  card: Card;
  size?: 'small' | 'medium' | 'large';
  selected?: boolean;
  overrideArtUrl?: string; // For land art picker: replaces the card image
  onClick?: (card: Card) => void;
  onRightClick?: (card: Card, e: React.MouseEvent) => void;
  className?: string;
}

const CARD_BACK = 'https://backs.scryfall.io/large/59/482d0001-547e-4a13-a0f7-451e2a1b5940.jpg';

const TOKEN_COLORS: Record<string, string> = {
  W: '#d4c08a', U: '#4a90d9', B: '#6b4fa0', R: '#c0392b', G: '#27ae60',
};

const TOKEN_ICONS: Record<string, string> = {
  Dragon: '🐉', Spirit: '👻', Warrior: '⚔️', Treasure: '💎', Soldier: '🛡',
  Goblin: '👹', Zombie: '🧟', Monk: '🥋', Bird: '🦅', Elephant: '🐘',
  Kobold: '👺', Faerie: '🧚', Merfolk: '🧜', Treefolk: '🌳', Elemental: '🔥',
  Wolf: '🐺', Insect: '🦋', Saproling: '🌿', Human: '🧑', Snake: '🐍',
};

function getTokenGradient(card: any): string {
  const colors: string[] = (card as any).colors || [];
  if (colors.length === 0) {
    const name = (card.name || '').toLowerCase();
    if (name === 'treasure') return 'linear-gradient(160deg, #7a6000, #c9a520)';
    return 'linear-gradient(160deg, #3a3a4e, #1e1e30)';
  }
  if (colors.length === 1) {
    const base = TOKEN_COLORS[colors[0]] || '#444';
    return `linear-gradient(160deg, ${base}aa, ${base}55)`;
  }
  const stops = colors.map(c => TOKEN_COLORS[c] || '#444').join(', ');
  return `linear-gradient(160deg, ${stops})`;
}

export const CardImage = memo(function CardImage({ card, size = 'medium', selected, overrideArtUrl, onClick, onRightClick, className = '' }: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const landArts = useAppStore(s => s.landArts);

  const isToken = !!(card as any)._isToken;
  // Auto-resolve land art from settings if no explicit override
  const landArtUrl = !overrideArtUrl && card.name ? (() => {
    const color = LAND_COLOR_MAP[card.name];
    return color ? landArts?.[color] : undefined;
  })() : undefined;
  const imgSrc = overrideArtUrl || landArtUrl || (size === 'small' ? card.image_small : card.image_normal);
  const hasImage = !!(imgSrc && imgSrc.length > 4); // ''/undefined → no image

  // Token image: try cache first, then async fetch
  const tokenSet = (card as any).set_code || (card as any)._set || (card as any).set || 'TDM';
  const [tokenImg, setTokenImg] = useState<string | null>(
    isToken && !hasImage ? getTokenImageUrl(card.name, tokenSet) : null,
  );
  useEffect(() => {
    if (!isToken || hasImage || tokenImg) return;
    preloadTokenImage(card.name, (card as any).colors || [], tokenSet).then(url => {
      if (url) setTokenImg(url);
    });
  }, [card.name, isToken, hasImage]); // eslint-disable-line react-hooks/exhaustive-deps

  // If image is already cached by the browser, skip the placeholder flash
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    onRightClick?.(card, e);
  }

  // Tokens: if we have a fetched image, render it like a real card
  if (isToken && !hasImage && tokenImg) {
    return (
      <div
        className={`card-image card-${size} ${selected ? 'card-selected' : ''} ${className}`}
        onClick={() => onClick?.(card)}
        onContextMenu={handleContextMenu}
        title={card.name}
      >
        <img src={tokenImg} alt={card.name} loading="lazy" className="token-scryfall-img" />
        {selected && <div className="card-selected-overlay" />}
      </div>
    );
  }

  // Tokens without image yet: render emoji/gradient fallback
  if (isToken && !hasImage) {
    const keywords: string[] = (card as any).keywords || [];
    const icon = TOKEN_ICONS[card.name] || TOKEN_ICONS[(card.name || '').split(' ')[0]] || '★';
    const pt = card.power !== undefined && card.toughness !== undefined
      ? `${card.power}/${card.toughness}` : '';
    const isTreasure = card.name?.toLowerCase() === 'treasure';
    return (
      <div
        className={`card-image card-${size} token-card ${selected ? 'card-selected' : ''} ${className}`}
        style={{ background: getTokenGradient(card) }}
        onClick={() => onClick?.(card)}
        onContextMenu={handleContextMenu}
        title={card.name}
      >
        <div className="token-type-badge">{isTreasure ? 'Artifact' : 'Token'}</div>
        <div className="token-name">{card.name}</div>
        <div className="token-icon">{icon}</div>
        {keywords.length > 0 && (
          <div className="token-keywords">{keywords.slice(0, 2).join(', ')}</div>
        )}
        {pt && <div className="token-pt">{pt}</div>}
        {selected && <div className="card-selected-overlay" />}
      </div>
    );
  }

  // Non-token cards with no image: show text fallback instead of card back
  if (!isToken && !hasImage) {
    const typeLine = card.type_line || '';
    return (
      <div
        className={`card-image card-${size} ${selected ? 'card-selected' : ''} ${className}`}
        style={{ background: 'linear-gradient(160deg, #2a2a3e, #1a1a2e)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 4 }}
        onClick={() => onClick?.(card)}
        onContextMenu={handleContextMenu}
        title={card.name}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: '#e0d0b0', textAlign: 'center', lineHeight: 1.2 }}>{card.name}</div>
        <div style={{ fontSize: 8, color: '#999', marginTop: 2 }}>{typeLine}</div>
        {card.mana_cost && <div style={{ marginTop: 3, display: 'flex', justifyContent: 'center' }}><ManaCostPips cost={card.mana_cost} size={10} /></div>}
        {selected && <div className="card-selected-overlay" />}
      </div>
    );
  }

  // If no valid image URL, treat as error immediately (show card back)
  const resolvedSrc = (!error && hasImage) ? imgSrc! : CARD_BACK;
  const isResolved = error || !hasImage;

  return (
    <div
      className={`card-image card-${size} ${selected ? 'card-selected' : ''} ${className}`}
      onClick={() => onClick?.(card)}
      onContextMenu={handleContextMenu}
      title={card.name}
    >
      {!loaded && !isResolved && <div className="card-placeholder" />}
      <img
        ref={imgRef}
        src={resolvedSrc}
        alt={card.name}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        style={{ opacity: loaded || isResolved ? 1 : 0 }}
      />
      {selected && <div className="card-selected-overlay" />}
      {(card as any)._isCopy && (
        <>
          <div className="copy-badge" title={`Originally: ${(card as any)._originalCard?.name || '?'}`}>
            {(card as any)._originalCard?.name || 'COPY'}
          </div>
          <div className="copy-border-overlay" />
        </>
      )}
    </div>
  );
}, (prev, next) =>
  (prev.card as any)._uid === (next.card as any)._uid &&
  prev.card.id === next.card.id &&
  prev.size === next.size &&
  prev.selected === next.selected &&
  prev.overrideArtUrl === next.overrideArtUrl &&
  prev.className === next.className &&
  !!(prev.card as any)._isCopy === !!(next.card as any)._isCopy &&
  prev.card.image_normal === next.card.image_normal &&
  prev.card.name === next.card.name
);
