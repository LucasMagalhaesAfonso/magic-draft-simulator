import { useEffect, useState, Component, type ReactNode } from 'react';
import { useAppStore } from './store/useAppStore';
import { getCardCount, getSetList } from './lib/database';
import { seedBundledSets, fetchAltArt } from './lib/scryfall';
import { Header } from './components/shared/Header';
import { HomeScreen } from './components/HomeScreen';
import { DraftScreen } from './components/DraftScreen';
import { DeckBuilderScreen } from './components/DeckBuilderScreen';
import { GameScreen } from './components/GameScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { SealedRevealScreen } from './components/SealedRevealScreen';
import { LoginScreen } from './components/online/LoginScreen';
import { UpdateChecker } from './components/UpdateChecker';
import { LobbyScreen } from './components/online/LobbyScreen';
import { OnlineDraftScreen } from './components/online/OnlineDraftScreen';
import { onAuthChange } from './lib/firebase';
import './styles/global.css';
import './components/shared/Header.css';

class ErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', gap: 16, padding: 40, textAlign: 'center',
          background: 'var(--bg-primary)', color: 'var(--text-primary)',
        }}>
          <h2 style={{ color: 'var(--danger, #e74c3c)' }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 500 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => { this.setState({ hasError: false, error: null }); this.props.onReset(); }}
          >
            Return to Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const { screen, setDbReady, setTotalCards, setCurrentUser, setSyncing } = useAppStore();
  const [seedError, setSeedError] = useState<string | null>(null);

  useEffect(() => {
    initDatabase();
    // Restore Firebase session if user was already logged in
    const unsub = onAuthChange((user) => {
      if (user) {
        setCurrentUser({
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || user.email?.split('@')[0] || 'Player',
        });
      } else {
        setCurrentUser(null);
      }
    });
    return () => unsub();
  }, []);

  async function initDatabase() {
    setSeedError(null);
    try {
      const count = await getCardCount();
      setTotalCards(count);

      // Check which bundled sets are missing and seed only those
      const existingSets = await getSetList();
      const existingCodes = new Set(existingSets.map(s => s.set_code.toLowerCase()));
      const missingSets = ['tdm', 'ltr'].filter(s => !existingCodes.has(s));

      if (missingSets.length > 0) {
        setSyncing(true, 'Preparando cards...');
        try {
          await seedBundledSets((p) => setSyncing(true, p.message), missingSets);
        } catch (seedErr) {
          const msg = seedErr instanceof Error ? seedErr.message : String(seedErr);
          console.error('[initDatabase] Seed failed:', msg);
          setSyncing(false);
          setSeedError(msg);
          setDbReady(true);
          return;
        }
        setSyncing(false);
        const newCount = await getCardCount();
        setTotalCards(newCount);
      }

      // Fetch alt art silently for any set that's missing it
      for (const set of ['tdm', 'ltr']) {
        if (existingCodes.has(set) && !localStorage.getItem(`alt_art_${set}`)) {
          fetchAltArt(set).catch(() => {});
        }
      }

      setDbReady(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Database init failed:', msg);
      setSeedError(msg);
      setDbReady(true);
    }
  }

  function renderScreen() {
    switch (screen) {
      case 'home':
        return <HomeScreen />;
      case 'draft':
        return <DraftScreen />;
      case 'deckbuilder':
        return <DeckBuilderScreen />;
      case 'game':
        return <GameScreen />;
      case 'settings':
        return <SettingsScreen />;
      case 'sealed':
        return <SealedRevealScreen />;
      case 'login':
        return <LoginScreen />;
      case 'online_lobby':
        return <LobbyScreen />;
      case 'online_game':
        return <GameScreen multiplayerMode />;
      case 'online_draft':
        return <OnlineDraftScreen />;
      default:
        return <HomeScreen />;
    }
  }

  return (
    <div className="app-layout">
      <Header />
      <main className="app-main">
        <ErrorBoundary onReset={() => useAppStore.getState().setScreen('home')}>
          {renderScreen()}
        </ErrorBoundary>
      </main>
      <UpdateChecker />
      {seedError && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(180,30,30,0.97)', color: '#fff', borderRadius: 10,
          padding: '16px 24px', zIndex: 99999, maxWidth: 480, textAlign: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠️ Erro ao carregar cards</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 12, wordBreak: 'break-all' }}>{seedError}</div>
          <button
            className="btn btn-gold btn-sm"
            onClick={() => initDatabase()}
          >
            🔄 Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
