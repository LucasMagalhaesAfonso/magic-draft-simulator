import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore, type ThemeId, type PlaymatId, type AiDifficulty, type AiProvider } from '../store/useAppStore';
import { testApiKey, testOllama } from '../engine/llm-ai';
import { aiBrain, type AiBrainStats } from '../engine/ai-brain';
import { SoundManager } from '../engine/sound-manager';
import { VfxManager } from './game/VfxLayer';
import { getHumanLearnStats, resetHumanLearn } from '../draft/bot-ai';
import { getSetList, deleteSet } from '../lib/database';
import { seedBundledSets, syncSingleSet } from '../lib/scryfall';
import { getRatingsStats, hasRatingsData, preloadRatings } from '../lib/seventeen-lands';
import * as SelfPlay from '../engine/self-play';
import { gameRecorder, type GameRecord } from '../engine/game-recorder';
import { getCoverageStats, getComplexCards, type CardCoverage } from '../engine/effect-coverage';
import { generateLlmEffectsForSet } from '../engine/generated-effects-db';
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
  { id: 'eldrazi',   label: '✦ Eldrazi',  accent: '#ff6a00', bg: 'linear-gradient(135deg, #0f0800, #1e1000)' },
];


// ── Sound Settings ────────────────────────────────────────────────────────────
function SoundSettings() {
  const [enabled, setEnabled] = useState(SoundManager.enabled);
  const [volume, setVolume]   = useState(Math.round(SoundManager.volume * 100));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <button
        className={`btn btn-sm ${enabled ? 'btn-gold' : ''}`}
        onClick={() => {
          const next = !enabled;
          SoundManager.setEnabled(next);
          setEnabled(next);
          if (next) { SoundManager.init(); SoundManager.play('card_draw'); }
        }}
        style={{ minWidth: 90 }}
      >
        {enabled ? '🔊 Ligado' : '🔇 Mudo'}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 160 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Volume</span>
        <input
          type="range" min={0} max={100} value={volume}
          onChange={e => { const v = Number(e.target.value); setVolume(v); SoundManager.setVolume(v / 100); }}
          style={{ flex: 1, accentColor: 'var(--gold)' }}
          disabled={!enabled}
        />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 32 }}>{volume}%</span>
      </div>
      <button className="btn btn-sm" style={{ fontSize: 12 }} disabled={!enabled}
        onClick={() => { SoundManager.init(); SoundManager.play('spell_cast'); }}>
        ▶ Testar
      </button>
    </div>
  );
}

