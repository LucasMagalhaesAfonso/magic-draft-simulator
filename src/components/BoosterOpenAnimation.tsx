import { useState } from 'react';
import tdmBooster from '../assets/tdm-booster-pack.png';
import ltrBooster from '../assets/ltr-booster-pack.png';
import './BoosterOpenAnimation.css';

const BOOSTER_IMAGES: Record<string, string> = {
  tdm: tdmBooster,
  ltr: ltrBooster,
};

const SET_NAMES: Record<string, string> = {
  tdm: 'Tarkir: Dragonstorm',
  ltr: 'Lord of the Rings: Tales of Middle-earth',
};

interface Props {
  onFinish: () => void;
  setCode?: string;
}

import cardBackImg from '../assets/mtg-card-back.jpg';

// Card back positions — fan spread
const BACK_CARDS = Array.from({ length: 14 }, (_, i) => {
  const angle = -28 + (i / 13) * 56;
  const rad = (angle * Math.PI) / 180;
  return { rotate: angle, x: Math.sin(rad) * 160, y: -Math.abs(Math.cos(rad)) * 40 + 20 };
});

// ─── Shared sub-components ────────────────────────────────────────────────────

function SetLabel({ setCode }: { setCode?: string }) {
  const name = (setCode && SET_NAMES[setCode]) || SET_NAMES.tdm;
  return (
    <div className="booster-set-label">
      <span className="booster-set-name">{name}</span>
      <span className="booster-set-sub">Play Booster</span>
    </div>
  );
}

function Particles({ count }: { count: number }) {
  return (
    <div className="booster-particles">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="booster-particle" style={{
          left: `${(i * 37 + 7) % 100}%`,
          animationDelay: `${(i * 0.31) % 2}s`,
          animationDuration: `${2 + (i * 0.4) % 3}s`,
        }} />
      ))}
    </div>
  );
}

function SkipBtn({ onSkip }: { onSkip: () => void }) {
  return (
    <button className="booster-skip-btn" onClick={onSkip}>Skip ▶</button>
  );
}

// ─── Main animation: Cut + Burst + Flip ───────────────────────────────────────

export function BoosterOpenAnimation({ onFinish, setCode }: Props) {
  const boosterImg = (setCode && BOOSTER_IMAGES[setCode]) || BOOSTER_IMAGES.tdm;
  const [phase, setPhase] = useState<'idle' | 'shake' | 'cut' | 'flash' | 'burst' | 'flip' | 'done'>('idle');
  const [clicked, setClicked] = useState(false);

  function handleClick() {
    if (clicked) return;
    setClicked(true);
    setPhase('shake');
    setTimeout(() => setPhase('cut'),   420);
    setTimeout(() => setPhase('flash'), 980);
    setTimeout(() => setPhase('burst'), 1180);
    setTimeout(() => setPhase('flip'),  1700);
    setTimeout(() => { setPhase('done'); onFinish(); }, 2100);
  }

  const showPack = phase !== 'burst' && phase !== 'flip' && phase !== 'done';
  const showBodyCut = phase === 'cut' || phase === 'flash';

  return (
    <div className={`booster-anim-overlay phase-${phase}`}>
      <Particles count={20} />
      <SetLabel setCode={setCode} />

      {/* Burst of card backs */}
      {(phase === 'burst' || phase === 'flip') && (
        <div className="burst-cards-container">
          {BACK_CARDS.map((card, i) => (
            <div
              key={i}
              className={`burst-card ${phase === 'flip' ? 'flipping' : ''}`}
              style={{
                left: '50%', top: '50%',
                transform: `translateX(calc(-50% + ${card.x}px)) translateY(calc(-50% + ${card.y}px)) rotate(${card.rotate}deg)`,
                animationDelay: `${i * 18}ms`,
                transitionDelay: `${i * 12}ms`,
              }}
            >
              <img src={cardBackImg} alt="" className="burst-card-img" draggable={false} />
            </div>
          ))}
        </div>
      )}

      {/* Pack — shown during idle / shake / cut / flash */}
      {showPack && (
        <div
          className={`booster-pack-wrapper ${clicked ? 'opening' : 'idle-float'}`}
          onClick={handleClick}
        >
          <div className="booster-glow-ring" />

          {/* Body — top gets clipped away when cutting */}
          <img
            src={boosterImg}
            alt="TDM Booster Pack"
            className={`booster-pack-img${showBodyCut ? ' pack-body-after-cut' : ''}`}
            draggable={false}
          />

          {/* Top slice overlay — flies away on cut (no filter to avoid double-glow rectangle) */}
          {phase === 'cut' && (
            <img
              src={boosterImg}
              alt=""
              className="pack-slice-top slicing"
              draggable={false}
            />
          )}

          {/* Golden cut line */}
          {phase === 'cut' && <div className="pack-cut-line" />}

          {!clicked && (
            <div className="booster-click-hint">
              <span className="hint-arrow">▼</span>Click to open
            </div>
          )}
        </div>
      )}

      <div className="booster-flash-overlay" />
      <SkipBtn onSkip={onFinish} />
    </div>
  );
}
