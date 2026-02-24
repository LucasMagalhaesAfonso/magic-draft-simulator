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
  const [topOrder, setTopOrder] = useState<number[]>(pendingScry.cards.map((_: any, i: number) => i));

  function toggle(originalIdx: number) {
    setChoices(prev => {
      const next = [...prev];
      next[originalIdx] = prev[originalIdx] === 'top' ? (isSurveil ? 'graveyard' : 'bottom') : 'top';
      return next;
    });
  }

  function moveUp(orderPos: number) {
    if (orderPos === 0) return;
    setTopOrder(prev => { const next = [...prev]; [next[orderPos - 1], next[orderPos]] = [next[orderPos], next[orderPos - 1]]; return next; });
  }
  function moveDown(orderPos: number) {
    setTopOrder(prev => { if (orderPos >= prev.length - 1) return prev; const next = [...prev]; [next[orderPos], next[orderPos + 1]] = [next[orderPos + 1], next[orderPos]]; return next; });
  }

  const topCardOrder = topOrder.filter(i => choices[i] === 'top');
  const awayCards = topOrder.filter(i => choices[i] !== 'top');
  const hasMultipleTop = topCardOrder.length > 1;
  const awayLabel = isSurveil ? '☠ Graveyard' : '⬇ Bottom';
  const awayColor = isSurveil ? '#e74c3c' : '#e67e22';

  return (
    <div className="scry-arena-overlay">
      {/* Title */}
      <div className="scry-arena-header">
        <span className="scry-arena-title">{isSurveil ? 'Surveil' : 'Scry'} {pendingScry.cards.length}</span>
        <span className="scry-arena-hint">Click a card to toggle · {hasMultipleTop ? 'Use ↑↓ to reorder · ' : ''}Enter = Confirm</span>
      </div>

      {/* Two zones */}
      <div className="scry-arena-zones">
        {/* KEEP zone */}
        <div className="scry-arena-zone scry-zone-top">
          <div className="scry-zone-label" style={{ color: '#2ecc71' }}>⬆ Keep on Top</div>
          <div className="scry-arena-cards">
            {topCardOrder.length === 0
              ? <div className="scry-zone-empty">No cards</div>
              : topCardOrder.map((originalIdx, orderPos) => {
                  const card = pendingScry.cards[originalIdx];
                  return (
                    <div key={card._uid || originalIdx} className="scry-arena-card scry-keep" onClick={() => toggle(originalIdx)}>
                      <CardImage card={card} size="large" />
                      <div className="scry-arena-card-label" style={{ color: '#2ecc71' }}>
                        {hasMultipleTop ? `#${orderPos + 1} ` : ''}⬆ Top
                      </div>
                      {hasMultipleTop && (
                        <div className="scry-order-btns" onClick={e => e.stopPropagation()}>
                          <button className="scry-order-btn" onClick={() => moveUp(orderPos)} disabled={orderPos === 0}>↑</button>
                          <button className="scry-order-btn" onClick={() => moveDown(orderPos)} disabled={orderPos >= topCardOrder.length - 1}>↓</button>
                        </div>
                      )}
                    </div>
                  );
                })
            }
          </div>
        </div>

        {/* AWAY zone */}
        <div className="scry-arena-zone scry-zone-away">
          <div className="scry-zone-label" style={{ color: awayColor }}>{awayLabel}</div>
          <div className="scry-arena-cards">
            {awayCards.length === 0
              ? <div className="scry-zone-empty">No cards</div>
              : awayCards.map(originalIdx => {
                  const card = pendingScry.cards[originalIdx];
                  return (
                    <div key={card._uid || originalIdx} className="scry-arena-card scry-away-card" onClick={() => toggle(originalIdx)}>
                      <CardImage card={card} size="large" />
                      <div className="scry-arena-card-label" style={{ color: awayColor }}>{awayLabel}</div>
                    </div>
                  );
                })
            }
          </div>
        </div>
      </div>

      <button className="btn btn-gold scry-arena-confirm" onClick={() => onConfirm(choices as any[], topCardOrder)}>
        Confirm (Enter)
      </button>
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
  // Mode object { label, effects } — describe its effects
  if (mode.label && Array.isArray(mode.effects)) {
    const desc = mode.effects.map((e: any) => describeMode(e)).filter(Boolean).join('. ');
    return desc || mode.label;
  }
  if (mode.description) return mode.description;
  const t = mode.type;
  if (!t) return '?';
  const rawAmt = mode.amount;
  const tgt = mode.target;

  // Human-readable amount display
  const amtLabel = (v: any): string => {
    if (v === 'creature_count') return 'X (creatures you control)';
    if (v === 'lands_count') return 'X (lands you control)';
    if (v === 'vivid') return 'X (vivid colors)';
    if (v === 'X') return 'X';
    return String(v ?? '');
  };

  // Human-readable target display
  const tgtLabel = (v: string | undefined): string => {
    if (!v) return '';
    const map: Record<string, string> = {
      creature: 'target creature',
      own_creature: 'target creature you control',
      own_nonlegendary_creature: 'target non-legendary creature you control',
      opponent_creature: "target opponent's creature",
      creature_with_flying: 'target creature with flying',
      creature_or_planeswalker: 'target creature or planeswalker',
      opponent_creature_or_planeswalker: "target opponent's creature or planeswalker",
      artifact: 'target artifact',
      enchantment: 'target enchantment',
      permanent: 'target permanent',
      nonland_permanent: 'target non-land permanent',
      any: 'any target',
      player: 'target player',
      opponent: 'target opponent',
      creature_spell: 'target creature spell',
      noncreature_spell: 'target non-creature spell',
      spell: 'target spell',
      own_creatures: 'all creatures you control',
      opponent_creatures: "all opponent's creatures",
      all_creatures: 'all creatures',
    };
    return map[v] || v.replace(/_/g, ' ');
  };

  if (t === 'damage') return `Deals ${amtLabel(rawAmt)} damage to ${tgtLabel(tgt) || 'target'}`;
  if (t === 'draw') return `Draw ${rawAmt} card${rawAmt !== 1 ? 's' : ''}`;
  if (t === 'destroy') return `Destroy ${tgtLabel(tgt) || 'permanent'}`;
  if (t === 'exile') return `Exile ${tgtLabel(tgt) || 'permanent'}`;
  if (t === 'bounce') return `Return ${tgtLabel(tgt) || 'permanent'} to hand`;
  if (t === 'gainLife' || t === 'gain_life') return `Gain ${rawAmt} life`;
  if (t === 'loseLife') return `Lose ${rawAmt} life`;
  if (t === 'counter_self') {
    const n = mode.amount || 1;
    return `Put ${n} +1/+1 counter${n !== 1 ? 's' : ''} on this creature`;
  }
  if (t === 'buff') {
    const dur = mode.duration === 'end_of_turn' ? ' until end of turn' : '';
    return `${tgtLabel(tgt) || 'Creature'} gets +${mode.power || 0}/+${mode.toughness || 0}${dur}`;
  }
  if (t === 'buff_all') {
    const dur = mode.duration === 'end_of_turn' ? ' until end of turn' : '';
    return `${tgtLabel(tgt) || 'All creatures'} get +${mode.power || 0}/+${mode.toughness || 0}${dur}`;
  }
  if (t === 'debuff' || t === 'debuff_all') {
    const dur = mode.duration === 'end_of_turn' ? ' until end of turn' : '';
    return `${tgtLabel(tgt) || 'Creature'} gets ${mode.power || 0}/${mode.toughness || 0}${dur}`;
  }
  if (t === 'tap') return `Tap ${tgtLabel(tgt) || 'permanent'}`;
  if (t === 'untap') return `Untap ${tgtLabel(tgt) || 'permanent'}`;
  if (t === 'scry') return `Scry ${rawAmt}`;
  if (t === 'mill') return `Mill ${rawAmt}`;
  if (t === 'discard') return `Opponent discards ${rawAmt} card${rawAmt !== 1 ? 's' : ''}`;
  if (t === 'surveil') return `Surveil ${rawAmt}`;
  if (t === 'fight') return `${tgtLabel(tgt) || 'Target creature'} fights another creature`;
  if (t === 'create_token') return `Create ${mode.count || 1} ${mode.name || ''} token${(mode.count || 1) !== 1 ? 's' : ''}`;
  if (t === 'ramp') return `Search library for a basic land, put it onto battlefield`;
  if (t === 'search_library') return `Search library for a ${tgt || 'card'}`;
  if (t === 'counter') {
    if (tgt === 'creature_spell') return 'Counter target creature spell';
    if (tgt === 'noncreature_spell') return 'Counter target non-creature spell';
    if (tgt === 'spell') return 'Counter target spell';
    return `Counter ${tgtLabel(tgt) || 'spell'}`;
  }
  if (t === 'return_from_graveyard') return `Return ${tgtLabel(tgt) || 'card'} from graveyard to hand`;
  if (t === 'damage_all') return `Deals ${amtLabel(rawAmt)} damage to all ${tgtLabel(tgt) || 'creatures'}`;
  if (t === 'grant') return `${tgtLabel(tgt) || 'Target'} gains ${(mode.keywords || []).join(', ')}`;
  if (t === 'counter_all') return `Put +1/+1 counters on all ${tgtLabel(tgt) || 'creatures'}`;
  if (t === 'sacrifice') return `Opponent sacrifices ${tgtLabel(tgt) || 'a permanent'}`;
  // triggered: describe its sub-effects
  if (t === 'triggered') {
    const eventDesc: Record<string, string> = {
      upkeep: 'At the beginning of your upkeep',
      end_step: 'At end of turn',
      attacks: 'Whenever attacks',
      combat_damage_player: 'Whenever deals combat damage to a player',
      counter_placed: 'Whenever a counter is placed',
    };
    const prefix = (mode.event && eventDesc[mode.event]) || `Whenever ${(mode.event || '').replace(/_/g, ' ')}`;
    const subDesc = (mode.effects || []).map((e: any) => describeMode(e)).filter(Boolean).join('. ');
    return subDesc ? `${prefix}: ${subDesc}` : prefix;
  }
  // static: describe by ability name
  if (t === 'static') {
    const abilityDescs: Record<string, string> = {
      double_attack_triggers: 'Attack triggers trigger an additional time',
      anthem: `All your creatures get +${mode.power || 1}/+${mode.toughness || 0}`,
      play_lands_from_graveyard: 'You may play lands from your graveyard',
    };
    return abilityDescs[mode.ability] || `Static: ${(mode.ability || '').replace(/_/g, ' ')}`;
  }
  // Fallback: clean underscores (guard against null/undefined t)
  return `${String(t).replace(/_/g, ' ')}${rawAmt ? ` ${amtLabel(rawAmt)}` : ''}${tgt ? ` — ${tgtLabel(tgt)}` : ''}`;
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
              {mode?.label && <span className="modal-mode-label">{mode.label}</span>}
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
  onSkipTarget?: () => void;  // If provided, show "Cast without target" for optional targeting
}

