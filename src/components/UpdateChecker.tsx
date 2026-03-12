import { useEffect, useState } from 'react';

const CURRENT_VERSION = __APP_VERSION__;
const RELEASES_API = 'https://api.github.com/repos/LucasMagalhaesAfonso/magic-draft-simulator/releases/latest';

function parseVersion(v: string) {
  return v.replace(/^v/, '').split('.').map(Number);
}
function isNewer(latest: string, current: string) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

type State =
  | { phase: 'idle' }
  | { phase: 'available'; version: string; exeUrl: string }
  | { phase: 'downloading'; progress: number }
  | { phase: 'error'; message: string; exeUrl: string }
  | { phase: 'done' };

export function UpdateChecker() {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const timer = setTimeout(checkUpdate, 4000);
    return () => clearTimeout(timer);
  }, []);

  async function checkUpdate() {
    try {
      const res = await fetch(RELEASES_API, { headers: { 'User-Agent': 'magic-draft-app' } });
      if (!res.ok) return;
      const data = await res.json();
      const tag = data.tag_name as string;
      if (!isNewer(tag, CURRENT_VERSION)) return;
      const assets = (data.assets ?? []) as { name: string; browser_download_url: string }[];
      const exe = assets.find(a => a.name.endsWith('_x64-setup.exe'));
      if (!exe) return;
      setState({ phase: 'available', version: tag.replace(/^v/, ''), exeUrl: exe.browser_download_url });
    } catch {
      // offline — silent fail
    }
  }

  async function handleUpdate() {
    if (state.phase !== 'available') return;
    const { exeUrl } = state;
    setState({ phase: 'downloading', progress: 0 });

    try {
      // Download via Rust command (saves to temp dir, no fs permission needed)
      const { invoke } = await import('@tauri-apps/api/core');
      const tmpPath = await invoke<string>('download_update', { url: exeUrl });

      setState({ phase: 'done' });

      // Launch installer via Rust (bypasses opener sandbox), then exit app
      await invoke('run_installer', { path: tmpPath });
      await new Promise(r => setTimeout(r, 1500));
      const { exit } = await import('@tauri-apps/plugin-process');
      await exit(0);
    } catch (e) {
      console.error('Update failed:', e);
      setState({ phase: 'error', message: String(e), exeUrl });
    }
  }

  async function handleBrowserDownload() {
    if (state.phase !== 'error') return;
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    openUrl(state.exeUrl);
    setDismissed(true);
  }

  if (dismissed || state.phase === 'idle') return null;

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(15,10,30,0.97)', border: '1px solid rgba(255,200,50,0.4)',
      borderRadius: 12, padding: '14px 20px', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 16,
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)', minWidth: 320,
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
              Baixando atualização...
            </div>
            <div style={{ marginTop: 6, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, transparent, #ffd700, transparent)', backgroundSize: '200% 100%', animation: 'shimmer 1.2s infinite' }} />
            </div>
          </>
        )}
        {state.phase === 'done' && (
          <div style={{ fontWeight: 700, color: '#4ade80', fontSize: 14 }}>
            ✅ Instalando atualização...
          </div>
        )}
        {state.phase === 'error' && (
          <>
            <div style={{ fontWeight: 700, color: '#f87171', fontSize: 13 }}>
              Erro no download:
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,100,100,0.8)', marginTop: 2, wordBreak: 'break-all', maxWidth: 400 }}>
              {state.message}
            </div>
          </>
        )}
      </div>
      {state.phase === 'available' && (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={() => setDismissed(true)}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>
            Agora não
          </button>
          <button onClick={handleUpdate}
            style={{ background: '#ffd700', color: '#000', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
            Atualizar
          </button>
        </div>
      )}
      {state.phase === 'error' && (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={() => setDismissed(true)}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>
            Fechar
          </button>
          <button onClick={handleBrowserDownload}
            style={{ background: '#f87171', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
            Baixar no navegador
          </button>
        </div>
      )}
    </div>
  );
}
