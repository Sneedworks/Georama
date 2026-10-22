import { useEffect, useState } from 'preact/hooks';
import { BRAND } from '../shared/brand';
import type { AppInfo } from '../shared/ipc';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void window.georama.getAppInfo().then(
      (result) => { if (active) setInfo(result); },
      () => { if (active) setUnavailable(true); },
    );
    return () => { active = false; };
  }, []);

  return (
    <main class="welcome">
      <section class="wordmark" aria-label={BRAND.name}>
        <h1>{BRAND.name}</h1>
        <p class="tagline">A view of the world.</p>
        <p class="app-info" aria-live="polite">
          {info
            ? `v${info.version} · Electron ${info.electron} · Chromium ${info.chrome}`
            : unavailable ? 'App information unavailable.' : 'Starting…'}
        </p>
      </section>
    </main>
  );
}
