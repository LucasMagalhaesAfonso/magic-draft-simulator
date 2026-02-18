import { useState, useEffect } from 'react';
import { useAppStore, type ThemeId, type PlaymatId } from '../store/useAppStore';
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
  const { theme, setTheme, playmat, playmatArt, setPlaymat, landArts, setLandArt, resetLandArts, sleeveArt, setSleeveArt } = useAppStore();
  const [customSearch, setCustomSearch] = useState('');
  const [customArtUrl, setCustomArtUrl] = useState(playmatArt || '');
  const [searching, setSearching] = useState(false);
  // Land art picker
  const [landPicker, setLandPicker] = useState<{ color: string; name: string } | null>(null);
  // Custom sleeve input
  const [customSleeveUrl, setCustomSleeveUrl] = useState('');

  async function handleCustomSearch() {
    if (!customSearch.trim()) return;
    setSearching(true);
    try {
      const name = encodeURIComponent(customSearch.trim());
      const url = `https://api.scryfall.com/cards/named?exact=${name}&format=image&version=art_crop`;
      // Test the URL loads
      setCustomArtUrl(url);
      setPlaymat('custom', url);
    } catch (e) {
      console.error('Custom art search failed:', e);
    } finally {
      setSearching(false);
    }
  }

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
          <div className="settings-custom-row">
            <input
              type="text"
              className="sync-input"
              placeholder="Card name for custom art (e.g. Tarmogoyf)"
              value={customSearch}
              onChange={e => setCustomSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCustomSearch()}
            />
            <button className="btn btn-primary" onClick={handleCustomSearch} disabled={searching || !customSearch.trim()}>
              {searching ? '...' : 'Set Art'}
            </button>
          </div>
          {customArtUrl && (
            <div className="settings-custom-preview">
              <img src={customArtUrl} alt="Custom playmat preview" />
              <span>Current custom art</span>
            </div>
          )}
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
          <div className="settings-sleeve-grid">
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
          <div className="settings-custom-row" style={{ marginTop: 10 }}>
            <input
              type="text"
              className="sync-input"
              placeholder="Custom card back image URL..."
              value={customSleeveUrl}
              onChange={e => setCustomSleeveUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && customSleeveUrl.trim()) setSleeveArt(customSleeveUrl.trim()); }}
            />
            <button
              className="btn btn-primary"
              onClick={() => customSleeveUrl.trim() && setSleeveArt(customSleeveUrl.trim())}
              disabled={!customSleeveUrl.trim()}
            >Set</button>
          </div>
        </div>

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

// ── Land Art Picker Modal ────────────────────────────────────────────────────

interface LandArtPickerProps {
  color: string;
  name: string;
  currentArt: string;
  onSelect: (artUrl: string) => void;
  onClose: () => void;
}

function LandArtPickerModal({ name, currentArt, onSelect, onClose }: LandArtPickerProps) {
  const [arts, setArts] = useState<{ id: string; art_crop: string; set: string; artist: string }[]>([]);
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
                onClick={() => onSelect(art.art_crop)}
                title={`${art.set} · ${art.artist}`}
                style={{
                  cursor: 'pointer', borderRadius: 8, overflow: 'hidden',
                  border: currentArt === art.art_crop ? '3px solid var(--gold)' : '2px solid transparent',
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
                {currentArt === art.art_crop && (
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