export function TargetingPrompt({
  spell, validTargets, onTarget, onCancel, onSkipTarget
}: TargetingOverlayProps) {
  return (
    <div className="targeting-prompt glass">
      <span>🎯 <strong>{spell?._targetPromptOverride || (spell?._isAdventure ? (spell.back_face?.name || spell.adventure?.name || spell.name) : (spell?.name || 'Spell'))}</strong>{spell?._targetPromptOverride ? '' : (onSkipTarget ? ' — choose a target (optional)' : ' — choose a target')}</span>
      {onSkipTarget && (
        <button className="btn btn-gold btn-sm" onClick={onSkipTarget}>No target</button>
      )}
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
                <img
                  src={card.image_normal || card.image_small}
                  alt={card.name}
                  style={{ width: '100%', borderRadius: 6, display: 'block' }}
                  onError={e => { (e.currentTarget as HTMLImageElement).src = card.image_small || ''; }}
                />
                <div className="gy-card-name">{card.name}</div>
                {playerId === 0 && graveyardAbilities.length > 0 && onActivate && (
                  graveyardAbilities.map((ab: any, idx: number) => {
                    // Format the activation cost for display
                    const costLabel = ab.cost
                      ? (() => {
                          const c = ab.cost;
                          if (c.zone === 'graveyard' || c.exile_self) return 'exile';
                          if (c.generic !== undefined) return `{${c.generic}}`;
                          if (c.sacrifice_creature) return 'sacrifice';
                          if (c.tap) return 'tap';
                          if (c.life) return `${c.life} life`;
                          return null;
                        })()
                      : null;
                    return (
                      <button
                        key={idx}
                        className="btn btn-gold btn-sm gy-activate-btn"
                        onClick={() => { onActivate(card._uid, idx); onClose(); }}
                        title={costLabel ? `Cost: ${costLabel}` : undefined}
                      >
                        {ab.label || 'Activate'}
                        {costLabel && <span className="gy-cost-hint"> · {costLabel}</span>}
                      </button>
                    );
                  })
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
import manaImgW from '../../assets/mana-W.png';
import manaImgU from '../../assets/mana-U.png';
import manaImgB from '../../assets/mana-B.png';
import manaImgR from '../../assets/mana-R.png';
import manaImgG from '../../assets/mana-G.png';

export const MANA_IMAGES: Record<string, string> = {
  W: manaImgW, U: manaImgU, B: manaImgB, R: manaImgR, G: manaImgG,
};
const MANA_PIP_COLORS: Record<string, string> = {
  C: '#8a8a8a', X: '#555',
};
export function ManaCostPips({ cost, size = 18 }: { cost: string; size?: number }) {
  if (!cost) return null;
  const tokens = (cost.match(/\{[^}]+\}/g) || []);
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center', marginLeft: 6 }}>
      {tokens.map((t, i) => {
        const sym = t.slice(1, -1);
        if (MANA_IMAGES[sym]) {
          return (
            <img key={i} src={MANA_IMAGES[sym]} alt={sym}
              style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0,
                       objectFit: 'cover', display: 'block' }} />
          );
        }
        // Generic / numeric pip
        const bg = MANA_PIP_COLORS[sym] ?? '#444';
        const isNum = /^\d+$/.test(sym);
        return (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: size, height: size, borderRadius: '50%',
            background: bg, color: '#eee',
            fontSize: Math.round(size * 0.58), fontWeight: 700, flexShrink: 0,
            border: '1px solid rgba(255,255,255,0.2)',
          }}>{isNum ? sym : sym}</span>
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
const MANA_COLOR_NAMES: Record<string, string> = { W:'White', U:'Blue', B:'Black', R:'Red', G:'Green', C:'Colorless' };
interface ManaColorOverlayProps { colors: string[]; onConfirm: (color: string) => void; }
export function ManaColorOverlay({ colors, onConfirm }: ManaColorOverlayProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass" style={{ maxWidth: 400 }}>
        <h3 className="overlay-title">Choose Mana Color</h3>
        <div className="mana-color-choices">
          {colors.map(c => (
            <button key={c} className={`btn mana-color-btn mana-btn-${c}`} onClick={() => onConfirm(c)}>
              {MANA_IMAGES[c]
                ? <img src={MANA_IMAGES[c]} alt={c} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', marginRight: 6 }} />
                : <span style={{ marginRight: 6 }}>◇</span>
              }
              {MANA_COLOR_NAMES[c] || c}
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

  const toggle = (uid: string) => {
    setDist(prev => {
      const cur = prev[uid] || 0;
      if (cur > 0) {
        // Remove one (left-click again to undo)
        const next = { ...prev, [uid]: cur - 1 };
        if (next[uid] === 0) delete next[uid];
        return next;
      } else if (remaining > 0) {
        // Add one
        return { ...prev, [uid]: 1 };
      }
      return prev;
    });
  };
  const add = toggle; // alias kept for compatibility
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
          Click to assign · Click again to remove · Budget: <strong>{remaining}/{totalAmount}</strong> remaining
        </p>
        <div className="scry-cards">
          {creatures.map((c: any, i: number) => {
            const count = dist[c._uid] || 0;
            return (
              <div
                key={c._uid || i}
                className={`scry-card-slot${count > 0 ? ' scry-card-selected' : ''}`}
                onClick={() => toggle(c._uid)}
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
  keepLabel?: string; discardLabel?: string;
  onConfirm: (choices: string[]) => void;
}
export function LookTopOverlay({ cards, pickCount, title, hint, keepLabel, discardLabel, onConfirm }: LookTopOverlayProps) {
  const maxKeep = pickCount ?? cards.length;
  // If pickCount < total, start with the first pickCount as 'keep', rest as 'graveyard'
  const [choices, setChoices] = useState<string[]>(() =>
    cards.map((_, i) => i < maxKeep ? 'keep' : 'graveyard')
  );
  const keptCount = choices.filter(c => c === 'keep').length;
  const kLabel = keepLabel || '✋ Hand';
  const dLabel = discardLabel || '💀 GY';
  function toggle(i: number) {
    setChoices(prev => {
      const next = [...prev];
      if (next[i] === 'keep') { next[i] = 'graveyard'; }
      else if (keptCount < maxKeep) { next[i] = 'keep'; }
      return next;
    });
  }
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">{title || `👁 Top ${cards.length} Cards`}</h3>
        <p className="overlay-hint">{hint || `Keep ${maxKeep} card${maxKeep !== 1 ? 's' : ''} for hand. Click to toggle.`}</p>
        <div className="scry-cards">
          {cards.map((card: any, i: number) => (
            <div key={card._uid || i} className={`scry-card-slot ${choices[i] !== 'keep' ? 'scry-away' : ''}`} onClick={() => toggle(i)}>
              <CardImage card={card} size="medium" />
              <div className="scry-card-label">{choices[i] === 'keep' ? kLabel : dLabel}</div>
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
interface MillLandChoiceOverlayProps {
  milledLands: any[];
  milledAll?: any[];
  onConfirm: (choice: 'land' | 'counter', landUid?: string) => void;
}
export function MillLandChoiceOverlay({ milledLands, milledAll, onConfirm }: MillLandChoiceOverlayProps) {
  const [selected, setSelected] = useState<string | null>(milledLands.length > 0 ? milledLands[0]._uid : null);
  const allCards = milledAll && milledAll.length > 0 ? milledAll : milledLands;

  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass" style={{ maxWidth: 640, textAlign: 'center', padding: '20px 24px' }}>
        <h3 className="overlay-title">🌊 Ainok Wayfarer — Cartas Milladas</h3>
        <p className="overlay-hint" style={{ marginBottom: 16 }}>
          {milledLands.length > 0
            ? 'Clique em um terreno para selecioná-lo e colocar na mão. Ou tome um marcador +1/+1.'
            : 'Nenhum terreno millado — tome um marcador +1/+1.'}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 18 }}>
          {allCards.map((c: any) => {
            const isLand = milledLands.some((l: any) => l._uid === c._uid);
            const isSelected = selected === c._uid;
            return (
              <div
                key={c._uid}
                onClick={() => isLand && setSelected(c._uid)}
                title={isLand ? `${c.name} — clique para selecionar` : c.name}
                style={{
                  position: 'relative',
                  cursor: isLand ? 'pointer' : 'default',
                  borderRadius: 10,
                  border: isSelected ? '3px solid #f5c518' : isLand ? '3px solid #4caf50' : '3px solid #555',
                  boxShadow: isSelected ? '0 0 16px rgba(245,197,24,0.7)' : isLand ? '0 0 10px rgba(76,175,80,0.4)' : 'none',
                  opacity: isLand ? 1 : 0.55,
                  transition: 'box-shadow 0.15s, border 0.15s',
                  flexShrink: 0,
                }}
              >
                <img
                  src={c.image_normal || c.image_small}
                  alt={c.name}
                  style={{ width: 160, height: 224, objectFit: 'cover', borderRadius: 8, display: 'block' }}
                />
                {isLand && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: isSelected ? 'rgba(245,197,24,0.85)' : 'rgba(76,175,80,0.75)',
                    color: '#000', fontWeight: 800, fontSize: 11,
                    borderRadius: '0 0 8px 8px', padding: '3px 0', textAlign: 'center',
                  }}>
                    {isSelected ? '✓ Selecionado' : '🌿 Terreno'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {milledLands.length > 0 && (
            <button
              className="btn btn-gold"
              style={{ minWidth: 180 }}
              disabled={!selected}
              onClick={() => selected && onConfirm('land', selected)}
            >
              🌳 Colocar Terreno na Mão
            </button>
          )}
          <button className="btn btn-muted" style={{ minWidth: 180 }} onClick={() => onConfirm('counter')}>
            ⬆ Marcador +1/+1
          </button>
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
  onActivate: (abilityIdx: number, xValue?: number) => void;
  onClose: () => void;
  availableMana?: number; // Total mana available (for X cost computation)
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

function abilityHasX(ab: any): boolean {
  const mana = (ab.cost?.mana || '').toUpperCase();
  return mana.includes('X');
}

export function AbilityModal({ card, abilities, onActivate, onClose, availableMana = 0 }: AbilityModalProps) {
  const isPlaneswalker = (card.type_line || '').includes('Planeswalker');
  const currentLoyalty = card._loyalty;
  const [xChoice, setXChoice] = useState<{ abilityIdx: number; value: number } | null>(null);

  if (xChoice !== null) {
    const ab = abilities[xChoice.abilityIdx];
    // Fixed cost (non-X portion) - e.g. "XB" → fixed is B = 1
    const mana = (ab?.cost?.mana || '').replace(/\{?X\}?/gi, '').replace(/^X/i, '').trim();
    const fixedMana = mana ? mana.length : 0; // rough generic count
    const maxX = Math.max(0, availableMana - fixedMana);

    return (
      <div className="overlay-backdrop" onClick={onClose}>
        <div className="overlay-panel glass" style={{ maxWidth: 380, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
          <div className="overlay-header">
            <h3 className="overlay-title">⚡ Choose X</h3>
            <button className="btn btn-muted btn-sm" onClick={onClose}>✕</button>
          </div>
          <p className="overlay-hint" style={{ margin: '8px 0 16px' }}>
            {describeAbility(ab)}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 20 }}>
            <button
              className="btn btn-muted"
              style={{ width: 40, height: 40, fontSize: 22, padding: 0 }}
              onClick={() => setXChoice(prev => prev && prev.value > 0 ? { ...prev, value: prev.value - 1 } : prev)}
              disabled={xChoice.value <= 0}
            >−</button>
            <span style={{ fontSize: 36, fontWeight: 800, color: '#f0c040', minWidth: 48, textAlign: 'center' }}>
              {xChoice.value}
            </span>
            <button
              className="btn btn-muted"
              style={{ width: 40, height: 40, fontSize: 22, padding: 0 }}
              onClick={() => setXChoice(prev => prev ? { ...prev, value: prev.value + 1 } : prev)}
              disabled={xChoice.value >= maxX}
            >+</button>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>
            Max X = {maxX} (based on available mana)
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-muted" style={{ flex: 1 }} onClick={() => setXChoice(null)}>Back</button>
            <button
              className="btn btn-gold"
              style={{ flex: 2 }}
              onClick={() => { onActivate(xChoice.abilityIdx, xChoice.value); onClose(); }}
            >
              Activate (X = {xChoice.value})
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            const hasX = abilityHasX(ab);
            return (
              <button
                key={i}
                className="modal-mode-btn"
                onClick={() => {
                  if (hasX) {
                    // Show X chooser step
                    setXChoice({ abilityIdx: i, value: 1 });
                  } else {
                    onActivate(i);
                    onClose();
                  }
                }}
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
                <span className="modal-mode-desc">{describeAbility(ab)}{hasX ? ' ✦ Choose X' : ''}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Trigger Cost Overlay ────────────────────────────────────────────────────
interface TriggerCostOverlayProps { triggerName: string; costDesc?: string; effectDesc?: string; onConfirm: (choice: 'pay' | 'skip') => void; }
export function TriggerCostOverlay({ triggerName, costDesc, effectDesc, onConfirm }: TriggerCostOverlayProps) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass" style={{ maxWidth: 460, textAlign: 'center' }}>
        <h3 className="overlay-title">⚡ {triggerName} — Habilidade Opcional</h3>
        {costDesc && (
          <p className="overlay-hint" style={{ fontSize: 15 }}>
            Pagar <strong>{costDesc}</strong> para ativar?
          </p>
        )}
        {effectDesc && (
          <p style={{ color: '#a78bfa', fontSize: 13, marginTop: -4, marginBottom: 10 }}>
            → {effectDesc}
          </p>
        )}
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onConfirm('pay')}>✅ Pagar</button>
          <button className="btn btn-muted" style={{ flex: 1 }} onClick={() => onConfirm('skip')}>❌ Passar</button>
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
                    src={card.image_normal || card.image_small}
                    alt={card.name}
                    style={{ width: '100%', borderRadius: 6, display: 'block', opacity: 0.85, border: '1px solid #8a2be2' }}
                    onError={e => { e.currentTarget.src = card.image_small || ''; }}
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
  exactAmount?: boolean; // must select exactly `amount` cards (no more, no less)
  title?: string;
  onConfirm: (uids: string[]) => void;
}

export function GraveyardMultiSelectOverlay({ cards, amount, minAmount, exactAmount, title, onConfirm }: GraveyardMultiSelectOverlayProps) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(uid: string) {
    setSelected(prev =>
      prev.includes(uid) ? prev.filter(x => x !== uid) :
      prev.length < amount ? [...prev, uid] : [...prev.slice(1), uid]
    );
  }

  const ready = exactAmount ? selected.length === amount : selected.length >= minAmount;

  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">{title || `☠ Exile from Graveyard`}</h3>
        <p className="overlay-hint">
          {exactAmount
            ? `Select exactly ${amount} card${amount !== 1 ? 's' : ''} to exile. (${selected.length}/${amount} selected)`
            : amount === 1
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

// ─── Keyboard Help Overlay ────────────────────────────────────────────────────
export function KeyboardHelpOverlay({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { key: 'F', desc: 'Auto-pass até o End Step' },
    { key: 'A', desc: 'Atacar com todas as criaturas' },
    { key: 'Space', desc: 'Confirmar / Passar prioridade' },
    { key: 'Enter', desc: 'Confirmar seleção atual' },
    { key: 'Esc', desc: 'Cancelar / Fechar overlay' },
    { key: 'L', desc: 'Abrir/fechar log de ações' },
    { key: 'E', desc: 'Ver zona de exílio' },
    { key: 'G', desc: 'Ver cemitério' },
    { key: 'Tab', desc: 'Ver stack' },
    { key: 'X', desc: 'Full Control Mode (pausa em toda fase)' },
    { key: 'Z', desc: 'Desfazer tap de terreno' },
    { key: 'K / M', desc: 'Guardar mão / Mulligan' },
    { key: '1–4', desc: 'Escolher modo (spell modal)' },
    { key: '?', desc: 'Este menu de ajuda' },
  ];
  const kbdStyle: React.CSSProperties = {
    display: 'inline-block', minWidth: 56, textAlign: 'center',
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 6, padding: '2px 8px', fontFamily: 'monospace',
    fontSize: 12, color: '#f0e6c0', flexShrink: 0,
  };
  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-panel glass" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="overlay-header">
          <h3 className="overlay-title">⌨ Atalhos de Teclado</h3>
          <button className="btn btn-muted btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {shortcuts.map(s => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <kbd style={kbdStyle}>{s.key}</kbd>
              <span style={{ color: '#c0b080', fontSize: 13 }}>{s.desc}</span>
            </div>
          ))}
        </div>
        <p className="overlay-hint" style={{ marginTop: 12 }}>Clique fora ou pressione Esc para fechar</p>
      </div>
    </div>
  );
}

// ─── Distribute Damage Overlay ────────────────────────────────────────────────
interface DistributeDamageOverlayProps {
  totalDamage: number;
  targets: any[]; // { type: 'creature'|'player', uid?: string, player: number, name: string }
  onConfirm: (distribution: Record<string, number>) => void;
}
export function DistributeDamageOverlay({ totalDamage, targets, onConfirm }: DistributeDamageOverlayProps) {
  const getKey = (t: any) => t.uid ?? `p${t.player}`;
  const [dist, setDist] = useState<Record<string, number>>(() => {
    // Initialize with even split
    const even = Math.floor(totalDamage / targets.length);
    const init: Record<string, number> = {};
    targets.forEach((t, i) => {
      init[getKey(t)] = i === targets.length - 1 ? totalDamage - even * (targets.length - 1) : even;
    });
    return init;
  });

  const spent = Object.values(dist).reduce((a, b) => a + b, 0);
  const remaining = totalDamage - spent;

  const add = (key: string) => {
    if (remaining <= 0) return;
    setDist(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
  };
  const remove = (key: string) => {
    setDist(prev => {
      const cur = prev[key] || 0;
      if (cur <= 0) return prev;
      return { ...prev, [key]: cur - 1 };
    });
  };

  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">💥 Distribuir {totalDamage} de Dano</h3>
        <p className="overlay-hint">
          Clique para adicionar · Clique direito para remover · Restante: <strong>{remaining}</strong>
        </p>
        <div className="scry-cards">
          {targets.map((t: any) => {
            const key = getKey(t);
            const assigned = dist[key] || 0;
            return (
              <div
                key={key}
                className={`scry-card-slot${assigned > 0 ? ' scry-card-selected' : ''}`}
                onClick={() => add(key)}
                onContextMenu={e => { e.preventDefault(); remove(key); }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                {t.type === 'creature' && t.imageUrl
                  ? <img src={t.imageUrl} alt={t.name} style={{ width: 60, height: 84, objectFit: 'cover', borderRadius: 4 }} />
                  : <div style={{ width: 60, height: 84, background: 'rgba(255,80,80,0.2)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
                      {t.type === 'player' ? '🧙' : '🐉'}
                    </div>
                }
                <div className="scry-card-label">{t.name}</div>
                {assigned > 0 && <div className="bounce-selected-badge">💥{assigned}</div>}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-primary overlay-confirm"
            onClick={() => onConfirm(dist)}
            disabled={remaining !== 0}
          >
            Confirmar ({spent}/{totalDamage})
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Order Blockers Overlay ─────────────────────────────────────────────────
interface OrderBlockersOverlayProps {
  attackerUids: string[];
  blockers: Record<string, any[]>; // raw engine format: { attackerUid: [{uid, card}] }
  snap: any;
  onConfirm: (order: Record<string, string[]>) => void;
}
export function OrderBlockersOverlay({ attackerUids, blockers, snap, onConfirm }: OrderBlockersOverlayProps) {
  // Build initial per-attacker blocker order arrays from raw engine blockers
  const [orderMap, setOrderMap] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const aUid of attackerUids) {
      initial[aUid] = (blockers[aUid] || []).map((b: any) => b.uid || b._uid);
    }
    return initial;
  });

  function moveBlocker(attackerUid: string, blockerUid: string, dir: -1 | 1) {
    setOrderMap(prev => {
      const arr = [...(prev[attackerUid] || [])];
      const idx = arr.indexOf(blockerUid);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return { ...prev, [attackerUid]: arr };
    });
  }

  function getCard(uid: string) {
    for (const p of (snap?.players || [])) {
      const bf = p.battlefield || [];
      const found = bf.find((c: any) => c._uid === uid);
      if (found) return found;
    }
    return null;
  }

  return (
    <div className="overlay-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 7000 }}>
      <div className="glass overlay-panel" style={{ maxWidth: 400, padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Ordem de Bloqueadores</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, textAlign: 'center' }}>
          Escolha a ordem que sua criatura atacante atribui dano aos bloqueadores
        </div>
        {attackerUids.map(aUid => {
          const attacker = getCard(aUid);
          const blockerUids = orderMap[aUid] || [];
          const atkPow = attacker?.power ?? attacker?.card?.power ?? '?';
          const atkTou = attacker?.toughness ?? attacker?.card?.toughness ?? '?';
          return (
            <div key={aUid} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#f0c040',
                            background: 'rgba(240,192,64,0.1)', padding: '4px 8px', borderRadius: 4 }}>
                🗡️ Sua Atacante: {attacker?.name || aUid} ({atkPow}/{atkTou}) — recebe bloqueio múltiplo
              </div>
              {blockerUids.map((bUid, idx) => {
                const blocker = getCard(bUid);
                return (
                  <div key={bUid} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, padding: '3px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                    <span style={{ fontSize: 10, opacity: 0.5, width: 14 }}>{idx + 1}.</span>
                    <span style={{ flex: 1, fontSize: 11 }}>{blocker?.name || bUid} {blocker ? `(${blocker.power}/${blocker.toughness})` : ''}</span>
                    <button style={{ padding: '1px 5px', fontSize: 11, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 3, color: 'white' }}
                      onClick={() => moveBlocker(aUid, bUid, -1)} disabled={idx === 0}>↑</button>
                    <button style={{ padding: '1px 5px', fontSize: 11, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 3, color: 'white' }}
                      onClick={() => moveBlocker(aUid, bUid, 1)} disabled={idx === blockerUids.length - 1}>↓</button>
                  </div>
                );
              })}
            </div>
          );
        })}
        <button className="btn btn-gold" style={{ width: '100%', marginTop: 8 }} onClick={() => onConfirm(orderMap)}>
          Confirmar Ordem
        </button>
      </div>
    </div>
  );
}
