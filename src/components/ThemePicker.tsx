import { useAppStore, type ThemeId } from '../store/useAppStore';
import './ThemePicker.css';

const THEMES: { id: ThemeId; label: string; accent: string; bg: string }[] = [
  { id: 'spark',     label: '✦ Spark',     accent: '#d4a029', bg: 'linear-gradient(135deg, #1a1226, #2e1f4a)' },
  { id: 'nyx',       label: '✦ Nyx',       accent: '#00d2d3', bg: 'linear-gradient(135deg, #0a1628, #122a4e)' },
  { id: 'phyrexian', label: '✦ Phyrexia',  accent: '#39ff14', bg: 'linear-gradient(135deg, #0a0e08, #1a2618)' },
  { id: 'kamigawa',  label: '✦ Kamigawa',  accent: '#ff2d95', bg: 'linear-gradient(135deg, #12081a, #2a1640)' },
  { id: 'obscura',   label: '✦ Obscura',   accent: '#a8a8a8', bg: 'linear-gradient(135deg, #0a0a0a, #1a1a1a)' },
  { id: 'eldrazi',   label: '✦ Eldrazi',   accent: '#ff6a00', bg: 'linear-gradient(135deg, #0f0800, #1e1000)' },
];

interface ThemePickerProps {
  onClose: () => void;
}

export function ThemePicker({ onClose }: ThemePickerProps) {
  const { theme, setTheme } = useAppStore();

  function pick(id: ThemeId) {
    setTheme(id);
  }

  return (
    <div className="theme-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="theme-modal glass">
        <div className="theme-modal-header">
          <h3>Theme</h3>
          <button className="theme-close" onClick={onClose}>✕</button>
        </div>
        <div className="theme-grid">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`theme-option ${theme === t.id ? 'selected' : ''}`}
              style={{ background: t.bg, borderBottomColor: t.accent }}
              onClick={() => pick(t.id)}
            >
              <span className="theme-accent-dot" style={{ background: t.accent }} />
              <span className="theme-label">{t.label}</span>
              {theme === t.id && <span className="theme-check">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
