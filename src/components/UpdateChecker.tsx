import { useEffect, useState } from 'react';

interface UpdateInfo {
  version: string;
  body: string | null;
}

export function UpdateChecker() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<'idle' | 'downloading' | 'done'>('idle');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Only run in Tauri environment
    if (!('__TAURI_INTERNALS__' in window)) return;

    async function checkForUpdate() {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const result = await check();
        if (result) {
          setUpdate({ version: result.version, body: result.body ?? null });
        }
      } catch (e) {
        // Non-fatal — offline or no update available
        console.log('[Updater] No update available or offline:', e);
      }
    }

    // Check after 3 seconds to not block initial load
    const timer = setTimeout(checkForUpdate, 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!update) return null;

  async function handleUpdate() {
    if (status !== 'idle') return;
    setStatus('downloading');
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const result = await check();
      if (!result) return;

      let downloaded = 0;
      let total = 0;
      await result.downloadAndInstall((event) => {
        if (event.event === 'Started')    { total = event.data.contentLength ?? 0; }
        if (event.event === 'Progress')   { downloaded += event.data.chunkLength; setProgress(total > 0 ? Math.round(downloaded / total * 100) : 0); }
        if (event.event === 'Finished')   { setStatus('done'); }
      });
      await relaunch();
    } catch (e) {
      console.error('[Updater] Install failed:', e);
      setStatus('idle');
    }
  }

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(15,10,30,0.97)', border: '1px solid rgba(255,200,50,0.4)',
      borderRadius: 12, padding: '14px 20px', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 16,
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      minWidth: 320, maxWidth: 480,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#ffd700', fontSize: 14 }}>
          🎉 Nova versão disponível: {update.version}
        </div>
        {update.body && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4, lineHeight: 1.4 }}>
            {update.body.slice(0, 120)}{update.body.length > 120 ? '...' : ''}
          </div>
        )}
        {status === 'downloading' && (
          <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#ffd700', transition: 'width 0.3s', borderRadius: 2 }} />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {status === 'idle' && (
          <>
            <button
              onClick={() => setUpdate(null)}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.6)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}
            >
              Agora não
            </button>
            <button
              onClick={handleUpdate}
              style={{ background: '#ffd700', color: '#000', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
            >
              Atualizar
            </button>
          </>
        )}
        {status === 'downloading' && (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
            {progress > 0 ? `${progress}%` : 'Baixando...'}
          </span>
        )}
        {status === 'done' && (
          <span style={{ fontSize: 12, color: '#4ecdc4' }}>Reiniciando...</span>
        )}
      </div>
    </div>
  );
}
