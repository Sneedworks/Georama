import type { App, Session } from 'electron';
import { isTrustedAppUrl } from './security.ts';

// A reserved, unresolvable target: never contact a local service as a proxy.
export const OFFLINE_PROXY = 'socks5://offline.invalid:9';
export const HOST_CATCH_ALL = 'MAP * ~NOTFOUND';

/** Resource policy, NOT IPC/document authority. CSP further restricts consumers. */
export function isAllowedRequestUrl(input: string, devtools = false): boolean {
  if (isTrustedAppUrl(input)) return true;
  if (input.startsWith('blob:')) return isTrustedAppUrl(input.slice(5));
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|bmp)(?:[;,])/i.test(input)) return true;
  try { return devtools && new URL(input).protocol === 'devtools:'; } catch { return false; }
}

/** Install switches before ready. Await prepareSession before creating a window. */
export function installNetwork(app: App): { prepareSession: (target: Session) => Promise<void> } {
  app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
  // First matching rule wins: keep any rule given on the command line and put the catch-all last.
  const inherited = app.commandLine.getSwitchValue('host-resolver-rules');
  app.commandLine.appendSwitch('host-resolver-rules', inherited ? `${inherited}, ${HOST_CATCH_ALL}` : HOST_CATCH_ALL);
  const prepared = new WeakMap<Session, Promise<void>>();
  const devtools = process.env.GEORAMA_DEVTOOLS === '1';
  function prepareSession(target: Session): Promise<void> {
    const prior = prepared.get(target);
    if (prior) return prior;
    let ready = false;
    target.webRequest.onBeforeRequest({urls: ['<all_urls>']}, (details, callback) => {
      callback({cancel: !ready || !isAllowedRequestUrl(details.url, devtools)});
    });
    const pending = (async () => {
      await target.setProxy({mode: 'fixed_servers', proxyRules: OFFLINE_PROXY, proxyBypassRules: '<-loopback>'});
      await target.closeAllConnections();
      ready = true;
    })();
    prepared.set(target, pending);
    return pending;
  }
  // Also cover sessions created before a WebContents starts loading anything.
  app.on('session-created', target => { void prepareSession(target).catch(() => app.exit(1)); });
  app.on('web-contents-created', (_event, contents) => {
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    void prepareSession(contents.session).catch(() => app.exit(1));
  });
  return {prepareSession};
}
