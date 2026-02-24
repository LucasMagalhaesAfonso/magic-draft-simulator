import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore, type ThemeId, type PlaymatId } from '../store/useAppStore';
import { aiBrain, type AiBrainStats } from '../engine/ai-brain';
import { getHumanLearnStats, resetHumanLearn } from '../draft/bot-ai';
import './SettingsScreen.css';

const PLAYMATS: { id: PlaymatId; label: string; color: string; artUrl: string }[] = [
  { id: 'default',  label: 'Default',  color: '#1a1a2e', artUrl: '' },
  { id: 'forest',   label: 'Forest',   color: '#0a1a08', artUrl: 'https://api.scryfall.com/cards/named?exact=Forest&set=znr&format=image&version=art_crop' },
  { id: 'ocean',    label: 'Ocean',    color: '#04102a', artUrl: 'https://api.scryfall.com/cards/named?exact=Island&set=znr&format=image&version=art_crop' },
  { id: 'mountain', label: 'Mountain', color: '#1e0c06', artUrl: 'https://api.scryfall.com/cards/named?exact=Mountain&set=znr&format=image&version=art_crop' },
  { id: 'plains',   label: 'Plains',   color: '#18140a', artUrl: 'https://api.scryfall.com/cards/named?exact=Plains&set=znr&format=image&version=art_crop' },
  { id: 'swamp',    label: 'Swamp',    color: '#12081c', artUrl: 'https://api.scryfall.com/cards/named?exact=Swamp&set=znr&format=image&version=art_crop' },
  { id: 'nyx',      label: 'Nyx',      color: '#100432', artUrl: 'https://api.scryfall.com/cards/named?exact=Nykthos%2C+Shrine+to+Nyx&format=image&version=art_crop' },
];

const THEMES: { id: ThemeId; label: string; accent: string; bg: string }[] = [
  { id: 'spark',     label: '✦ Spark',    accent: '#d4a029', bg: 'linear-gradient(135deg, #1a1226, #2e1f4a)' },
  { id: 'nyx',       label: '✦ Nyx',      accent: '#00d2d3', bg: 'linear-gradient(135deg, #0a1628, #122a4e)' },
  { id: 'phyrexian', label: '✦ Phyrexia', accent: '#39ff14', bg: 'linear-gradient(135deg, #0a0e08, #1a2618)' },
  { id: 'kamigawa',  label: '✦ Kamigawa', accent: '#ff2d95', bg: 'linear-gradient(135deg, #12081a, #2a1640)' },
  { id: 'obscura',   label: '✦ Obscura',  accent: '#a8a8a8', bg: 'linear-gradient(135deg, #0a0a0a, #1a1a1a)' },
];


