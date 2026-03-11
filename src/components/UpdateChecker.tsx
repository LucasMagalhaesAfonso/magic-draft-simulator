import { useEffect, useState } from 'react';

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; progress: number }
  | { phase: 'ready' };

export function UpdateChecker() {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const timer = setTimeout(checkForUpdate, 4000);
    return () => clearTimeout(timer);
  }, []);

  async function checkForUpdate() {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update?.available) {
        setState({ phase: 'available', version: update.version });
      }
    } catch {
      // offline or error — silent fail
    }
  }

  async function handleUpdate() {
    setState({ phase: 'downloading', progress: 0 });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const update = await check();
      if (!update?.available) return;

      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
          setState({ phase: 'downloading', progress: pct });
        } else if (event.event === 'Finished') {
          setState({ phase: 'ready' });
        }
      });

      await relaunch();
    } catch {
      // fallback: open releases page
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      openUrl('https://github.com/LucasMagalhaesAfonso/magic-draft-simulator/releases/latest');
      setState({ phase: 'idle' });
    }
  }

  if (dismissed || state.phase === 'idle') return null;

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(15,10,30,0.97)', border: '1px solid rgba(255,200,50,0.4)',
      borderRadius: 12, padding: '14px 20px', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 16,
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      minWidth: 320,
    }}>
      <div style={{ flex: 1 }}>
        {state.phase === 'available' && (
          <>
            <div style={{ fontWeight: 700, color: '#ffd700', fontSize: 14 }}>
              Nova versão disponível: v{state.version}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>
              Clique para atualizar automaticamente.
            </div>
          </>
        )}
        {state.phase === 'downloading' && (
          <>
            <div style={{ fontWeight: 700, color: '#ffd700', fontSize: 14 }}>
              Baixando atualização... {state.progress}%
            </div>
            <div style={{
              marginTop: 6, height: 4, background: 'rgba(255,255,255,0.15)',
              borderRadius: 2, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', width: `${state.progress}%`,
                background: '#ffd700', transition: 'width 0.2s',
              }} />
            </div>
          </>
        )}
        {state.phase === 'ready' && (
          <div style={{ fontWeight: 700, color: '#4ade80', fontSize: 14 }}>
            ✅ Atualização instalada! Reiniciando...
          </div>
        )}
      </div>

      {state.phase === 'available' && (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => setDismissed(true)}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}
          >
            Agora não
          </button>
          <button
            onClick={handleUpdate}
            style={{ background: '#ffd700', color: '#000', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
          >
            Atualizar
          </button>
        </div>
      )}
    </div>
  );
}
