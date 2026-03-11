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

interface ReleaseInfo {
  version: string;
  exeUrl: string | null;
  appImageUrl: string | null;
}

export function UpdateChecker() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(RELEASES_API, { headers: { 'User-Agent': 'magic-draft-app' } });
        if (!res.ok) return;
        const data = await res.json();
        const tag = data.tag_name as string;
        if (!isNewer(tag, CURRENT_VERSION)) return;

        const assets: { name: string; browser_download_url: string }[] = data.assets ?? [];
        const exeAsset      = assets.find(a => a.name.endsWith('_x64-setup.exe'));
        const appImageAsset = assets.find(a => a.name.endsWith('.AppImage'));

        setRelease({
          version: tag.replace(/^v/, ''),
          exeUrl:      exeAsset?.browser_download_url ?? null,
          appImageUrl: appImageAsset?.browser_download_url ?? null,
        });
      } catch {
        // offline or error — silent fail
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  if (!release) return null;

  async function handleUpdate() {
    if (!release) return;
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    // Open direct download URL — browser downloads the installer automatically
    const url = release.exeUrl ?? release.appImageUrl ?? 'https://github.com/LucasMagalhaesAfonso/magic-draft-simulator/releases/latest';
    openUrl(url);
  }

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(15,10,30,0.97)', border: '1px solid rgba(255,200,50,0.4)',
      borderRadius: 12, padding: '14px 20px', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 16,
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      minWidth: 300,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#ffd700', fontSize: 14 }}>
          Nova versão disponível: v{release.version}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>
          O instalador vai baixar automaticamente.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => setRelease(null)}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}
        >
          Agora não
        </button>
        <button
          onClick={handleUpdate}
          style={{ background: '#ffd700', color: '#000', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
        >
          Baixar
        </button>
      </div>
    </div>
  );
}
