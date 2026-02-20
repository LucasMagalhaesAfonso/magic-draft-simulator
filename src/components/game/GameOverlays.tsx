// GameOverlays.tsx — Interactive overlays for the game
// 1. Scry/Surveil  2. Modal  3. Targeting  4. Graveyard
// 5. Discard  6. ManaColor  7. RampChoice  8. SearchLibrary
// 9. Blight/Sacrifice  10. LookTop  11. Clash  12. Confirm  13. UnlessPay
// 14. Instant Priority Banner  15. Stack Priority Banner

import { useState } from 'react';
import type { GameActions } from '../../hooks/useGameEngine';
import { CardImage } from '../card/CardImage';
import * as CardEngine from '../../engine/cards';
import './GameOverlays.css';

// ─── Scry / Surveil Overlay ────────────────────────────────────────────────

interface ScryOverlayProps {
  pendingScry: any; // { type: 'scry'|'surveil', cards: [], choices: [] }
  onConfirm: GameActions['resolveScry'];
}

export function ScryOverlay({ pendingScry, onConfirm }: ScryOverlayProps) {
  const isSurveil = pendingScry.type === 'surveil';
  const [choices, setChoices] = useState<string[]>(pendingScry.cards.map(() => 'top'));
  // topOrder tracks the desired library order for "top" cards (indices into pendingScry.cards)
  const [topOrder, setTopOrder] = useState<number[]>(pendingScry.cards.map((_: any, i: number) => i));

  function toggle(originalIdx: number) {
    setChoices(prev => {
      const next = [...prev];
      next[originalIdx] = prev[originalIdx] === 'top' ? (isSurveil ? 'graveyard' : 'bottom') : 'top';
      return next;
    });
  }

  // Move a top-card up (earlier = closer to top of library)
  function moveUp(orderPos: number) {
    if (orderPos === 0) return;
    setTopOrder(prev => {
      const next = [...prev];
      [next[orderPos - 1], next[orderPos]] = [next[orderPos], next[orderPos - 1]];
      return next;
    });
  }

  // Move a top-card down
  function moveDown(orderPos: number) {
    setTopOrder(prev => {
      if (orderPos >= prev.length - 1) return prev;
      const next = [...prev];
      [next[orderPos], next[orderPos + 1]] = [next[orderPos + 1], next[orderPos]];
      return next;
    });
  }

  // Only the indices that are staying on top, in user's preferred order
  const topCardOrder = topOrder.filter(i => choices[i] === 'top');
  const hasMultipleTop = topCardOrder.length > 1;

  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">
          {isSurveil ? '🔍 Surveil' : '🔭 Scry'} {pendingScry.cards.length}
        </h3>
        <p className="overlay-hint">
          Click to {isSurveil ? 'send to graveyard' : 'put on the bottom'}.
          {hasMultipleTop ? ' Use ↑↓ to reorder the top of the library.' : ' Unclicked cards stay on top.'}
          <span className="overlay-keys">Enter = Confirm · Esc = Cancel</span>
        </p>
        <div className="scry-cards">
          {topOrder.map((originalIdx: number, orderPos: number) => {
            const card = pendingScry.cards[originalIdx];
            const choice = choices[originalIdx];
            return (
              <div
                key={card._uid || originalIdx}
                className={`scry-card-slot ${choice !== 'top' ? 'scry-away' : ''}`}
                onClick={() => toggle(originalIdx)}
              >
                <CardImage card={card} size="medium" />
                <div className="scry-card-label">
                  {choice === 'top' ? `⬆ Top${hasMultipleTop ? ` #${orderPos + 1}` : ''}` : isSurveil ? '☠ Graveyard' : '⬇ Bottom'}
                </div>
                {choice === 'top' && hasMultipleTop && (
                  <div className="scry-order-btns" onClick={e => e.stopPropagation()}>
                    <button className="scry-order-btn" onClick={() => moveUp(orderPos)} disabled={orderPos === 0}>↑</button>
                    <button className="scry-order-btn" onClick={() => moveDown(orderPos)} disabled={orderPos >= topCardOrder.length - 1}>↓</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          className="btn btn-gold overlay-confirm"
          onClick={() => onConfirm(choices as any[], topCardOrder)}
        >
          Confirm (Enter)
        </button>
      </div>
    </div>
  );
}

// ─── Modal Spell Picker ────────────────────────────────────────────────────

interface ModalOverlayProps {
  pendingModal: any; // { cardName, modes, chooseCount, ... }
  onConfirm: GameActions['resolveModal'];
}

function describeMode(mode: any): string {
  if (!mode) return '?';
  if (Array.isArray(mode)) {
    if (mode[0]?.description) return mode[0].description;
    return mode.map((m: any) => describeMode(m)).filter(Boolean).join('. ');
  }
  if (mode.description) return mode.description;
  const t = mode.type;
  const amt = mode.amount;
  const tgt = mode.target;
  if (t === 'damage') return `${amt} damage${tgt ? ` to ${tgt}` : ''}`;
  if (t === 'draw') return `Draw ${amt} card(s)`;
  if (t === 'destroy') return `Destroy ${tgt || 'permanent'}`;
  if (t === 'exile') return `Exile ${tgt || 'permanent'}`;
  if (t === 'bounce') return `Return ${tgt || 'permanent'} to hand`;
  if (t === 'gainLife') return `Gain ${amt} life`;
  if (t === 'counter_self') return `+${mode.power || 0}/+${mode.toughness || 0} until end of turn`;
  if (t === 'buff') return `Creature gets +${mode.power || 0}/+${mode.toughness || 0}`;
  if (t === 'tap') return `Tap ${tgt || 'permanent'}`;
  if (t === 'scry') return `Scry ${amt}`;
  if (t === 'mill') return `Mill ${amt}`;
  if (t === 'discard') return `Opponent discards ${amt}`;
  return `${t}${amt ? ` ${amt}` : ''}${tgt ? ` (${tgt})` : ''}`;
}

export function ModalOverlay({ pendingModal, onConfirm }: ModalOverlayProps) {
  const chooseCount = pendingModal.chooseCount || 1;
  const [selected, setSelected] = useState<number[]>([]);

  function toggle(i: number) {
    setSelected(prev => {
      if (prev.includes(i)) return prev.filter(x => x !== i);
      if (prev.length >= chooseCount) {
        // replace oldest if at limit
        return chooseCount === 1 ? [i] : [...prev.slice(1), i];
      }
      return [...prev, i];
    });
  }

  const ready = selected.length === chooseCount;

  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">
          {pendingModal.cardName}
        </h3>
        <p className="overlay-hint">
          Choose {chooseCount === 1 ? 'a mode' : `${chooseCount} modes`}:
          <span className="overlay-keys">Press 1–{pendingModal.modes?.length || 4} to select · Enter = Confirm</span>
        </p>
        <div className="modal-modes">
          {(pendingModal.modes || []).map((mode: any, i: number) => (
            <button
              key={i}
              className={`modal-mode-btn ${selected.includes(i) ? 'selected' : ''}`}
              onClick={() => toggle(i)}
            >
              <span className="modal-mode-num">{i + 1}</span>
              <span className="modal-mode-desc">{describeMode(mode)}</span>
            </button>
          ))}
        </div>
        <button
          className="btn btn-gold overlay-confirm"
          disabled={!ready}
          onClick={() => ready && onConfirm(selected)}
        >
          Confirm {selected.length}/{chooseCount} (Enter)
        </button>
      </div>
    </div>
  );
}

// ─── Targeting Overlay ─────────────────────────────────────────────────────
// Shows when waitingForInput.type === 'choose_target'
// Highlights valid targets on the battlefield

interface TargetingOverlayProps {
  spell: any;             // card being cast / saga triggering
  validTargets: any[];    // pre-computed list of { uid, name, type, player }
  onTarget: (target: any) => void;
  onCancel: () => void;
}

export function TargetingPrompt({
  spell, validTargets, onTarget, onCancel
}: TargetingOverlayProps) {
  return (
    <div className="targeting-prompt glass">
      <span>🎯 <strong>{spell?._targetPromptOverride || (spell?._isAdventure ? (spell.back_face?.name || spell.adventure?.name || spell.name) : (spell?.name || 'Spell'))}</strong>{spell?._targetPromptOverride ? '' : ' — choose a target'}</span>
      <button className="btn btn-muted btn-sm" onClick={onCancel}>Cancel (Esc)</button>
    </div>
  );
}

// ─── Graveyard Overlay ─────────────────────────────────────────────────────

interface GraveyardOverlayProps {
  cards: any[];
  playerId: number;
  onActivate?: (cardUid: string, abilityIdx: number) => void;
  onClose: () => void;
}

export function GraveyardOverlay({ cards, playerId, onActivate, onClose }: GraveyardOverlayProps) {
  const [zoomed, setZoomed] = useState<any>(null);

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel glass gy-panel" onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <h3 className="overlay-title">
            ☠ Graveyard {playerId === 0 ? '(You)' : '(Opponent)'}
          </h3>
          <button className="btn btn-muted btn-sm" onClick={onClose}>✕</button>
        </div>

        {cards.length === 0 && (
          <p className="overlay-hint">Graveyard is empty.</p>
        )}

        <div className="gy-grid">
          {cards.map((card: any, i: number) => {
            const graveyardAbilities = CardEngine.getGraveyardAbilities(card);
            return (
              <div
                key={card._uid || i}
                className="gy-card-slot"
                onMouseEnter={() => setZoomed(card)}
                onMouseLeave={() => setZoomed(null)}
              >
                <CardImage card={card} size="small" />
                <div className="gy-card-name">{card.name}</div>
                {playerId === 0 && graveyardAbilities.length > 0 && onActivate && (
                  graveyardAbilities.map((ab: any, idx: number) => (
                    <button
                      key={idx}
                      className="btn btn-gold btn-sm gy-activate-btn"
                      onClick={() => { onActivate(card._uid, idx); onClose(); }}
                    >
                      {ab.label || 'Activate'}
                    </button>
                  ))
                )}
              </div>
            );
          })}
        </div>

        {zoomed && (
          <div className="gy-zoom">
            <img src={zoomed.image_normal || zoomed.image_small} alt={zoomed.name} className="gy-zoom-img"
              onError={e => { e.currentTarget.src = 'https://backs.scryfall.io/large/59/482d0001-547e-4a13-a0f7-451e2a1b5940.jpg'; }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Instant Priority Banner ────────────────────────────────────────────────
interface InstantPriorityBannerProps {
  phase: string;
  onPass: () => void;
}
export function InstantPriorityBanner({ phase, onPass }: InstantPriorityBannerProps) {
  const phaseLabel: Record<string, string> = {
    upkeep: 'Upkeep', combat_begin: 'Combat Begin', post_attackers: 'After Attackers',
    post_blockers: 'After Blockers', combat_damage: 'Combat Damage', end_step: 'End Step',
  };
  return (
    <div className="instant-priority-banner glass">
      <span>⚡ Priority — {phaseLabel[phase] || phase}</span>
      <span className="ip-hint">Cast instants / activate abilities</span>
      <button className="btn btn-gold btn-sm" onClick={onPass}>Pass (Space)</button>
    </div>
  );
}

// ─── Mana cost pip renderer (for banners / tooltips) ─────────────────────────
const MANA_PIP_COLORS: Record<string, string> = {
  W: '#f8f4e8', U: '#1a5fa8', B: '#2a1a3a', R: '#c0392b', G: '#1e7c3a',
  C: '#8a8a8a', X: '#555',
};
const MANA_PIP_TEXT: Record<string, string> = {
  W: 'W', U: 'U', B: 'B', R: 'R', G: 'G', C: 'C', X: 'X',
};
export function ManaCostPips({ cost }: { cost: string }) {
  if (!cost) return null;
  const tokens = (cost.match(/\{[^}]+\}/g) || []);
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center', marginLeft: 6 }}>
      {tokens.map((t, i) => {
        const sym = t.slice(1, -1);
        const bg = MANA_PIP_COLORS[sym] ?? '#444';
        const txt = MANA_PIP_TEXT[sym] ?? sym;
        const isNum = /^\d+$/.test(sym);
        return (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 18, height: 18, borderRadius: '50%',
            background: bg, color: isNum || sym === 'C' ? '#eee' : (sym === 'W' ? '#333' : '#fff'),
            fontSize: 10, fontWeight: 700, flexShrink: 0,
            border: '1px solid rgba(255,255,255,0.2)',
          }}>{txt}</span>
        );
      })}
    </span>
  );
}

// ─── Stack Priority Banner ───────────────────────────────────────────────────
interface StackPriorityBannerProps { spellName: string; spellCost?: string; spellType?: string; onPass: () => void; }
export function StackPriorityBanner({ spellName, spellCost, spellType, onPass }: StackPriorityBannerProps) {
  return (
    <div className="instant-priority-banner stack-priority-banner glass">
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        📚 Stack: <strong>{spellName}</strong>
        {spellCost && <ManaCostPips cost={spellCost} />}
        {spellType && <span className="ip-hint" style={{ marginLeft: 6 }}>({spellType})</span>}
      </span>
      <span className="ip-hint">You can respond</span>
      <button className="btn btn-gold btn-sm" onClick={onPass}>Let Resolve (Space)</button>
    </div>
  );
}

// ─── Blocker Confirm Banner ──────────────────────────────────────────────────
interface BlockerConfirmBannerProps { attackerCount: number; blockerCount: number; onConfirm: () => void; }
export function BlockerConfirmBanner({ attackerCount, blockerCount, onConfirm }: BlockerConfirmBannerProps) {
  return (
    <div className="instant-priority-banner glass">
      <span>🛡 Declare Blockers — {attackerCount} attacker{attackerCount !== 1 ? 's' : ''}</span>
      <span className="ip-hint">Click your untapped creatures, then an attacker ({blockerCount} assigned)</span>
      <button className="btn btn-gold btn-sm" onClick={onConfirm}>Confirm (Space)</button>
    </div>
  );
}

// ─── Discard Overlay ─────────────────────────────────────────────────────────
interface DiscardOverlayProps {
  hand: any[]; amount: number; title?: string; hint?: string; optional?: boolean;
  onConfirm: (cardUids: string[]) => void;
}
export function DiscardOverlay({ hand, amount, title, hint, optional, onConfirm }: DiscardOverlayProps) {
  const [selected, setSelected] = useState<string[]>([]);
  function toggle(uid: string) {
    setSelected(prev =>
      prev.includes(uid) ? prev.filter(x => x !== uid) :
      prev.length < amount ? [...prev, uid] : [...prev.slice(1), uid]
    );
  }
  const ready = optional ? true : selected.length === amount;
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">{title || `🗑 Discard ${amount}`}</h3>
        <p className="overlay-hint">{hint || `Choose ${amount} card${amount !== 1 ? 's' : ''} to discard.`}</p>
        <div className="scry-cards">
          {hand.map((card: any) => (
            <div key={card._uid} className={`scry-card-slot ${selected.includes(card._uid) ? 'scry-away' : ''}`} onClick={() => toggle(card._uid)}>
              <CardImage card={card} size="medium" />
              <div className="scry-card-label">{selected.includes(card._uid) ? '🗑 Discard' : card.name}</div>
            </div>
          ))}
        </div>
        <button className="btn btn-gold overlay-confirm" disabled={!ready} onClick={() => ready && onConfirm(selected)}>
          {optional && selected.length === 0 ? 'Skip' : `Discard ${selected.length}/${amount}`} (Enter)
        </button>
      </div>
    </div>
  );
}

// ─── Mana Color Overlay ──────────────────────────────────────────────────────
const MANA_LABELS: Record<string, string> = { W:'☀ White', U:'💧 Blue', B:'💀 Black', R:'🔥 Red', G:'🌲 Green', C:'◇ Colorless' };
interface ManaColorOverlayProps { colors: string[]; onConfirm: (color: string) => void; }
export function ManaColorOverlay({ colors, onConfirm }: ManaColorOverlayProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass" style={{ maxWidth: 400 }}>
        <h3 className="overlay-title">Choose Mana Color</h3>
        <div className="mana-color-choices">
          {colors.map(c => (
            <button key={c} className={`btn mana-color-btn mana-btn-${c}`} onClick={() => onConfirm(c)}>
              {MANA_LABELS[c] || c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Search Library / Ramp Choice Overlay ───────────────────────────────────
interface SearchLibraryOverlayProps {
  candidates: any[]; optional?: boolean; title?: string; hint?: string;
  onConfirm: (cardUid: string | null) => void;
}
export function SearchLibraryOverlay({ candidates, optional, title, hint, onConfirm }: SearchLibraryOverlayProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">{title || '📚 Search Library'}</h3>
        <p className="overlay-hint">{hint || 'Choose a card.'}</p>
        <div className="scry-cards">
          {candidates.map((card: any, i: number) => (
            <div key={card._uid || card.id || i} className="scry-card-slot" onClick={() => onConfirm(card._uid || card.id)}>
              <CardImage card={card} size="medium" />
              <div className="scry-card-label">{card.name}</div>
            </div>
          ))}
        </div>
        {optional && (
          <button className="btn btn-muted overlay-confirm" onClick={() => onConfirm(null)}>Fail to Find</button>
        )}
      </div>
    </div>
  );
}

// ─── Creature Choice Overlay (Blight / Sacrifice / Buff) ────────────────────
interface CreatureChoiceOverlayProps {
  creatures: any[]; title?: string; hint?: string; optional?: boolean;
  onConfirm: (cardUid: string | null) => void;
}
export function CreatureChoiceOverlay({ creatures, title, hint, optional, onConfirm }: CreatureChoiceOverlayProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">{title || 'Choose Creature'}</h3>
        <p className="overlay-hint">{hint || 'Click a creature.'}</p>
        <div className="scry-cards">
          {creatures.map((c: any, i: number) => (
            <div key={c._uid || i} className="scry-card-slot" onClick={() => onConfirm(c._uid)}>
              <CardImage card={c} size="medium" />
              <div className="scry-card-label">{c.name} {c.power}/{c.toughness}</div>
            </div>
          ))}
        </div>
        {optional && <button className="btn btn-muted overlay-confirm" onClick={() => onConfirm(null)}>Skip</button>}
      </div>
    </div>
  );
}

// ─── Bounce Multi-Select Overlay (up_to: N bounce) ───────────────────────────
interface BounceMultiOverlayProps {
  permanents: any[]; maxBounce: number; title?: string;
  onConfirm: (uids: string[]) => void;
}
export function BounceMultiOverlay({ permanents, maxBounce, title, onConfirm }: BounceMultiOverlayProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (uid: string) => {
    setSelected(prev =>
      prev.includes(uid) ? prev.filter(u => u !== uid)
      : prev.length >= maxBounce ? [...prev.slice(1), uid]
      : [...prev, uid]
    );
  };
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">{title || `↩ Bounce — Choose up to ${maxBounce} permanents`}</h3>
        <p className="overlay-hint">Click to select. {selected.length}/{maxBounce} selected.</p>
        <div className="scry-cards">
          {permanents.map((c: any, i: number) => (
            <div
              key={c._uid || i}
              className={`scry-card-slot${selected.includes(c._uid) ? ' scry-card-selected' : ''}`}
              onClick={() => toggle(c._uid)}
            >
              <CardImage card={c} size="medium" />
              <div className="scry-card-label">{c.name}</div>
              {selected.includes(c._uid) && <div className="bounce-selected-badge">✓</div>}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary overlay-confirm" onClick={() => onConfirm(selected)} disabled={selected.length === 0}>
            Bounce ({selected.length})
          </button>
          <button className="btn btn-muted" onClick={() => onConfirm([])}>Skip</button>
        </div>
      </div>
    </div>
  );
}

// ─── Distribute Counters Overlay ─────────────────────────────────────────────
// Click creature to assign +1 counter, click again to remove. Budget tracked.
interface DistributeCountersOverlayProps {
  creatures: any[]; totalAmount: number; counterType?: string;
  onConfirm: (distribution: Record<string, number>) => void;
}
export function DistributeCountersOverlay({ creatures, totalAmount, counterType = '+1/+1', onConfirm }: DistributeCountersOverlayProps) {
  const [dist, setDist] = useState<Record<string, number>>({});
  const spent = Object.values(dist).reduce((a, b) => a + b, 0);
  const remaining = totalAmount - spent;

  const add = (uid: string) => {
    if (remaining <= 0) return;
    setDist(prev => ({ ...prev, [uid]: (prev[uid] || 0) + 1 }));
  };
  const remove = (uid: string) => {
    setDist(prev => {
      const cur = prev[uid] || 0;
      if (cur <= 0) return prev;
      const next = { ...prev, [uid]: cur - 1 };
      if (next[uid] === 0) delete next[uid];
      return next;
    });
  };

  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">⬆ Distribute {counterType} Counters</h3>
        <p className="overlay-hint">
          Click to add a counter · Right-click to remove · Budget: <strong>{remaining}/{totalAmount}</strong> remaining
        </p>
        <div className="scry-cards">
          {creatures.map((c: any, i: number) => {
            const count = dist[c._uid] || 0;
            return (
              <div
                key={c._uid || i}
                className={`scry-card-slot${count > 0 ? ' scry-card-selected' : ''}`}
                onClick={() => add(c._uid)}
                onContextMenu={e => { e.preventDefault(); remove(c._uid); }}
              >
                <CardImage card={c} size="medium" />
                <div className="scry-card-label">{c.name} {c.power}/{c.toughness}</div>
                {count > 0 && <div className="bounce-selected-badge">+{count}</div>}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary overlay-confirm" onClick={() => onConfirm(dist)} disabled={spent === 0}>
            Confirm ({spent}/{totalAmount})
          </button>
          {spent < totalAmount && spent > 0 && (
            <button className="btn btn-muted" onClick={() => onConfirm(dist)}>Use Fewer</button>
          )}
          {spent === 0 && (
            <button className="btn btn-muted" onClick={() => onConfirm({})}>Skip</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Look Top Overlay ─────────────────────────────────────────────────────────
interface LookTopOverlayProps {
  cards: any[]; pickCount?: number; title?: string; hint?: string;
  onConfirm: (choices: string[]) => void;
}
export function LookTopOverlay({ cards, pickCount, title, hint, onConfirm }: LookTopOverlayProps) {
  const maxKeep = pickCount ?? cards.length;
  const [choices, setChoices] = useState<string[]>(cards.map(() => 'keep'));
  const keptCount = choices.filter(c => c === 'keep').length;
  function toggle(i: number) {
    setChoices(prev => {
      const next = [...prev];
      if (next[i] === 'keep') { next[i] = 'bottom'; }
      else if (keptCount < maxKeep) { next[i] = 'keep'; }
      return next;
    });
  }
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">{title || `👁 Top ${cards.length} Cards`}</h3>
        <p className="overlay-hint">{hint || `Keep up to ${maxKeep}. Click to bottom.`}</p>
        <div className="scry-cards">
          {cards.map((card: any, i: number) => (
            <div key={card._uid || i} className={`scry-card-slot ${choices[i] === 'bottom' ? 'scry-away' : ''}`} onClick={() => toggle(i)}>
              <CardImage card={card} size="medium" />
              <div className="scry-card-label">{choices[i] === 'keep' ? '⬆ Keep' : '⬇ Bottom'}</div>
            </div>
          ))}
        </div>
        <button className="btn btn-gold overlay-confirm" onClick={() => onConfirm(choices)}>Confirm (Enter)</button>
      </div>
    </div>
  );
}

// ─── Clash Overlay ───────────────────────────────────────────────────────────
interface ClashOverlayProps {
  myCard: any; oppCard: any; myCmc: number; oppCmc: number; won: boolean; cardName: string;
  onConfirm: (keepOnTop: boolean) => void;
}
export function ClashOverlay({ myCard, oppCard, myCmc, oppCmc, won, cardName, onConfirm }: ClashOverlayProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">⚔ Clash — {cardName}</h3>
        <p className="overlay-hint">{won ? '✅ You won!' : '❌ You lost.'}</p>
        <div className="clash-cards">
          <div className="clash-side">
            <div className="clash-label">You ({myCmc} CMC)</div>
            {myCard && <CardImage card={myCard} size="medium" />}
            <div className="clash-cmc">{myCard?.name || '—'}</div>
          </div>
          <div className="clash-vs">VS</div>
          <div className="clash-side">
            <div className="clash-label">Opp ({oppCmc} CMC)</div>
            {oppCard && <CardImage card={oppCard} size="medium" />}
            <div className="clash-cmc">{oppCard?.name || '—'}</div>
          </div>
        </div>
        <p className="overlay-hint" style={{ marginTop: 12 }}>Put your card on...</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onConfirm(true)}>⬆ Top</button>
          <button className="btn btn-muted" style={{ flex: 1 }} onClick={() => onConfirm(false)}>⬇ Bottom</button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Optional Overlay ────────────────────────────────────────────────
interface ConfirmOptionalProps { message: string; onConfirm: (confirmed: boolean) => void; }
export function ConfirmOptionalOverlay({ message, onConfirm }: ConfirmOptionalProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass" style={{ maxWidth: 420, textAlign: 'center' }}>
        <h3 className="overlay-title">❓ Optional Effect</h3>
        <p className="overlay-hint" style={{ fontSize: 15, marginBottom: 20 }}>{message}</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onConfirm(true)}>✅ Yes</button>
          <button className="btn btn-muted" style={{ flex: 1 }} onClick={() => onConfirm(false)}>❌ Skip</button>
        </div>
      </div>
    </div>
  );
}

// ─── Unless Pay Overlay ──────────────────────────────────────────────────────
interface UnlessPayOverlayProps { spell: any; costStr: string; onConfirm: (shouldPay: boolean) => void; }
export function UnlessPayOverlay({ spell, costStr, onConfirm }: UnlessPayOverlayProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass" style={{ maxWidth: 420, textAlign: 'center' }}>
        <h3 className="overlay-title">💸 Pay {costStr}?</h3>
        <p className="overlay-hint"><strong>{spell?.name}</strong> — pay {costStr} to prevent?</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onConfirm(true)}>✅ Pay</button>
          <button className="btn btn-muted" style={{ flex: 1 }} onClick={() => onConfirm(false)}>❌ Don't Pay</button>
        </div>
      </div>
    </div>
  );
}

// ─── Mill Land Choice Overlay ────────────────────────────────────────────────
interface MillLandChoiceOverlayProps { landName: string; onConfirm: (choice: 'land' | 'counter') => void; }
export function MillLandChoiceOverlay({ landName, onConfirm }: MillLandChoiceOverlayProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass" style={{ maxWidth: 420, textAlign: 'center' }}>
        <h3 className="overlay-title">🌊 Land Milled: {landName}</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onConfirm('land')}>🌳 Return to Hand</button>
          <button className="btn btn-muted" style={{ flex: 1 }} onClick={() => onConfirm('counter')}>⬆ +1/+1 Counter Instead</button>
        </div>
      </div>
    </div>
  );
}

// ─── Endure Choice Overlay ───────────────────────────────────────────────────
interface EndureChoiceOverlayProps { amount: number; onConfirm: (choice: 'counters' | 'tokens') => void; }
export function EndureChoiceOverlay({ amount, onConfirm }: EndureChoiceOverlayProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass" style={{ maxWidth: 420, textAlign: 'center' }}>
        <h3 className="overlay-title">🛡 Endure — Choose</h3>
        <p className="overlay-hint">Distribute {amount} counters or get {amount} tokens.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onConfirm('counters')}>⬆ +1/+1 Counters</button>
          <button className="btn btn-muted" style={{ flex: 1 }} onClick={() => onConfirm('tokens')}>🐾 Tokens</button>
        </div>
      </div>
    </div>
  );
}

// ─── Ability Modal ───────────────────────────────────────────────────────────
// Shown on double-click of creatures/planeswalkers with activated abilities

interface AbilityModalProps {
  card: any;
  abilities: any[];      // activated abilities array
  onActivate: (abilityIdx: number) => void;
  onClose: () => void;
}

function describeAbility(ab: any): string {
  if (ab.text) return ab.text;
  const cost = ab.cost || {};
  const costParts: string[] = [];
  if (cost.tap) costParts.push('{T}');
  if (cost.sacrifice) costParts.push('Sacrifice');
  if (cost.loyalty !== undefined) costParts.push(cost.loyalty >= 0 ? `+${cost.loyalty}` : `${cost.loyalty}`);
  if (cost.mana) costParts.push(cost.mana);
  if (cost.life) costParts.push(`Pay ${cost.life} life`);
  const effects = (ab.effects || []).map((e: any) => e.type || '?').join(', ');
  return `${costParts.join(', ')}: ${effects || 'Activate'}`;
}

export function AbilityModal({ card, abilities, onActivate, onClose }: AbilityModalProps) {
  const isPlaneswalker = (card.type_line || '').includes('Planeswalker');
  const currentLoyalty = card._loyalty;

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel glass" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <h3 className="overlay-title">
            {isPlaneswalker ? '🌟' : '⚡'} {card.name}
            {isPlaneswalker && currentLoyalty !== undefined && (
              <span style={{
                marginLeft: 10, background: 'rgba(230,100,0,0.85)', color: '#fff',
                borderRadius: 10, padding: '2px 10px', fontSize: 14, fontWeight: 800,
              }}>
                ★ {currentLoyalty}
              </span>
            )}
          </h3>
          <button className="btn btn-muted btn-sm" onClick={onClose}>✕</button>
        </div>
        <p className="overlay-hint">{isPlaneswalker ? 'Choose a loyalty ability:' : 'Choose an ability to activate:'}</p>
        <div className="modal-modes">
          {abilities.map((ab: any, i: number) => {
            const cost = ab.cost || {};
            const loyaltyCost = cost.loyalty;
            const isPositive = typeof loyaltyCost === 'number' && loyaltyCost >= 0;
            const costLabel = typeof loyaltyCost === 'number'
              ? (loyaltyCost >= 0 ? `+${loyaltyCost}` : `${loyaltyCost}`)
              : null;
            return (
              <button
                key={i}
                className="modal-mode-btn"
                onClick={() => { onActivate(i); onClose(); }}
                style={isPlaneswalker ? { gap: 10 } : undefined}
              >
                {isPlaneswalker && costLabel !== null ? (
                  <span style={{
                    background: isPositive ? 'rgba(39,174,96,0.85)' : 'rgba(192,57,43,0.85)',
                    color: '#fff', borderRadius: 6, padding: '2px 8px',
                    fontWeight: 800, fontSize: 14, minWidth: 32, textAlign: 'center',
                    flexShrink: 0,
                  }}>{costLabel}</span>
                ) : (
                  <span className="modal-mode-num">{i + 1}</span>
                )}
                <span className="modal-mode-desc">{describeAbility(ab)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Trigger Cost Overlay ────────────────────────────────────────────────────
interface TriggerCostOverlayProps { triggerName: string; costDesc?: string; onConfirm: (choice: 'pay' | 'skip') => void; }
export function TriggerCostOverlay({ triggerName, costDesc, onConfirm }: TriggerCostOverlayProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass" style={{ maxWidth: 420, textAlign: 'center' }}>
        <h3 className="overlay-title">⚡ Trigger: {triggerName}</h3>
        {costDesc && <p className="overlay-hint">Pay {costDesc} to use?</p>}
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onConfirm('pay')}>✅ Pay & Trigger</button>
          <button className="btn btn-muted" style={{ flex: 1 }} onClick={() => onConfirm('skip')}>❌ Skip</button>
        </div>
      </div>
    </div>
  );
}

// ─── Exile Overlay ────────────────────────────────────────────────────────────
interface ExileOverlayProps { cards: any[]; playerId: number; onClose: () => void; }
export function ExileOverlay({ cards, playerId, onClose }: ExileOverlayProps) {
  const [zoomed, setZoomed] = useState<any>(null);
  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel glass gy-panel" onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <h3 className="overlay-title">✨ Exile — {playerId === 0 ? 'Your' : "Opponent's"} ({cards.length})</h3>
          <button className="btn btn-muted btn-sm" onClick={onClose}>✕</button>
        </div>
        {cards.length === 0
          ? <p className="overlay-hint">Exile is empty.</p>
          : (
            <div className="gy-grid">
              {cards.map((card: any) => (
                <div
                  key={card._uid}
                  className="gy-card-slot"
                  onMouseEnter={() => setZoomed(card)}
                  onMouseLeave={() => setZoomed(null)}
                >
                  <img
                    src={card.image_small || card.image_normal}
                    alt={card.name}
                    style={{ width: 80, borderRadius: 6, opacity: 0.85, border: '1px solid #8a2be2' }}
                    onError={e => { e.currentTarget.src = 'https://backs.scryfall.io/large/59/482d0001-547e-4a13-a0f7-451e2a1b5940.jpg'; }}
                  />
                  <div className="gy-card-name">{card.name}</div>
                </div>
              ))}
            </div>
          )
        }
        {zoomed && (
          <div className="gy-zoom">
            <img src={zoomed.image_normal} alt={zoomed.name} className="gy-zoom-img"
              onError={e => { e.currentTarget.src = 'https://backs.scryfall.io/large/59/482d0001-547e-4a13-a0f7-451e2a1b5940.jpg'; }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Graveyard Multi-Select Overlay ──────────────────────────────────────────
// Used for graveyard_card_choice: select up to N cards from a single graveyard

interface GraveyardMultiSelectOverlayProps {
  cards: any[];
  amount: number;     // max selectable
  minAmount: number;  // min required (0 = optional)
  title?: string;
  onConfirm: (uids: string[]) => void;
}

export function GraveyardMultiSelectOverlay({ cards, amount, minAmount, title, onConfirm }: GraveyardMultiSelectOverlayProps) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(uid: string) {
    setSelected(prev =>
      prev.includes(uid) ? prev.filter(x => x !== uid) :
      prev.length < amount ? [...prev, uid] : [...prev.slice(1), uid]
    );
  }

  const ready = selected.length >= minAmount;

  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">{title || `☠ Exile from Graveyard`}</h3>
        <p className="overlay-hint">
          {amount === 1
            ? 'Click a card to exile.'
            : `Select up to ${amount} card${amount !== 1 ? 's' : ''}. (${selected.length}/${amount} selected)`
          }
        </p>
        <div className="scry-cards">
          {cards.map((card: any, i: number) => (
            <div
              key={card._uid || i}
              className={`scry-card-slot ${selected.includes(card._uid) ? 'scry-away' : ''}`}
              onClick={() => toggle(card._uid)}
            >
              <CardImage card={card} size="medium" />
              <div className="scry-card-label">
                {selected.includes(card._uid) ? '✓ Exile' : card.name}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            className="btn btn-gold overlay-confirm"
            disabled={!ready}
            onClick={() => ready && onConfirm(selected)}
          >
            Exile {selected.length} card{selected.length !== 1 ? 's' : ''} (Enter)
          </button>
          {minAmount === 0 && (
            <button className="btn btn-muted" onClick={() => onConfirm([])}>Skip</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Combat Arrows SVG ────────────────────────────────────────────────────────
// Draws animated dashed arrows from each blocker to its assigned attacker
interface CombatArrowsProps {
  blockers: Record<string, string>; // blockerUid -> attackerUid
}
export function CombatArrows({ blockers }: CombatArrowsProps) {
  const entries = Object.entries(blockers);
  if (entries.length === 0) return null;

  // Build arrows from DOM element positions
  const arrows: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
  for (const [blockerUid, attackerUid] of entries) {
    const blockerEl = document.querySelector(`[data-uid="${blockerUid}"]`);
    const attackerEl = document.querySelector(`[data-uid="${attackerUid}"]`);
    if (!blockerEl || !attackerEl) continue;
    const br = blockerEl.getBoundingClientRect();
    const ar = attackerEl.getBoundingClientRect();
    arrows.push({
      x1: br.left + br.width / 2,
      y1: br.top + br.height / 2,
      x2: ar.left + ar.width / 2,
      y2: ar.top + ar.height / 2,
      key: `${blockerUid}->${attackerUid}`,
    });
  }

  if (arrows.length === 0) return null;

  return (
    <svg
      className="combat-arrows-svg"
      style={{
        position: 'fixed', inset: 0, width: '100vw', height: '100vh',
        pointerEvents: 'none', zIndex: 200,
      }}
    >
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#e74c3c" />
        </marker>
      </defs>
      {arrows.map(a => (
        <line
          key={a.key}
          x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
          stroke="#e74c3c"
          strokeWidth={2.5}
          strokeDasharray="8 4"
          markerEnd="url(#arrowhead)"
          style={{ animation: 'combatArrowDash 0.6s linear infinite' }}
        />
      ))}
    </svg>
  );
}
