import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getSetList, getCardCount, getCardsBySet } from '../lib/database';
import { generateSealedPacks } from '../draft/draft-engine';
import { buildDeck } from '../draft/bot-ai';
import './HomeScreen.css';

export function HomeScreen() {
  const {
    setScreen, selectedSet, setSelectedSet,
    setTotalCards, syncing, syncMessage, setSyncing,
    setDraftPool, setDeck, setSealedPacks,
    currentUser,
  } = useAppStore();

  function handlePlayOnline() {
    setScreen(currentUser ? 'online_lobby' : 'login');
  }

  const [sets, setSets] = useState<{ set_code: string; set_name: string; card_count: number }[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    loadSets();
  }, []);

  async function loadSets() {
    try {
      const setList = await getSetList();
      setSets(setList);
      const count = await getCardCount();
      setTotalCards(count);
    } catch (e) {
      console.error('Failed to load sets:', e);
    }
  }

  function handleStartDraft() {
    if (!selectedSet) return;
    setScreen('draft');
  }

  async function handleStartSealed() {
    if (!selectedSet || syncing) return;
    setSyncing(true, 'Generating sealed pool...');
    try {
      const cards = await getCardsBySet(selectedSet);
      if (cards.length < 14) {
        setErrorMsg(`Set "${selectedSet.toUpperCase()}" has only ${cards.length} cards. Need at least 14.`);
        setTimeout(() => setErrorMsg(''), 5000);
        return;
      }
      const packs = generateSealedPacks(cards);
      setSealedPacks(packs);
      setScreen('sealed');
    } catch (e) {
      console.error('Sealed failed:', e);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="home-screen animate-fade-in">
      <div className="home-hero">
        <h1 className="home-title">Magic Draft Simulator</h1>
        <p className="home-subtitle">Draft, build, and battle against AI</p>
      </div>

      <div className="home-content">
        {/* Play Section */}
        <div className="home-section glass">
          <h2 className="section-title">Play</h2>

          {sets.length > 0 ? (
            <>
              <label className="section-label">Select Set</label>
              <select
                className="set-select"
                value={selectedSet}
                onChange={(e) => setSelectedSet(e.target.value)}
              >
                {sets.map(s => (
                  <option key={s.set_code} value={s.set_code}>
                    {s.set_name} ({s.set_code.toUpperCase()}) - {s.card_count} cards
                  </option>
                ))}
              </select>

              {errorMsg && (
                <div style={{ background: 'rgba(231,76,60,0.15)', border: '1px solid rgba(231,76,60,0.4)', borderRadius: 8, padding: '8px 14px', marginBottom: 10, color: '#e74c3c', fontSize: 13 }}>
                  {errorMsg}
                </div>
              )}
              <div className="home-mode-buttons">
                <div className="home-mode-card" onClick={handleStartDraft}>
                  <div className="home-mode-icon">🃏</div>
                  <div className="home-mode-name">Draft</div>
                  <div className="home-mode-desc">8 players · 3 rounds · pick by pick</div>
                </div>
                <div className="home-mode-card" onClick={handleStartSealed}>
                  <div className="home-mode-icon">📦</div>
                  <div className="home-mode-name">Sealed</div>
                  <div className="home-mode-desc">6 boosters · build directly · quick start</div>
                </div>
              </div>
            </>
          ) : (
            <div className="home-empty">
              <p>No card sets loaded yet.</p>
              <p className="text-muted">Import a set below to get started.</p>
            </div>
          )}
        </div>

        {/* Online Play */}
        <div className="home-section glass">
          <h2 className="section-title">Online</h2>
          <div className="home-mode-buttons">
            <div className="home-mode-card" onClick={handlePlayOnline}>
              <div className="home-mode-icon">🌐</div>
              <div className="home-mode-name">Jogar Online</div>
              <div className="home-mode-desc">1v1 com amigos · draft ou sealed</div>
            </div>
          </div>
          {currentUser && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              Logado como <strong>{currentUser.displayName}</strong>
            </p>
          )}
        </div>

        {syncing && (
          <div className="home-section glass">
            <div className="sync-status">
              <div className="sync-spinner" />
              <span>{syncMessage}</span>
            </div>
          </div>
        )}

        {/* Available Sets */}
        {sets.length > 0 && (
          <div className="home-section glass">
            <h2 className="section-title">Available Sets ({sets.length})</h2>
            <div className="set-grid">
              {sets.map(s => (
                <div
                  key={s.set_code}
                  className={`set-chip ${selectedSet === s.set_code ? 'active' : ''}`}
                  onClick={() => setSelectedSet(s.set_code)}
                >
                  <span className="set-chip-code">{s.set_code.toUpperCase()}</span>
                  <span className="set-chip-name">{s.set_name}</span>
                  <span className="set-chip-count">{s.card_count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
