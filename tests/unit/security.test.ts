import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const mock = vi.hoisted(() => ({ session: {defaultSession: {setSpellCheckerEnabled: vi.fn(), setSpellCheckerLanguages: vi.fn(), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn()}} }));
vi.mock('electron', () => mock);

import { buildCsp, installSecurity, isTrustedAppUrl } from '../../electron/security.ts';

const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

describe('buildCsp', () => {
  it('returns the exact restrictive policy', () => {
    expect(buildCsp()).toBe(csp);
  });

  it('allows neither eval nor inline scripts/styles', () => {
    expect(buildCsp()).not.toContain('unsafe-eval');
    expect(buildCsp()).not.toContain('unsafe-inline');
  });
});

describe('isTrustedAppUrl', () => {
  it.each(['georama://app/index.html', 'georama://app'])('trusts %s', (url) => {
    expect(isTrustedAppUrl(url)).toBe(true);
  });

  it.each([
    'georama://evil/',
    'https://app/',
    'georama://user@app/',
    'georama://user:password@app/',
    'georama://app:8080/',
    'georama://app:0/',
    'file:///etc/passwd',
    'javascript:1',
    '',
    'not a url',
    'georama://app.evil/',
  ])('rejects %s without throwing', (url) => {
    expect(isTrustedAppUrl(url)).toBe(false);
  });
});

describe('installed security enforcement', () => {
  function freshSession() {
    return {setSpellCheckerEnabled: vi.fn(), setSpellCheckerLanguages: vi.fn(), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn()};
  }
  it('enables sandboxing before ready and denies navigation, popups, webviews and all session permissions', async () => {
    const order: string[] = [];
    const app = Object.assign(new EventEmitter(), {
      enableSandbox: vi.fn(() => order.push('sandbox')),
      whenReady: () => { order.push('ready'); return Promise.resolve(); },
    });
    installSecurity(app as never); await Promise.resolve();
    expect(order.slice(0, 2)).toEqual(['sandbox', 'ready']);
    const second = {setSpellCheckerEnabled: vi.fn(), setSpellCheckerLanguages: vi.fn(), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn()};
    const contents = Object.assign(new EventEmitter(), {session: second, setWindowOpenHandler: vi.fn()});
    app.emit('web-contents-created', {}, contents);
    for (const url of ['https://app/', 'file:///etc/passwd', 'about:blank', 'georama://app.evil/index.html']) {
      const event = {preventDefault: vi.fn()}; contents.emit('will-navigate', event, url); expect(event.preventDefault).toHaveBeenCalledTimes(1);
    }
    const event = {preventDefault: vi.fn()}; contents.emit('will-navigate', event, 'georama://app/index.html'); expect(event.preventDefault).not.toHaveBeenCalled();
    expect(contents.setWindowOpenHandler.mock.calls[0][0]({url: 'georama://app/index.html'})).toEqual({action: 'deny'});
    contents.emit('will-attach-webview', event); expect(event.preventDefault).toHaveBeenCalledTimes(1);
    for (const s of [mock.session.defaultSession, second]) {
      expect(s.setSpellCheckerEnabled).toHaveBeenCalledWith(false);
      expect(s.setSpellCheckerLanguages).toHaveBeenCalledWith([]);
      const callback = vi.fn(); s.setPermissionRequestHandler.mock.calls[0][0]({}, 'camera', callback); expect(callback).toHaveBeenCalledWith(false);
      expect(s.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
      expect(s.setDevicePermissionHandler.mock.calls[0][0]()).toBe(false);
    }
  });
  it('hardens each session exactly once even when two contents share one non-default session', async () => {
    const app = Object.assign(new EventEmitter(), {
      enableSandbox: vi.fn(),
      whenReady: () => Promise.resolve(),
    });
    installSecurity(app as never); await Promise.resolve(); await Promise.resolve();
    const shared = freshSession();
    const first = Object.assign(new EventEmitter(), {session: shared, setWindowOpenHandler: vi.fn()});
    const second = Object.assign(new EventEmitter(), {session: shared, setWindowOpenHandler: vi.fn()});
    app.emit('web-contents-created', {}, first);
    app.emit('web-contents-created', {}, second);
    expect(shared.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(shared.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
    const other = freshSession();
    const third = Object.assign(new EventEmitter(), {session: other, setWindowOpenHandler: vi.fn()});
    app.emit('web-contents-created', {}, third);
    expect(other.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(other.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
  });
});