export function SettingsScreen() {
  const { theme, setTheme, playmat, playmatArt, playmatPosition, playmatSize, setPlaymat, setPlaymatPosition, setPlaymatSize, landArts, setLandArt, resetLandArts, sleeveArt, setSleeveArt } = useAppStore();
  const [sleeveZoom, setSleeveZoom] = useState(false);
  const [customArtUrl, setCustomArtUrl] = useState(playmatArt || '');

  // AI Brain stats
  const [aiStats, setAiStats] = useState<AiBrainStats>(() => aiBrain.getStats());
  const [aiResetting, setAiResetting] = useState(false);

  // Draft learning stats
  const [draftStats, setDraftStats] = useState(() => getHumanLearnStats());
  const [draftResetting, setDraftResetting] = useState(false);

  useEffect(() => {
    // Refresh stats every 5 seconds while on this screen
    const id = setInterval(() => setAiStats(aiBrain.getStats()), 5000);
    return () => clearInterval(id);
  }, []);

  function handleResetBrain() {
    setAiResetting(true);
    aiBrain.reset().then(() => {
      setAiStats(aiBrain.getStats());
      setAiResetting(false);
    });
  }

  function handleResetDraftLearn() {
    setDraftResetting(true);
    resetHumanLearn();
    setDraftStats(getHumanLearnStats());
    setDraftResetting(false);
  }

  function formatLastTrained(iso: string | null): string {
    if (!iso) return 'nunca';
    const d = new Date(iso);
    const diff = Math.round((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return `há ${diff}s`;
    if (diff < 3600) return `há ${Math.round(diff / 60)}min`;
    return `há ${Math.round(diff / 3600)}h`;
  }
  // Land art picker
  const [landPicker, setLandPicker] = useState<{ color: string; name: string } | null>(null);
  // Card art search modals
  const [showPlaymatSearch, setShowPlaymatSearch] = useState(false);
  const [showSleeveSearch, setShowSleeveSearch] = useState(false);

  return (
    <div className="settings-screen animate-fade-in">
      <div className="settings-content">

        {/* Theme Section */}
        <div className="settings-section glass">
          <h2 className="settings-title">🎨 Theme</h2>
          <p className="settings-desc">Changes the overall color scheme of the app.</p>
          <div className="settings-theme-grid">
            {THEMES.map(t => (
              <button
                key={t.id}
                className={`settings-theme-opt ${theme === t.id ? 'selected' : ''}`}
                style={{ background: t.bg, borderBottomColor: t.accent }}
                onClick={() => setTheme(t.id)}
              >
                <span className="settings-theme-dot" style={{ background: t.accent }} />
                <span className="settings-theme-label">{t.label}</span>
                {theme === t.id && <span className="settings-check">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Playmat Section */}
        <div className="settings-section glass">
          <h2 className="settings-title">🖼️ Playmat</h2>
          <p className="settings-desc">Background art for your side of the battlefield.</p>

          <div className="settings-playmat-grid">
            {PLAYMATS.map(p => (
              <button
                key={p.id}
                className={`settings-playmat-opt ${playmat === p.id && p.id !== 'custom' ? 'selected' : ''}`}
                onClick={() => setPlaymat(p.id, p.artUrl)}
                style={p.artUrl ? {
                  backgroundImage: `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url('${p.artUrl}')`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                } : { background: p.color }}
              >
                <span className="settings-playmat-label">{p.label}</span>
                {playmat === p.id && p.id !== 'custom' && <span className="settings-check">✓</span>}
              </button>
            ))}

            {/* Custom playmat */}
            <button
              className={`settings-playmat-opt settings-playmat-custom ${playmat === 'custom' ? 'selected' : ''}`}
              style={customArtUrl ? {
                backgroundImage: `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), url('${customArtUrl}')`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              } : {}}
              onClick={() => customArtUrl && setPlaymat('custom', customArtUrl)}
            >
              <span className="settings-playmat-label">
                {playmat === 'custom' && customArtUrl ? '✓ Custom' : '🎨 Custom'}
              </span>
            </button>
          </div>

          {/* Custom art search */}
          <button className="btn btn-primary settings-search-art-btn" onClick={() => setShowPlaymatSearch(true)}>
            Search Card Art...
          </button>
          {customArtUrl && (
            <div className="settings-custom-preview">
              <img src={customArtUrl} alt="Custom playmat preview" />
              <span>Current custom art</span>
            </div>
          )}

          {/* Playmat position picker — shown when a non-default playmat is selected */}
          {playmat !== 'default' && (() => {
            const currentPlaymatArt = playmat === 'custom' ? customArtUrl
              : PLAYMATS.find(p => p.id === playmat)?.artUrl || '';
            if (!currentPlaymatArt) return null;
            return (
              <PlaymatPositionPicker
                artUrl={currentPlaymatArt}
                position={playmatPosition}
                size={playmatSize}
                onPositionChange={setPlaymatPosition}
                onSizeChange={setPlaymatSize}
              />
            );
          })()}
        </div>

        {/* ── Land Art Section ── */}
        <div className="settings-section glass">
          <h2 className="settings-title">🌿 Basic Land Art</h2>
          <p className="settings-desc">Choose the illustration for each basic land type.</p>
          <div className="settings-land-grid">
            {[
              { color: 'W', name: 'Plains',   emoji: '⬜' },
              { color: 'U', name: 'Island',   emoji: '🔵' },
              { color: 'B', name: 'Swamp',    emoji: '⬛' },
              { color: 'R', name: 'Mountain', emoji: '🔴' },
              { color: 'G', name: 'Forest',   emoji: '🟢' },
            ].map(({ color, name, emoji }) => (
              <button
                key={color}
                className={`settings-land-btn ${landArts[color] ? 'has-art' : ''}`}
                onClick={() => setLandPicker({ color, name })}
                style={landArts[color] ? {
                  backgroundImage: `linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.45)), url('${landArts[color]}')`,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                } : {}}
              >
                <span>{emoji} {name}</span>
                {landArts[color]
                  ? <span className="settings-check">✓</span>
                  : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Click to pick</span>
                }
              </button>
            ))}
          </div>
          {Object.keys(landArts).length > 0 && (
            <button className="btn btn-muted" style={{ marginTop: 10, fontSize: 12 }} onClick={resetLandArts}>
              Reset All Land Arts
            </button>
          )}
        </div>

        {/* ── Sleeves Section ── */}
        <div className="settings-section glass">
          <h2 className="settings-title">🃏 Card Sleeves</h2>
          <p className="settings-desc">Choose card back art for your library pile.</p>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div className="settings-sleeve-grid" style={{ flex: 1 }}>
              {[
                { label: 'Default', artUrl: '' },
                { label: 'Dark', artUrl: 'https://api.scryfall.com/cards/named?exact=Swamp&set=znr&format=image&version=art_crop' },
                { label: 'Forest', artUrl: 'https://api.scryfall.com/cards/named?exact=Forest&set=znr&format=image&version=art_crop' },
                { label: 'Ocean', artUrl: 'https://api.scryfall.com/cards/named?exact=Island&set=znr&format=image&version=art_crop' },
                { label: 'Fire', artUrl: 'https://api.scryfall.com/cards/named?exact=Mountain&set=znr&format=image&version=art_crop' },
                { label: 'Plains', artUrl: 'https://api.scryfall.com/cards/named?exact=Plains&set=znr&format=image&version=art_crop' },
              ].map(({ label, artUrl }) => (
                <button
                  key={label}
                  className={`settings-playmat-opt ${sleeveArt === artUrl ? 'selected' : ''}`}
                  onClick={() => setSleeveArt(artUrl)}
                  style={artUrl ? {
                    backgroundImage: `linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.45)), url('${artUrl}')`,
                    backgroundSize: 'cover', backgroundPosition: 'center',
                  } : {}}
                >
                  <span className="settings-playmat-label">{label}</span>
                  {sleeveArt === artUrl && <span className="settings-check">✓</span>}
                </button>
              ))}
            </div>

            {/* Sleeve preview — click to zoom */}
            <div
              className="settings-sleeve-preview"
              onClick={() => sleeveArt && setSleeveZoom(true)}
              title={sleeveArt ? 'Clique para zoom' : ''}
              style={{ cursor: sleeveArt ? 'zoom-in' : 'default' }}
            >
              {sleeveArt ? (
                <img
                  src={sleeveArt}
                  alt="Sleeve preview"
                  className="settings-sleeve-preview-img"
                />
              ) : (
                <div className="settings-sleeve-preview-empty">
                  <span>🃏</span>
                  <span style={{ fontSize: 10, marginTop: 4, color: 'rgba(255,255,255,0.4)' }}>Default</span>
                </div>
              )}
              {sleeveArt && (
                <div className="settings-sleeve-zoom-hint">🔍 Zoom</div>
              )}
            </div>
          </div>

          <button className="btn btn-primary settings-search-art-btn" style={{ marginTop: 10 }} onClick={() => setShowSleeveSearch(true)}>
            Search Card Art...
          </button>
        </div>

        {/* Sleeve zoom overlay */}
        {sleeveZoom && sleeveArt && (
          <div
            className="overlay-backdrop"
            onClick={() => setSleeveZoom(false)}
            style={{ zIndex: 9999 }}
          >
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={sleeveArt}
                alt="Sleeve zoom"
                style={{
                  width: 300,
                  height: 418,
                  borderRadius: 12,
                  objectFit: 'cover',
                  boxShadow: '0 8px 40px rgba(0,0,0,0.9)',
                  border: '2px solid rgba(255,255,255,0.3)',
                }}
              />
              <div style={{
                position: 'absolute', top: 10, right: 10,
                background: 'rgba(0,0,0,0.7)', color: '#fff',
                borderRadius: 8, padding: '4px 10px', fontSize: 12,
              }}>Clique para fechar</div>
            </div>
          </div>
        )}

        {/* Land Art Picker Modal */}
        {landPicker && (
          <LandArtPickerModal
            color={landPicker.color}
            name={landPicker.name}
            currentArt={landArts[landPicker.color] || ''}
            onSelect={(artUrl) => { setLandArt(landPicker.color, artUrl); setLandPicker(null); }}
            onClose={() => setLandPicker(null)}
          />
        )}

        {/* Card Art Search Modals */}
        {showPlaymatSearch && (
          <CardArtSearchModal
            title="Search Card Art — Playmat"
            currentArt={customArtUrl}
            onSelect={(artUrl) => {
              setCustomArtUrl(artUrl);
              setPlaymat('custom', artUrl);
              setShowPlaymatSearch(false);
            }}
            onClose={() => setShowPlaymatSearch(false)}
          />
        )}
        {showSleeveSearch && (
          <CardArtSearchModal
            title="Search Card Art — Sleeve"
            currentArt={sleeveArt}
            onSelect={(artUrl) => {
              setSleeveArt(artUrl);
              setShowSleeveSearch(false);
            }}
            onClose={() => setShowSleeveSearch(false)}
          />
        )}

        {/* AI Brain */}
        <div className="settings-section glass">
          <h2 className="settings-title">🧠 AI Learning</h2>
          <p className="settings-desc">A IA aprende com cada partida jogada contra você.</p>
          <div className="settings-info-grid">
            <div className="settings-info-item">
              <span className="settings-info-label">Partidas jogadas</span>
              <span className="settings-info-value">{aiStats.gamesPlayed}</span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">Taxa de vitória (IA)</span>
              <span className="settings-info-value">
                {aiStats.gamesPlayed > 0
                  ? `${Math.round((aiStats.wins / aiStats.gamesPlayed) * 100)}%`
                  : '—'}
              </span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">Exploração atual</span>
              <span className="settings-info-value ai-brain-epsilon">
                {Math.round(aiStats.epsilon * 100)}%
              </span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">Última atualização</span>
              <span className="settings-info-value">{formatLastTrained(aiStats.lastTrained)}</span>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn btn-muted"
              style={{ fontSize: 13 }}
              onClick={handleResetBrain}
              disabled={aiResetting}
            >
              {aiResetting ? 'Resetando...' : 'Resetar AI Brain'}
            </button>
            {aiStats.gamesPlayed >= 5 && (
              <span className="ai-brain-badge">
                {aiStats.gamesPlayed >= 30 ? '🔥 Treinada' : aiStats.gamesPlayed >= 10 ? '📈 Aprendendo' : '🌱 Iniciante'}
              </span>
            )}
          </div>
        </div>

        {/* Draft Learning */}
        <div className="settings-section glass">
          <h2 className="settings-title">🎯 Draft Learning</h2>
          <p className="settings-desc">O bot aprende com suas escolhas no draft, valorizando mais as cartas que você sempre pica e evitando passar boas cartas.</p>
          <div className="settings-info-grid">
            <div className="settings-info-item">
              <span className="settings-info-label">Picks registrados</span>
              <span className="settings-info-value">{draftStats.totalPicks}</span>
            </div>
            <div className="settings-info-item" style={{ gridColumn: '1 / -1' }}>
              <span className="settings-info-label">Cartas mais picadas</span>
              <span className="settings-info-value" style={{ fontSize: 11 }}>
                {draftStats.topPicks.length > 0 ? draftStats.topPicks.join(', ') : '—'}
              </span>
            </div>
            <div className="settings-info-item" style={{ gridColumn: '1 / -1' }}>
              <span className="settings-info-label">Cartas que você passa</span>
              <span className="settings-info-value" style={{ fontSize: 11 }}>
                {draftStats.topPasses.length > 0 ? draftStats.topPasses.join(', ') : '—'}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-muted"
              style={{ fontSize: 13 }}
              onClick={handleResetDraftLearn}
              disabled={draftResetting}
            >
              {draftResetting ? 'Resetando...' : 'Resetar Draft Learning'}
            </button>
          </div>
        </div>

        {/* Info */}
        <div className="settings-section glass settings-info">
          <h2 className="settings-title">ℹ️ About</h2>
          <div className="settings-info-grid">
            <div className="settings-info-item">
              <span className="settings-info-label">Version</span>
              <span className="settings-info-value">2.0.0 (Tauri + React)</span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">Engine</span>
              <span className="settings-info-value">Magic Draft Simulator</span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">Card Data</span>
              <span className="settings-info-value">Scryfall API</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Card Art Search Modal ────────────────────────────────────────────────────

interface CardArtSearchModalProps {
  title: string;
  currentArt: string;
  onSelect: (artUrl: string) => void;
  onClose: () => void;
}

interface CardArtResult {
  id: string;
  name: string;
  art_crop: string;
  set: string;
  artist: string;
}

// ─── Playmat Position Picker ─────────────────────────────────────────────────
function PlaymatPositionPicker({ artUrl, position, size, onPositionChange, onSizeChange }: {
  artUrl: string;
  position: string;
  size: number;          // 0 = cover, 30–200 = percentage
  onPositionChange: (pos: string) => void;
  onSizeChange: (size: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Parse current position to percentages (e.g. "30% 60%")
  const parts = position.split(' ');
  const curX = parseFloat(parts[0]) || 50;
  const curY = parseFloat(parts[1]) || 50;

  // Resolved backgroundSize for the preview
  const bgSize = size > 0 ? `${size}%` : 'cover';
  // Slider value: 0 maps to a display value. We show "Cover" at slider=0, else the %
  const sliderVal = size === 0 ? 100 : size; // default display as 100 when cover

  function handlePointer(e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    const x = Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)));
    onPositionChange(`${x}% ${y}%`);
  }

  return (
    <div style={{ marginTop: 14 }}>
      {/* Zoom / Size slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>
          🔍 Zoom
        </span>
        <input
          type="range"
          min={30}
          max={200}
          value={sliderVal}
          onChange={e => onSizeChange(parseInt(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--accent)' }}
        />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', minWidth: 48, textAlign: 'right' }}>
          {size === 0 ? 'Cover' : `${size}%`}
        </span>
        <button
          className="btn btn-muted"
          style={{ fontSize: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}
          onClick={() => onSizeChange(0)}
          title="Preencher tudo (cover)"
        >
          Fill
        </button>
      </div>

      {/* Position drag area */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>
          📐 Posição — clique/arraste para ajustar
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{curX}% {curY}%</span>
      </div>
      <div
        ref={boxRef}
        className="playmat-pos-picker"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url('${artUrl}')`,
          backgroundSize: bgSize,
          backgroundPosition: position,
          backgroundRepeat: 'no-repeat',
          backgroundColor: '#000',
          cursor: 'crosshair',
        }}
        onMouseDown={(e) => { dragging.current = true; handlePointer(e); }}
        onMouseMove={(e) => { if (dragging.current) handlePointer(e); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
        onTouchStart={(e) => { dragging.current = true; handlePointer(e); }}
        onTouchMove={(e) => { if (dragging.current) handlePointer(e); }}
        onTouchEnd={() => { dragging.current = false; }}
      >
        {/* Crosshair indicator */}
        <div
          className="playmat-pos-crosshair"
          style={{ left: `${curX}%`, top: `${curY}%` }}
        />
      </div>
      <button
        className="btn btn-muted"
        style={{ marginTop: 6, fontSize: 11 }}
        onClick={() => { onPositionChange('50% 50%'); onSizeChange(0); }}
      >
        Resetar
      </button>
    </div>
  );
}

function CardArtSearchModal({ title, currentArt, onSelect, onClose }: CardArtSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CardArtResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCards, setTotalCards] = useState(0);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentQueryRef = useRef('');

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const fetchResults = useCallback(async (q: string, p: number) => {
    if (!q.trim()) return;
    setLoading(true);
    setError('');
    try {
      const encoded = encodeURIComponent(q.trim());
      const res = await fetch(
        `https://api.scryfall.com/cards/search?q=name:${encoded}&unique=art&order=released&page=${p}`
      );
      if (res.status === 404) {
        if (p === 1) {
          setResults([]);
          setHasMore(false);
          setTotalCards(0);
          setError('No cards found');
        }
        setLoading(false);
        setSearched(true);
        return;
      }
      const json = await res.json();
      if (json.data) {
        const mapped: CardArtResult[] = json.data
          .filter((c: any) => c.image_uris?.art_crop)
          .map((c: any) => ({
            id: c.id,
            name: c.name,
            art_crop: c.image_uris.art_crop,
            set: (c.set as string).toUpperCase(),
            artist: c.artist || '',
          }));
        setResults(prev => p === 1 ? mapped : [...prev, ...mapped]);
        setHasMore(json.has_more || false);
        setTotalCards(json.total_cards || mapped.length);
      }
    } catch (e) {
      console.error('Card art search failed:', e);
      setError('Search failed. Try again.');
    }
    setLoading(false);
    setSearched(true);
  }, []);

  function handleInputChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      setHasMore(false);
      setError('');
      setSearched(false);
      setTotalCards(0);
      return;
    }
    debounceRef.current = setTimeout(() => {
      currentQueryRef.current = value;
      setPage(1);
      fetchResults(value, 1);
    }, 500);
  }

  function loadMore() {
    const next = page + 1;
    setPage(next);
    fetchResults(currentQueryRef.current, next);
  }

  return (
    <div className="card-search-backdrop" onClick={onClose}>
      <div className="card-search-modal glass" onClick={e => e.stopPropagation()}>
        <div className="card-search-header">
          <h3>{title}</h3>
          <button className="btn btn-muted btn-sm" onClick={onClose}>✕</button>
        </div>

        <input
          ref={inputRef}
          type="text"
          className="card-search-input"
          placeholder='Search any card (e.g. "Jace", "Lightning Bolt", "Dragon")'
          value={query}
          onChange={e => handleInputChange(e.target.value)}
        />

        {totalCards > 0 && (
          <div className="card-search-count">
            Showing {results.length} of {totalCards} results
          </div>
        )}

        <div className="card-search-scroll">
          {!searched && !loading && results.length === 0 && (
            <div className="card-search-empty">
              Type a card name to search Scryfall
            </div>
          )}

          {searched && !loading && results.length === 0 && error && (
            <div className="card-search-empty">{error}</div>
          )}

          {results.length > 0 && (
            <div className="card-search-grid">
              {results.map(card => (
                <div
                  key={card.id}
                  className={`card-search-item ${currentArt === card.art_crop ? 'selected' : ''}`}
                  onClick={() => onSelect(card.art_crop)}
                  title={`${card.name} · ${card.set} · ${card.artist}`}
                >
                  <img src={card.art_crop} alt={card.name} loading="lazy" />
                  <div className="card-search-item-info">
                    <span className="card-search-item-name">{card.name}</span>
                    <span className="card-search-item-set">{card.set}</span>
                  </div>
                  {currentArt === card.art_crop && (
                    <div className="card-search-item-check">✓</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {loading && (
            <div className="card-search-empty">Searching Scryfall...</div>
          )}

          {hasMore && !loading && (
            <div className="card-search-load-more">
              <button className="btn btn-muted" onClick={loadMore}>Load More</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Land Art Picker Modal ────────────────────────────────────────────────────

interface LandArtPickerProps {
  color: string;
  name: string;
  currentArt: string;
  onSelect: (artUrl: string) => void;
  onClose: () => void;
}

function LandArtPickerModal({ name, currentArt, onSelect, onClose }: LandArtPickerProps) {
  const [arts, setArts] = useState<{ id: string; art_crop: string; normal: string; set: string; artist: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  async function fetchArts(p: number) {
    setLoading(true);
    try {
      const CACHE_KEY = `mtg_land_arts_cache_${name}_${p}`;
      const CACHE_EXP = `${CACHE_KEY}_exp`;
      const cached = localStorage.getItem(CACHE_KEY);
      const exp = parseInt(localStorage.getItem(CACHE_EXP) || '0');
      if (cached && Date.now() < exp) {
        const data = JSON.parse(cached);
        setArts(prev => p === 1 ? data.arts : [...prev, ...data.arts]);
        setHasMore(data.hasMore);
        setLoading(false);
        return;
      }
      const q = encodeURIComponent(`!"${name}"`);
      const res = await fetch(`https://api.scryfall.com/cards/search?q=${q}&unique=art&order=released&page=${p}`);
      const json = await res.json();
      if (json.data) {
        const mapped = json.data
          .filter((c: any) => c.image_uris?.art_crop)
          .map((c: any) => ({
            id: c.id,
            art_crop: c.image_uris.art_crop,
            normal: c.image_uris?.normal || '',
            set: (c.set as string).toUpperCase(),
            artist: c.artist || '',
          }));
        const result = { arts: mapped, hasMore: json.has_more };
        localStorage.setItem(CACHE_KEY, JSON.stringify(result));
        localStorage.setItem(CACHE_EXP, String(Date.now() + 7 * 24 * 3600 * 1000));
        setArts(prev => p === 1 ? mapped : [...prev, ...mapped]);
        setHasMore(json.has_more);
      }
    } catch (e) {
      console.error('Land art fetch failed:', e);
    }
    setLoading(false);
  }

  useEffect(() => { fetchArts(1); }, []); // eslint-disable-line

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function loadMore() {
    const next = page + 1;
    setPage(next);
    fetchArts(next);
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        className="glass"
        style={{
          maxWidth: 720, width: '90%', maxHeight: '85vh',
          borderRadius: 12, padding: '20px 24px',
          display: 'flex', flexDirection: 'column', gap: 12,
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, color: 'var(--gold)', fontSize: 18 }}>🌿 {name} — Choose Art</h3>
          <button className="btn btn-muted btn-sm" onClick={onClose}>✕</button>
        </div>
        {loading && arts.length === 0 && (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 32 }}>
            Fetching arts from Scryfall...
          </p>
        )}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 8, padding: 4,
          }}>
            {arts.map(art => (
              <div
                key={art.id}
                onClick={() => onSelect(art.normal || art.art_crop)}
                title={`${art.set} · ${art.artist}`}
                style={{
                  cursor: 'pointer', borderRadius: 8, overflow: 'hidden',
                  border: currentArt === (art.normal || art.art_crop) ? '3px solid var(--gold)' : '2px solid transparent',
                  transition: 'all 0.15s', position: 'relative',
                }}
              >
                <img src={art.art_crop} alt={`${name} art`} style={{ width: '100%', display: 'block' }} />
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'rgba(0,0,0,0.65)', fontSize: 10, padding: '2px 4px',
                  color: '#ccc', display: 'flex', justifyContent: 'space-between',
                }}>
                  <span>{art.set}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                    {art.artist}
                  </span>
                </div>
                {currentArt === (art.normal || art.art_crop) && (
                  <div style={{
                    position: 'absolute', top: 4, right: 4,
                    background: 'var(--gold)', color: '#000',
                    borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700,
                  }}>✓</div>
                )}
              </div>
            ))}
          </div>
          {hasMore && (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <button className="btn btn-muted" onClick={loadMore} disabled={loading}>
                {loading ? 'Loading...' : 'Load More Arts'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
