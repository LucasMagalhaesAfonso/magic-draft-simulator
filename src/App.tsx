import { useEffect, Component, type ReactNode } from 'react';
import { useAppStore } from './store/useAppStore';
import { getCardCount } from './lib/database';
import { Header } from './components/shared/Header';
import { HomeScreen } from './components/HomeScreen';
import { DraftScreen } from './components/DraftScreen';
import { DeckBuilderScreen } from './components/DeckBuilderScreen';
import { GameScreen } from './components/GameScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { SealedRevealScreen } from './components/SealedRevealScreen';
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
  const { screen, setDbReady, setTotalCards } = useAppStore();

  useEffect(() => {
    initDatabase();
  }, []);

  async function initDatabase() {
    try {
      const count = await getCardCount();
      setTotalCards(count);
      setDbReady(true);
    } catch (e) {
      console.error('Database init failed:', e);
      // DB might not be ready yet on first launch - that's OK
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
    </div>
  );
}

export default App;