export function SettingsScreen() {
  const { theme, setTheme, playmat, playmatArt, playmatPosition, playmatSize, setPlaymat, setPlaymatPosition, setPlaymatSize, landArts, setLandArt, resetLandArts, sleeveArt, setSleeveArt, aiDifficulty, setAiDifficulty, aiProvider, setAiProvider, anthropicApiKey, setAnthropicApiKey, ollamaUrl, setOllamaUrl, ollamaModel, setOllamaModel } = useAppStore();
  const [sleeveZoom, setSleeveZoom] = useState(false);
  const [customArtUrl, setCustomArtUrl] = useState(playmatArt || '');
  const [apiKeyInput, setApiKeyInput] = useState(anthropicApiKey);
  const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [apiKeyError, setApiKeyError] = useState('');
  const [ollamaUrlInput, setOllamaUrlInput] = useState(ollamaUrl);
  const [ollamaModelInput, setOllamaModelInput] = useState(ollamaModel);
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [ollamaError, setOllamaError] = useState('');

  // Game history
  const [gameHistory, setGameHistory] = useState<GameRecord[]>(() => gameRecorder.getHistory());
  const [expandedGame, setExpandedGame] = useState<string | null>(null);

  useEffect(() => {
    gameRecorder.load().then(() => setGameHistory(gameRecorder.getHistory()));
  }, []);

  // Card coverage
  const [coverageStats, setCoverageStats] = useState(() => getCoverageStats());
  const [complexCards, setComplexCards]   = useState<CardCoverage[]>(() => getComplexCards());
  const [llmGenerating, setLlmGenerating] = useState(false);
  const [llmProgress, setLlmProgress]     = useState({ done: 0, total: 0, current: '' });
  const llmAbortRef = useRef({ aborted: false });

  // AI Brain stats
  const [aiStats, setAiStats] = useState<AiBrainStats>(() => aiBrain.getStats());
  const [aiResetting, setAiResetting] = useState(false);

  // Self-play training
  const [selfPlayStats, setSelfPlayStats] = useState<SelfPlay.SelfPlayStats>(() => SelfPlay.getStats());
  const [selfPlayTarget, setSelfPlayTarget] = useState(20);
  const [selfPlaySet, setSelfPlaySet] = useState<string>('all');
  const [exportingModel, setExportingModel] = useState(false);

  // 17lands ratings status
  const [landsStats, setLandsStats] = useState(() => ({ loaded: hasRatingsData(), ...getRatingsStats() }));

  // Draft learning stats
  const [draftStats, setDraftStats] = useState(() => getHumanLearnStats());
  const [draftResetting, setDraftResetting] = useState(false);

  // Imported sets
  const [importedSets, setImportedSets] = useState<{ set_code: string; set_name: string; card_count: number }[]>([]);
  const [deletingSet, setDeletingSet] = useState<string | null>(null);
  const [reimportingSet, setReimportingSet] = useState<string | null>(null);
  const [reimportMsg, setReimportMsg] = useState<string>('');

  // Alt art style filters (per-set)
  const [altArtBySet, setAltArtBySet] = useState<Record<string, { style: string; count: number; samples: string[] }[]>>({});
  const [disabledBySet, setDisabledBySet] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('alt_art_disabled_styles') || '{}'); } catch { return {}; }
  });

  useEffect(() => {
    getSetList().then(setImportedSets).catch(() => {});
    // Scan alt art keys for per-set style counts
    const bySet: Record<string, Record<string, { count: number; samples: string[] }>> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('alt_art_') && key !== 'alt_art_disabled_styles') {
        const setCode = key.replace('alt_art_', '');
        try {
          const map = JSON.parse(localStorage.getItem(key)!);
          if (!bySet[setCode]) bySet[setCode] = {};
          for (const [cardName, alts] of Object.entries(map) as Array<[string, Array<{ style?: string; small?: string; normal?: string }>]>) {
            // Only pick one sample per card name per style
            const usedStyleForCard = new Set<string>();
            for (const a of alts) {
              const s = a.style || 'Alternate';
              if (!bySet[setCode][s]) bySet[setCode][s] = { count: 0, samples: [] };
              bySet[setCode][s].count++;
              const img = a.small || a.normal || '';
              if (img && bySet[setCode][s].samples.length < 4 && !usedStyleForCard.has(s)) {
                bySet[setCode][s].samples.push(img);
                usedStyleForCard.add(s);
              }
            }
          }
        } catch { /* ignore */ }
      }
    }
    const result: Record<string, { style: string; count: number; samples: string[] }[]> = {};
    for (const [sc, styles] of Object.entries(bySet)) {
      result[sc] = Object.entries(styles).map(([style, { count, samples }]) => ({ style, count, samples })).sort((a, b) => b.count - a.count);
    }
    setAltArtBySet(result);
  }, []);

  useEffect(() => {
    // Refresh stats every 5 seconds while on this screen
    const id = setInterval(() => {
      setAiStats(aiBrain.getStats());
      if (SelfPlay.isRunning()) setSelfPlayStats(SelfPlay.getStats());
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Load 17lands ratings and update status
    preloadRatings().then(() => {
      setLandsStats({ loaded: hasRatingsData(), ...getRatingsStats() });
    });
  }, []);

  function handleResetBrain() {
    setAiResetting(true);
    aiBrain.reset().then(() => {
      setAiStats(aiBrain.getStats());
      setAiResetting(false);
    });
  }

  async function handleExportModel() {
    setExportingModel(true);
    try {
      // Sync from cloud first so the export includes global training data
      await aiBrain.syncToCloud().catch(() => {});
      await aiBrain.syncFromCloud().catch(() => {});
      const json = await aiBrain.exportForBundling();
      // Download file
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ai-brain-prebuilt.json';
      a.click();
      URL.revokeObjectURL(url);
      setAiStats(aiBrain.getStats());
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExportingModel(false);
    }
  }

  function handleStartSelfPlay() {
    if (SelfPlay.isRunning()) {
      SelfPlay.stop();
      // Re-enable VFX + sound after training stops
      VfxManager.setEnabled(true);
      SoundManager.setEnabled(true);
      return;
    }
    // Disable VFX + sound during headless self-play (prevents Settings page shake)
    VfxManager.setEnabled(false);
    SoundManager.setEnabled(false);
    SelfPlay.run(selfPlayTarget, {
      onProgress: (s) => setSelfPlayStats({ ...s }),
      onDone: (s) => {
        setSelfPlayStats({ ...s });
        setAiStats(aiBrain.getStats());
        VfxManager.setEnabled(true);
        SoundManager.setEnabled(true);
      },
    }, selfPlaySet);
    setSelfPlayStats(SelfPlay.getStats());
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
      <div style={{ position: 'fixed', top: 10, right: 14, fontSize: 10, color: 'rgba(255,255,255,0.25)', pointerEvents: 'none', zIndex: 10 }}>
        v{__APP_VERSION__}
      </div>
      <div className="settings-content">

        {/* AI Opponent Section */}
        <div className="settings-section glass">
          <h2 className="settings-title">🤖 AI Opponent</h2>
          <p className="settings-desc">Choose the difficulty level. Easy and Medium use the offline heuristic AI. Hard and Extreme use an LLM for strategic decisions.</p>

          {/* Difficulty selector */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {([
              { id: 'easy',    label: 'Easy',    desc: 'Makes random mistakes on purpose' },
              { id: 'medium',  label: 'Medium',  desc: 'Solid heuristic AI (default)' },
              { id: 'hard',    label: 'Hard',    desc: 'LLM decides main phase and attacks' },
              { id: 'extreme', label: 'Extreme', desc: 'LLM with full context and strategic reasoning' },
            ] as { id: AiDifficulty; label: string; desc: string }[]).map(d => (
              <button
                key={d.id}
                className={`btn btn-sm ${aiDifficulty === d.id ? 'btn-gold' : ''}`}
                title={d.desc}
                onClick={() => setAiDifficulty(d.id)}
                style={{ minWidth: 80, position: 'relative' }}
              >
                {d.label}
                {aiDifficulty === d.id && <span style={{ marginLeft: 4 }}>✓</span>}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, marginTop: 0 }}>
            {aiDifficulty === 'easy' && 'Easy: AI randomly skips optimal plays ~30% of the time.'}
            {aiDifficulty === 'medium' && 'Medium: Heuristic AI using 17lands and MTGO data. 100% offline.'}
            {aiDifficulty === 'hard' && 'Hard: LLM decides main phase and attacks. Falls back to heuristic if LLM unavailable.'}
            {aiDifficulty === 'extreme' && 'Extreme: LLM with full context. Falls back to heuristic if LLM unavailable.'}
          </p>

          {/* LLM provider config (shown for hard/extreme) */}
          {(aiDifficulty === 'hard' || aiDifficulty === 'extreme') && (
            <div style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 8, padding: 12 }}>
              {/* Provider selector */}
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>LLM Provider</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {([
                  { id: 'ollama',    label: '🦙 Ollama (local, free)', desc: 'Runs on your machine via Ollama' },
                  { id: 'anthropic', label: '☁️ Anthropic API (paid)', desc: 'Claude via Anthropic API key' },
                ] as { id: AiProvider; label: string; desc: string }[]).map(p => (
                  <button
                    key={p.id}
                    className={`btn btn-sm ${aiProvider === p.id ? 'btn-gold' : ''}`}
                    title={p.desc}
                    onClick={() => setAiProvider(p.id)}
                    style={{ flex: 1 }}
                  >
                    {p.label}
                    {aiProvider === p.id && <span style={{ marginLeft: 4 }}>✓</span>}
                  </button>
                ))}
              </div>

              {/* Ollama config */}
              {aiProvider === 'ollama' && (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Ollama must be running locally. Install from <strong>ollama.ai</strong> and run <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: 3 }}>ollama pull llama3.1</code>.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 50 }}>URL</span>
                      <input
                        type="text"
                        placeholder="http://localhost:11434"
                        value={ollamaUrlInput}
                        onChange={e => { setOllamaUrlInput(e.target.value); setOllamaStatus('idle'); }}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'monospace' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 50 }}>Model</span>
                      <input
                        type="text"
                        placeholder="llama3.2:3b"
                        value={ollamaModelInput}
                        onChange={e => { setOllamaModelInput(e.target.value); setOllamaStatus('idle'); }}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'monospace' }}
                      />
                    </div>
                    <button
                      className="btn btn-sm"
                      disabled={ollamaStatus === 'testing'}
                      style={{ alignSelf: 'flex-start' }}
                      onClick={async () => {
                        const url = ollamaUrlInput.trim() || 'http://localhost:11434';
                        const model = ollamaModelInput.trim() || 'llama3.1';
                        setOllamaStatus('testing');
                        const result = await testOllama(url, model);
                        if (result.ok) {
                          setOllamaUrl(url);
                          setOllamaModel(model);
                          setOllamaStatus('ok');
                        } else {
                          setOllamaStatus('error');
                          setOllamaError(result.error || 'Could not connect to Ollama');
                        }
                      }}
                    >
                      {ollamaStatus === 'testing' ? '...' : 'Save & Test'}
                    </button>
                  </div>
                  {ollamaStatus === 'ok' && (
                    <p style={{ fontSize: 12, color: '#4ade80', marginTop: 6 }}>✓ Ollama connected — model ready</p>
                  )}
                  {ollamaStatus === 'error' && (
                    <p style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>✗ {ollamaError}</p>
                  )}
                  {ollamaUrl && ollamaModel && ollamaStatus === 'idle' && (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>Configured: {ollamaModel} @ {ollamaUrl}</p>
                  )}
                </div>
              )}

              {/* Anthropic config */}
              {aiProvider === 'anthropic' && (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Anthropic API key — get yours at <strong>console.anthropic.com</strong>. Stored only in your browser.
                  </p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="password"
                      placeholder="sk-ant-..."
                      value={apiKeyInput}
                      onChange={e => { setApiKeyInput(e.target.value); setApiKeyStatus('idle'); }}
                      style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'monospace' }}
                    />
                    <button
                      className="btn btn-sm"
                      disabled={apiKeyStatus === 'testing'}
                      onClick={async () => {
                        const key = apiKeyInput.trim();
                        if (!key) { setApiKeyStatus('error'); setApiKeyError('Enter your API key first'); return; }
                        setApiKeyStatus('testing');
                        const result = await testApiKey(key);
                        if (result.ok) {
                          setAnthropicApiKey(key);
                          setApiKeyStatus('ok');
                        } else {
                          setApiKeyStatus('error');
                          setApiKeyError(result.error || 'Unknown error');
                        }
                      }}
                    >
                      {apiKeyStatus === 'testing' ? '...' : 'Save & Test'}
                    </button>
                  </div>
                  {apiKeyStatus === 'ok' && (
                    <p style={{ fontSize: 12, color: '#4ade80', marginTop: 6 }}>✓ API key saved and validated</p>
                  )}
                  {apiKeyStatus === 'error' && (
                    <p style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>✗ {apiKeyError}</p>
                  )}
                  {anthropicApiKey && apiKeyStatus === 'idle' && (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>✓ API key is configured</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Game History Section */}
        <div className="settings-section glass">
          <h2 className="settings-title">📜 Histórico de Partidas</h2>
          {(() => {
            const stats = gameRecorder.getStats();
            return (
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Total: <strong style={{ color: 'var(--text-primary)' }}>{stats.total}</strong>
                </span>
                <span style={{ fontSize: 13, color: '#4ade80' }}>
                  Vitórias: <strong>{stats.wins}</strong>
                </span>
                <span style={{ fontSize: 13, color: '#f87171' }}>
                  Derrotas: <strong>{stats.losses}</strong>
                </span>
                {stats.draws > 0 && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    Empates: <strong>{stats.draws}</strong>
                  </span>
                )}
                {stats.total > 0 && (
                  <span style={{ fontSize: 13, color: 'var(--gold)' }}>
                    Win rate: <strong>{Math.round((stats.wins / stats.total) * 100)}%</strong>
                  </span>
                )}
              </div>
            );
          })()}
          {gameHistory.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Nenhuma partida registrada ainda. Jogue uma partida para começar.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
              {gameHistory.map(game => {
                const isExpanded = expandedGame === game.id;
                const winColor = game.winner === 'human' ? '#4ade80' : game.winner === 'ai' ? '#f87171' : '#a3a3a3';
                const winLabel = game.winner === 'human' ? '✓ Vitória' : game.winner === 'ai' ? '✗ Derrota' : '= Empate';
                const date = game.startedAt ? new Date(game.startedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?';
                return (
                  <div key={game.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, overflow: 'hidden' }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', cursor: 'pointer' }}
                      onClick={() => setExpandedGame(isExpanded ? null : game.id)}
                    >
                      <span style={{ fontSize: 13, color: winColor, fontWeight: 600, minWidth: 72 }}>{winLabel}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{date}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{game.totalTurns} turnos</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>▼</span>
                    </div>
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '8px 12px', maxHeight: 220, overflowY: 'auto' }}>
                        {game.actions.length === 0 ? (
                          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Sem ações gravadas.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {game.actions.map((a, i) => (
                              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                                <span style={{ color: 'var(--text-secondary)', minWidth: 52, flexShrink: 0 }}>T{a.turn} {a.isHuman ? '👤' : '🤖'}</span>
                                <span style={{ color: a.isHuman ? '#93c5fd' : '#fbbf24', flex: 1 }}>{a.description}</span>
                                <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{a.life[0]}❤ vs {a.life[1]}❤</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {gameHistory.length > 0 && (
            <button
              className="btn btn-sm"
              style={{ marginTop: 12 }}
              onClick={() => {
                const json = gameRecorder.exportJson();
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `mtg-game-history-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              ↓ Exportar histórico JSON
            </button>
          )}
        </div>

        {/* Card Coverage Section */}
        <div className="settings-section glass">
          <h2 className="settings-title">📊 Cobertura de Cartas</h2>
          <p className="settings-desc">Mostra quantas cartas dos sets importados têm efeitos implementados no engine. Cartas sem cobertura podem ser geradas com IA (Ollama).</p>

          {(() => {
            const s = coverageStats;
            const barW = (n: number) => `${s.total > 0 ? Math.round((n / s.total) * 100) : 0}%`;
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: '#4ade80' }}>✓ Manual: <strong>{s.hardcoded}</strong></span>
                  <span style={{ fontSize: 13, color: '#60a5fa' }}>⚡ Auto: <strong>{s.generated}</strong></span>
                  <span style={{ fontSize: 13, color: '#f87171' }}>✗ Complexas: <strong>{s.complex}</strong></span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Sem texto: <strong>{s.no_oracle}</strong></span>
                  {s.total > 0 && <span style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700 }}>Coberto: {s.pct}%</span>}
                </div>
                {s.total > 0 && (
                  <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: barW(s.hardcoded), background: '#4ade80', transition: 'width 0.3s' }} />
                    <div style={{ width: barW(s.generated), background: '#60a5fa', transition: 'width 0.3s' }} />
                    <div style={{ width: barW(s.no_oracle), background: 'rgba(255,255,255,0.15)', transition: 'width 0.3s' }} />
                  </div>
                )}
                {s.total === 0 && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Importe um set para ver a cobertura.</p>}
              </div>
            );
          })()}

          <div style={{ marginBottom: 16 }}>
            {!llmGenerating ? (
              <button
                className="btn btn-sm btn-gold"
                disabled={complexCards.length === 0 || !ollamaModel}
                onClick={async () => {
                  setLlmGenerating(true);
                  llmAbortRef.current.aborted = false;
                  const toGenerate = complexCards.map(c => ({
                    name: c.name, oracle_text: c.oracle_text, type_line: c.type_line, keywords: [] as string[],
                  }));
                  if (toGenerate.length === 0) { setLlmGenerating(false); return; }
                  await generateLlmEffectsForSet(
                    toGenerate,
                    ollamaUrl || 'http://localhost:11434',
                    ollamaModel || 'llama3.2:3b',
                    (done, total, current) => {
                      setLlmProgress({ done, total, current });
                      if (done === total) {
                        setCoverageStats(getCoverageStats());
                        setComplexCards(getComplexCards());
                        setLlmGenerating(false);
                      }
                    },
                    llmAbortRef.current
                  );
                }}
              >
                🤖 Gerar com IA ({complexCards.length} cartas pendentes)
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Gerando {llmProgress.done}/{llmProgress.total}{llmProgress.current ? ` — ${llmProgress.current}` : ''}
                </span>
                <button className="btn btn-sm" onClick={() => { llmAbortRef.current.aborted = true; setLlmGenerating(false); }}>
                  Parar
                </button>
              </div>
            )}
          </div>

          {complexCards.length > 0 && (
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Cartas complexas pendentes ({complexCards.length}) — precisam de IA ou implementação manual:
              </p>
              <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {complexCards.slice(0, 100).map(c => (
                  <div key={c.name} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '6px 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.type_line}</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>{c.oracle_text}</p>
                  </div>
                ))}
                {complexCards.length > 100 && (
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: 8 }}>
                    +{complexCards.length - 100} mais cartas
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

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

        {/* Sound Section */}
        <div className="settings-section glass">
          <h2 className="settings-title">🔊 Som</h2>
          <p className="settings-desc">Volume dos efeitos sonoros do jogo.</p>
          <SoundSettings />
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
              <span className="settings-info-label">Exploração (temperatura)</span>
              <span className="settings-info-value ai-brain-epsilon">
                {aiStats.temperature !== undefined
                  ? `${aiStats.temperature.toFixed(2)} ${aiStats.temperature > 1.5 ? '🔥' : aiStats.temperature > 0.8 ? '🌡️' : '🎯'}`
                  : '—'}
              </span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">Última atualização</span>
              <span className="settings-info-value">{formatLastTrained(aiStats.lastTrained)}</span>
            </div>
            <div className="settings-info-item" style={{ gridColumn: '1 / -1' }}>
              <span className="settings-info-label">🌐 Modelo global</span>
              <span className="settings-info-value">
                {aiStats.cloudGamesCount > 0
                  ? `${aiStats.cloudGamesCount} partidas de todos os jogadores`
                  : 'Sincronizando...'}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn btn-muted"
              style={{ fontSize: 13 }}
              onClick={handleResetBrain}
              disabled={aiResetting}
            >
              {aiResetting ? 'Resetando...' : 'Resetar AI Brain'}
            </button>
            <button
              className="btn btn-primary"
              style={{ fontSize: 13 }}
              onClick={handleExportModel}
              disabled={exportingModel || aiStats.gamesPlayed === 0}
              title="Sincroniza com a cloud, exporta os pesos e baixa o arquivo. Mova para public/data/ e commite antes do deploy."
            >
              {exportingModel ? 'Exportando...' : '💾 Exportar para Deploy'}
            </button>
            {aiStats.gamesPlayed >= 5 && (
              <span className="ai-brain-badge">
                {aiStats.gamesPlayed >= 30 ? '🔥 Treinada' : aiStats.gamesPlayed >= 10 ? '📈 Aprendendo' : '🌱 Iniciante'}
              </span>
            )}
          </div>
        </div>

        {/* Self-Play Training */}
        <div className="settings-section glass">
          <h2 className="settings-title">⚔️ Auto-Treino (Self-Play)</h2>
          <p className="settings-desc">
            Treina a IA jogando partidas automáticas. Quanto mais jogos, mais forte ela fica.
            Ao atingir 63% de vitória, avança de fase automaticamente.
          </p>

          {/* Phase indicator */}
          <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e8c97a' }}>
                {selfPlayStats.phase === 0
                  ? '🎯 Fase 1 — Aprendendo vs Heurística'
                  : `🏆 Fase ${selfPlayStats.phase + 1} — vs IA v${selfPlayStats.phase}`}
              </span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                {selfPlayStats.phaseGames} jogos nesta fase
              </span>
            </div>
            {/* Phase win rate bar */}
            <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(selfPlayStats.phaseWinRate * 100, 100)}%`,
                background: selfPlayStats.phaseWinRate >= 0.63 ? '#4caf50' : selfPlayStats.phaseWinRate >= 0.5 ? '#e8c97a' : '#e57373',
                transition: 'width 0.5s',
                borderRadius: 4,
              }} />
              {/* Threshold marker at 63% */}
              <div style={{ position: 'absolute', top: 0, left: '63%', width: 2, height: '100%', background: 'rgba(255,255,255,0.5)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
              <span>Win rate últimos 100: {selfPlayStats.phaseGames >= 10 ? `${Math.round(selfPlayStats.phaseWinRate * 100)}%` : '—'}</span>
              <span>Meta: 63%</span>
            </div>
            {selfPlayStats.phaseJustAdvanced && (
              <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4, background: 'rgba(76,175,80,0.2)', color: '#4caf50', fontSize: 12, fontWeight: 600 }}>
                🎉 Nova fase desbloqueada! Oponente ficou mais forte.
              </div>
            )}
          </div>

          <div className="settings-info-grid">
            <div className="settings-info-item">
              <span className="settings-info-label">Partidas concluídas</span>
              <span className="settings-info-value">{selfPlayStats.gamesCompleted}</span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">Média de turnos</span>
              <span className="settings-info-value">
                {selfPlayStats.gamesCompleted > 0 ? Math.round(selfPlayStats.avgTurns) : '—'}
              </span>
            </div>
            {selfPlayStats.running && (
              <div className="settings-info-item" style={{ gridColumn: '1 / -1' }}>
                <span className="settings-info-label">Progresso</span>
                <span className="settings-info-value">
                  Jogo {selfPlayStats.currentGame}/{selfPlayStats.targetGames}
                  {' · '}Treino: {selfPlayStats.p0Wins}W · Oponente: {selfPlayStats.p1Wins}W
                </span>
              </div>
            )}
            {selfPlayStats.running && (
              <div className="settings-info-item" style={{ gridColumn: '1 / -1' }}>
                <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${selfPlayStats.targetGames > 0 ? Math.round(selfPlayStats.gamesCompleted / selfPlayStats.targetGames * 100) : 0}%`,
                    background: 'var(--accent)',
                    transition: 'width 0.4s',
                    borderRadius: 3,
                  }} />
                </div>
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <select
              value={selfPlaySet}
              onChange={e => setSelfPlaySet(e.target.value)}
              disabled={selfPlayStats.running}
              style={{ background: 'rgba(255,255,255,0.08)', color: '#eee', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '5px 10px', fontSize: 13 }}
            >
              <option value="all">Todos os sets</option>
              {importedSets.map(s => (
                <option key={s.set_code} value={s.set_code}>{s.set_code.toUpperCase()} — {s.set_name}</option>
              ))}
            </select>
            <select
              value={selfPlayTarget}
              onChange={e => setSelfPlayTarget(Number(e.target.value))}
              disabled={selfPlayStats.running}
              style={{ background: 'rgba(255,255,255,0.08)', color: '#eee', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '5px 10px', fontSize: 13 }}
            >
              {[10, 20, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n} jogos</option>)}
            </select>
            <button
              className={`btn ${selfPlayStats.running ? 'btn-muted' : 'btn-primary'}`}
              style={{ fontSize: 13 }}
              onClick={handleStartSelfPlay}
            >
              {selfPlayStats.running
                ? '⏹ Parar'
                : `▶ Treinar${selfPlaySet !== 'all' ? ' ' + selfPlaySet.toUpperCase() : ''}`}
            </button>
          </div>
          {selfPlayStats.running && selfPlayStats.setCode !== 'all' && (
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '6px 0 0' }}>
              Treinando apenas com cartas do {selfPlayStats.setCode.toUpperCase()}
            </p>
          )}
        </div>

        {/* 17lands Data */}
        <div className="settings-section glass">
          <h2 className="settings-title">📊 17lands (Draft AI)</h2>
          <p className="settings-desc">
            O draft bot usa dados reais de win-rate do 17lands para avaliar cartas melhor que o BREAD puro.
            Baixe os dados com <code style={{ fontSize: 11, background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3 }}>npx tsx tools/fetch-17lands.ts</code> e recompile.
          </p>
          <div className="settings-info-grid">
            <div className="settings-info-item">
              <span className="settings-info-label">Status</span>
              <span className="settings-info-value" style={{ color: landsStats.loaded ? '#4ecdc4' : '#ff9966' }}>
                {landsStats.loaded ? `✅ Carregado` : '⚠️ Não disponível (usando BREAD)'}
              </span>
            </div>
            {landsStats.loaded && (
              <>
                <div className="settings-info-item">
                  <span className="settings-info-label">Sets carregados</span>
                  <span className="settings-info-value">{landsStats.sets.map(s => s.toUpperCase()).join(', ')}</span>
                </div>
                <div className="settings-info-item">
                  <span className="settings-info-label">Total de cartas</span>
                  <span className="settings-info-value">{landsStats.totalCards}</span>
                </div>
              </>
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

        {/* Alt Art Styles (per set) */}
        {Object.keys(altArtBySet).length > 0 && (
          <div className="settings-section glass">
            <h2 className="settings-title">🖼️ Alt Art Styles</h2>
            <p className="settings-desc">Escolha quais estilos de arte aparecem nos boosters de cada set. Re-importe o set para as tags funcionarem.</p>
            {Object.entries(altArtBySet).map(([setCode, styles]) => {
              const disabled = disabledBySet[setCode] || [];
              return (
                <div key={setCode} style={{ marginBottom: 12 }}>
                  <h3 style={{ fontSize: 13, color: '#ccc', margin: '8px 0 4px', textTransform: 'uppercase' }}>{setCode}</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {styles.map(({ style, count, samples }) => {
                      const enabled = !disabled.includes(style);
                      return (
                        <div key={style} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, background: enabled ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.2)', opacity: enabled ? 1 : 0.5, transition: 'all 0.2s' }}>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            {samples.map((src, i) => (
                              <img key={i} src={src} alt="" style={{ width: 40, height: 56, borderRadius: 3, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }} />
                            ))}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#eee' }}>{style}</div>
                            <div style={{ fontSize: 11, color: '#888' }}>{count} variants</div>
                          </div>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() => {
                                const next = enabled
                                  ? [...disabled, style]
                                  : disabled.filter(s => s !== style);
                                const updated = { ...disabledBySet, [setCode]: next };
                                if (next.length === 0) delete updated[setCode];
                                setDisabledBySet(updated);
                                localStorage.setItem('alt_art_disabled_styles', JSON.stringify(updated));
                              }}
                            />
                            <span style={{ fontSize: 12, color: enabled ? '#4ecdc4' : '#666' }}>{enabled ? 'On' : 'Off'}</span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Card Database */}
        {importedSets.length > 0 && (
          <div className="settings-section glass">
            <h2 className="settings-title">📦 Card Database</h2>
            <p className="settings-desc">Sets importados. Re-importe se tiver problemas de carregamento.</p>
            {reimportMsg && (
              <div style={{ fontSize: 12, color: reimportMsg.startsWith('✅') ? '#4aff7a' : reimportMsg.startsWith('❌') ? '#ff6b6b' : '#ffd700', marginBottom: 8, padding: '6px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                {reimportMsg}
              </div>
            )}
            <div className="settings-info-grid">
              {importedSets.map(s => (
                <div key={s.set_code} className="settings-info-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <span className="settings-info-label">{s.set_code.toUpperCase()}</span>
                    <span className="settings-info-value" style={{ fontSize: 11 }}>{s.set_name} ({s.card_count} cards)</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      className="btn btn-muted"
                      style={{ fontSize: 11, padding: '3px 10px', color: '#ffd700' }}
                      disabled={reimportingSet === s.set_code || deletingSet === s.set_code}
                      onClick={async () => {
                        setReimportingSet(s.set_code);
                        setReimportMsg(`⏳ Reimportando ${s.set_code.toUpperCase()}...`);
                        try {
                          await deleteSet(s.set_code);
                          localStorage.removeItem(`alt_art_${s.set_code.toLowerCase()}`);
                          const bundled = ['tdm', 'ltr'];
                          if (bundled.includes(s.set_code.toLowerCase())) {
                            await seedBundledSets((p) => setReimportMsg(`⏳ ${p.message}`), [s.set_code.toLowerCase()]);
                          } else {
                            await syncSingleSet(s.set_code.toLowerCase(), (p) => setReimportMsg(`⏳ ${p.message}`));
                          }
                          const fresh = await getSetList();
                          setImportedSets(fresh);
                          setReimportMsg(`✅ ${s.set_code.toUpperCase()} reimportado!`);
                          setTimeout(() => setReimportMsg(''), 3000);
                        } catch (e: any) {
                          setReimportMsg(`❌ Erro: ${e?.message || e}`);
                        } finally {
                          setReimportingSet(null);
                        }
                      }}
                    >
                      {reimportingSet === s.set_code ? '...' : '🔄 Re-importar'}
                    </button>
                    <button
                      className="btn btn-muted"
                      style={{ fontSize: 11, padding: '3px 10px', color: '#ff6b6b' }}
                      disabled={deletingSet === s.set_code || reimportingSet === s.set_code}
                      onClick={async () => {
                        if (!confirm(`Deletar ${s.set_code.toUpperCase()} (${s.card_count} cards)?`)) return;
                        setDeletingSet(s.set_code);
                        await deleteSet(s.set_code);
                        localStorage.removeItem(`alt_art_${s.set_code.toLowerCase()}`);
                        setImportedSets(prev => prev.filter(x => x.set_code !== s.set_code));
                        setDeletingSet(null);
                      }}
                    >
                      {deletingSet === s.set_code ? '...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
