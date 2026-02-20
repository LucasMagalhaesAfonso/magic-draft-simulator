import { useState, useEffect, memo } from 'react';
import type { Card } from '../../lib/types';
import { getTokenImageUrl, preloadTokenImage } from '../../engine/token-images';
import './CardImage.css';

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

  const isToken = !!(card as any)._isToken;
  const imgSrc = overrideArtUrl || (size === 'small' ? card.image_small : card.image_normal);
  const hasImage = !!(imgSrc && imgSrc.length > 4); // ''/undefined → no image

  // Token image: try cache first, then async fetch
  const [tokenImg, setTokenImg] = useState<string | null>(
    isToken && !hasImage ? getTokenImageUrl(card.name) : null,
  );
  useEffect(() => {
    if (!isToken || hasImage || tokenImg) return;
    preloadTokenImage(card.name, (card as any).colors || []).then(url => {
      if (url) setTokenImg(url);
    });
  }, [card.name, isToken, hasImage]); // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div
      className={`card-image card-${size} ${selected ? 'card-selected' : ''} ${className}`}
      onClick={() => onClick?.(card)}
      onContextMenu={handleContextMenu}
      title={card.name}
    >
      {!loaded && !error && <div className="card-placeholder" />}
      <img
        src={error ? CARD_BACK : imgSrc}
        alt={card.name}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        style={{ opacity: loaded || error ? 1 : 0 }}
      />
      {selected && <div className="card-selected-overlay" />}
    </div>
  );
}, (prev, next) =>
  (prev.card as any)._uid === (next.card as any)._uid &&
  prev.card.id === next.card.id &&
  prev.size === next.size &&
  prev.selected === next.selected &&
  prev.overrideArtUrl === next.overrideArtUrl &&
  prev.className === next.className
);
