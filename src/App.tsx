import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { getCardCount } from './lib/database';
import { Header } from './components/shared/Header';
import { HomeScreen } from './components/HomeScreen';
import { DraftScreen } from './components/DraftScreen';
import { DeckBuilderScreen } from './components/DeckBuilderScreen';
import { GameScreen } from './components/GameScreen';
import { SettingsScreen } from './components/SettingsScreen';
import './styles/global.css';
import './components/shared/Header.css';

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
      case 'collection':
        return <PlaceholderScreen name="Collection Browser" />;
      case 'settings':
        return <SettingsScreen />;
      default:
        return <HomeScreen />;
    }
  }

  return (
    <div className="app-layout">
      <Header />
      <main className="app-main">
        {renderScreen()}
      </main>
    </div>
  );
}

function PlaceholderScreen({ name }: { name: string }) {
  const { setScreen } = useAppStore();
  return (
    <div className="placeholder-screen animate-fade-in">
      <h2>{name}</h2>
      <p className="text-muted">Coming soon...</p>
      <button className="btn" onClick={() => setScreen('home')} style={{ marginTop: 20 }}>
        Back to Home
      </button>
    </div>
  );
}

export default App;
