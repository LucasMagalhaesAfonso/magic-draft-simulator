import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getSetList, getCardCount, getCardsBySet, clearAllCards } from '../lib/database';
import { syncSingleSet, syncAllCards, type SyncProgress } from '../lib/scryfall';
import { generateSealedPacks } from '../draft/draft-engine';
import { buildDeck } from '../draft/bot-ai';
import './HomeScreen.css';

export function HomeScreen() {
  const {
    setScreen, selectedSet, setSelectedSet,
    setTotalCards, syncing, syncMessage, setSyncing,
    setDraftPool, setDeck, setSealedPacks,
  } = useAppStore();

  const [sets, setSets] = useState<{ set_code: string; set_name: string; card_count: number }[]>([]);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [newSetCode, setNewSetCode] = useState('');
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

  async function handleSyncSet() {
    const code = newSetCode.trim().toLowerCase();
    if (!code || syncing) return;

    setSyncing(true, `Syncing ${code.toUpperCase()}...`);
    try {
      await syncSingleSet(code, (p) => {
        setSyncProgress(p);
        setSyncing(true, p.message);
      });
      setNewSetCode('');
      await loadSets();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Sync failed:', e);
      setSyncProgress({ phase: 'error', current: 0, total: 0, message: `Error: ${msg}` });
      // Keep error visible for 5 seconds
      await new Promise(r => setTimeout(r, 5000));
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }

  async function handleSyncAll() {
    if (syncing) return;
    setSyncing(true, 'Starting full sync...');
    try {
      await syncAllCards((p) => {
        setSyncProgress(p);
        setSyncing(true, p.message);
      });
      await loadSets();
    } catch (e) {
      console.error('Full sync failed:', e);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
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

        {/* Import Cards Section */}
        <div className="home-section glass">
          <h2 className="section-title">Import Cards</h2>

          <div className="sync-row">
            <input
              type="text"
              className="sync-input"
              placeholder="Set code (e.g. tdm, lrw, mkm)"
              value={newSetCode}
              onChange={(e) => setNewSetCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSyncSet()}
              disabled={syncing}
            />
            <button className="btn btn-primary" onClick={handleSyncSet} disabled={syncing || !newSetCode.trim()}>
              Import Set
            </button>
          </div>

          <button className="btn sync-all-btn" onClick={handleSyncAll} disabled={syncing}>
            Import ALL Cards (~300MB download)
          </button>


          {syncing && (
            <div className="sync-status">
              <div className="sync-spinner" />
              <span>{syncMessage}</span>
              {syncProgress && syncProgress.total > 0 && (
                <div className="sync-bar">
                  <div
                    className="sync-bar-fill"
                    style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

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
