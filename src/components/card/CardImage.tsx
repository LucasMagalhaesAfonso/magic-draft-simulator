import { useState } from 'react';
import type { Card } from '../../lib/types';
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

export function CardImage({ card, size = 'medium', selected, overrideArtUrl, onClick, onRightClick, className = '' }: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const imgSrc = overrideArtUrl || (size === 'small' ? card.image_small : card.image_normal);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    onRightClick?.(card, e);
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
}
