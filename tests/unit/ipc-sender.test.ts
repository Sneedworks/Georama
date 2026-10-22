import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppInfo } from '../../src/shared/ipc.ts';
const mocked = vi.hoisted(() => ({handle: vi.fn()}));
vi.mock('electron', () => ({ipcMain: {handle: mocked.handle}}));
import { isTrustedSender, registerIpc } from '../../electron/ipc.ts';
const editor = 'georama://app/index.html';
function fixture(url = editor) {
  const frame = {url, parent: null}, contents = {mainFrame: frame};
  return {frame, contents, event: {sender: contents, senderFrame: frame}};
}
describe('document and WebContents identity', () => {
  it('allows only the exact editor WebContents and main frame, including hash', () => {
    const {event, contents} = fixture(editor + '#map');
    expect(isTrustedSender(event as never, contents as never, editor)).toBe(true);
  });
  it.each(['https://app/', 'file:///etc/passwd', 'georama://app.evil/', 'georama://evil/', 'georama://app/other.html', editor + '?next=1', 'georama://user@app/index.html', 'georama://app:80/index.html', '', 'not a url'])('revokes document authority for %s', url => {
    const {event, contents} = fixture(url);
    expect(isTrustedSender(event as never, contents as never, editor)).toBe(false);
  });
});
describe('each identity check rejects on its own', () => {
  it('another WebContents is refused even when it presents the expected frame', () => {
    const {event, contents, frame} = fixture();
    expect(isTrustedSender({sender: {mainFrame: frame}, senderFrame: frame} as never, contents as never, editor)).toBe(false);
    expect(isTrustedSender(event as never, contents as never, editor)).toBe(true);
  });
  it('a frame that has a parent is refused even when it is registered as the main frame', () => {
    const child = {url: editor, parent: {}};
    const contents = {mainFrame: child};
    expect(isTrustedSender({sender: contents, senderFrame: child} as never, contents as never, editor)).toBe(false);
  });
  it('the document URL is refused on its own when sender and frame are the expected ones', () => {
    const {event, contents, frame} = fixture();
    frame.url = 'georama://app/other.html';
    expect(isTrustedSender(event as never, contents as never, editor)).toBe(false);
  });
});
describe('registered IPC enforcement (not just the predicate)', () => {
  beforeEach(() => mocked.handle.mockClear());
  it('does not invoke the provider for rejected events', () => {
    const {event, contents, frame} = fixture();
    const provider = vi.fn(() => ({id: 'georama'}) as AppInfo);
    registerIpc(provider, () => contents as never, editor);
    expect(mocked.handle).toHaveBeenCalledWith('app:get-info', expect.any(Function));
    const handler = mocked.handle.mock.calls[0][1];
    const rejects = [
      {...event, senderFrame: null},
      {...event, senderFrame: {url: editor, parent: frame}},
      fixture().event,
    ];
    // Fresh frame URL for every invocation: no accidentally shared mutable fixture.
    for (const rejected of rejects.slice(0, 3)) { expect(() => handler(rejected)).toThrow('untrusted sender'); expect(provider).not.toHaveBeenCalled(); }
    for (const url of ['https://app/', 'file:///etc/passwd', 'georama://app.evil/', 'georama://evil/', 'georama://app/other.html', editor + '?next=1']) {
      frame.url = url; expect(() => handler(event)).toThrow('untrusted sender'); expect(provider).not.toHaveBeenCalled();
    }
    frame.url = editor + '#map';
    expect(handler(event)).toEqual({id: 'georama'}); expect(provider).toHaveBeenCalledTimes(1);
    registerIpc(provider, () => null, editor);
    expect(() => mocked.handle.mock.calls[1][1](event)).toThrow('untrusted sender');
  });
});
