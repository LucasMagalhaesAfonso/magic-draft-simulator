import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { ThemePicker } from '../ThemePicker';
import type { Screen } from '../../lib/types';

const THEME_DOTS: Record<string, string> = {
  spark:     '#d4a029',
  nyx:       '#00d2d3',
  phyrexian: '#39ff14',
  kamigawa:  '#ff2d95',
  obscura:   '#a8a8a8',
};

const navItems: { screen: Screen; label: string }[] = [
  { screen: 'home', label: 'Home' },
  { screen: 'settings', label: 'Settings' },
];

export function Header() {
  const { screen, setScreen, totalCards, theme } = useAppStore();
  const [showTheme, setShowTheme] = useState(false);

  return (
    <>
      <header className="header glass">
        <div className="header-brand" onClick={() => setScreen('home')}>
          <span className="header-logo">&#9876;</span>
          <span className="header-title">Magic Draft</span>
        </div>

        <nav className="header-nav">
          {navItems.map(item => (
            <button
              key={item.screen}
              className={`header-nav-btn ${screen === item.screen ? 'active' : ''}`}
              onClick={() => setScreen(item.screen)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="header-info">
          <span className="header-card-count">
            {totalCards > 0 ? `${totalCards.toLocaleString()} cards` : 'No cards loaded'}
          </span>
          <button
            className="header-theme-btn"
            onClick={() => setShowTheme(v => !v)}
            title="Change theme"
          >
            <span
              className="header-theme-dot"
              style={{ background: THEME_DOTS[theme] ?? '#888' }}
            />
            Theme
          </button>
        </div>
      </header>

      {showTheme && <ThemePicker onClose={() => setShowTheme(false)} />}
    </>
  );
}
