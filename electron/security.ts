import { session, type App } from 'electron';
import { BRAND } from '../src/shared/brand.ts';

export function buildCsp(): string {
  return "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
}

export function isTrustedAppUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === `${BRAND.scheme}:`
      && url.host === BRAND.host
      && url.username === ''
      && url.password === ''
      && url.port === '';
  } catch {
    return false;
  }
}

export function installSecurity(app: App): void {
  app.enableSandbox();
  const secured = new WeakSet<object>();
  const secureSession = (target: Electron.Session): void => {
    if (secured.has(target)) return;
    secured.add(target);
    target.setSpellCheckerEnabled(false);
    // No language means no dictionary to load, so nothing is downloaded from a CDN at startup.
    target.setSpellCheckerLanguages([]);
    target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    target.setPermissionCheckHandler(() => false);
    target.setDevicePermissionHandler(() => false);
  };
  app.on('session-created', secureSession);
  app.on('web-contents-created', (_event, contents) => {
    secureSession(contents.session);
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedAppUrl(url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
  void app.whenReady().then(() => {
    // No dictionary downloads or background spellchecking in this offline shell.
    secureSession(session.defaultSession);
  });
}
