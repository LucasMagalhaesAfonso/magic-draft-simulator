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

  function toggle(i: number) {
    setChoices(prev => {
      const next = [...prev];
      next[i] = prev[i] === 'top' ? (isSurveil ? 'graveyard' : 'bottom') : 'top';
      return next;
    });
  }

  return (
    <div className="overlay-backdrop">
      <div className="overlay-panel glass">
        <h3 className="overlay-title">
          {isSurveil ? '🔍 Surveil' : '🔭 Scry'} {pendingScry.cards.length}
        </h3>
        <p className="overlay-hint">
          Clique para {isSurveil ? 'enviar pro cemitério' : 'colocar no fundo'}.
          Cartas sem clique ficam no topo.
        </p>
        <div className="scry-cards">
          {pendingScry.cards.map((card: any, i: number) => (
            <div
              key={card._uid || i}
              className={`scry-card-slot ${choices[i] !== 'top' ? 'scry-away' : ''}`}
              onClick={() => toggle(i)}
            >
              <CardImage card={card} size="medium" />
              <div className="scry-card-label">
                {choices[i] === 'top' ? '⬆ Topo' : isSurveil ? '☠ Cemitério' : '⬇ Fundo'}
              </div>
            </div>
          ))}
        </div>
        <button
          className="btn btn-gold overlay-confirm"
          onClick={() => onConfirm(choices as any[])}
        >
          Confirmar (Enter)
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
  if (mode.description) return mode.description;
  const t = mode.type;
  const amt = mode.amount;
  const tgt = mode.target;
  if (t === 'damage') return `${amt} dano${tgt ? ` ao ${tgt}` : ''}`;
  if (t === 'draw') return `Comprar ${amt} carta(s)`;
  if (t === 'destroy') return `Destruir ${tgt || 'permanente'}`;
  if (t === 'exile') return `Exilar ${tgt || 'permanente'}`;
  if (t === 'bounce') return `Devolver ${tgt || 'permanente'} à mão`;
  if (t === 'gainLife') return `Ganhar ${amt} vida`;
  if (t === 'counter_self') return `+${mode.power || 0}/+${mode.toughness || 0} até fim do turno`;
  if (t === 'buff') return `Criatura ganha +${mode.power || 0}/+${mode.toughness || 0}`;
  if (t === 'tap') return `Virar ${tgt || 'permanente'}`;
  if (t === 'scry') return `Scry ${amt}`;
  if (t === 'mill') return `Mill ${amt}`;
  if (t === 'discard') return `Oponente descarta ${amt}`;
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
          Escolha {chooseCount === 1 ? 'um modo' : `${chooseCount} modos`}:
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
          Confirmar {selected.length}/{chooseCount} (Enter)
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
      <span>🎯 <strong>{spell?._isAdventure ? (spell.back_face?.name || spell.adventure?.name || spell.name) : (spell?.name || 'Spell')}</strong> — escolha um alvo</span>
      <button className="btn btn-muted btn-sm" onClick={onCancel}>Cancelar (Esc)</button>
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
            ☠ Cemitério {playerId === 0 ? '(Você)' : '(Oponente)'}
          </h3>
          <button className="btn btn-muted btn-sm" onClick={onClose}>✕</button>
        </div>

        {cards.length === 0 && (
          <p className="overlay-hint">Cemitério vazio.</p>
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
                      {ab.label || 'Ativar'}
                    </button>
                  ))
                )}
              </div>
            );
          })}
        </div>

        {zoomed && (
          <div className="gy-zoom">
            <img src={zoomed.image_normal || zoomed.image_small} alt={zoomed.name} className="gy-zoom-img" />
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

// ─── Stack Priority Banner ───────────────────────────────────────────────────
interface StackPriorityBannerProps { spellName: string; onPass: () => void; }
export function StackPriorityBanner({ spellName, onPass }: StackPriorityBannerProps) {
  return (
    <div className="instant-priority-banner stack-priority-banner glass">
      <span>📚 Stack: <strong>{spellName}</strong></span>
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
        <button className="btn btn-gold overlay-confirm" onClick={() => onConfirm(choices)}>Confirmar (Enter)</button>
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
                  />
                  <div className="gy-card-name">{card.name}</div>
                </div>
              ))}
            </div>
          )
        }
        {zoomed && (
          <div className="gy-zoom">
            <img src={zoomed.image_normal} alt={zoomed.name} className="gy-zoom-img" />
          </div>
        )}
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
