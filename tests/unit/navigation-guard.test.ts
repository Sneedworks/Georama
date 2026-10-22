import { describe, expect, it, vi } from 'vitest';
import { createNavigationGuard } from '../../electron/navigation-guard.ts';
const editor = 'georama://app/index.html';
function fixture() {
  let now = 0;
  const recover = vi.fn(), quit = vi.fn(), observe = vi.fn();
  const guard = createNavigationGuard({editorUrl: editor, now: () => now, recover, quit, observe});
  return {guard, recover, quit, observe, advance: (ms: number) => { now += ms; }};
}
describe('document navigation state machine', () => {
  it('accepts only editor documents and hash-only changes', () => {
    const {guard, recover} = fixture();
    for (const url of [editor, editor + '#map', editor + '#']) guard.check({url, isMainFrame: true});
    expect(recover).not.toHaveBeenCalled();
  });
  it.each(['about:blank', 'about:srcdoc', 'georama://app/other.html', editor + '?next=1', 'file:///etc/passwd', 'https://evil/', 'georama://u@app/index.html'])('recovers once per offending contents for %s', url => {
    const {guard, recover, observe} = fixture();
    const target = {};
    guard.check({url, isMainFrame: true, target}); guard.check({url, isMainFrame: true, target});
    expect(recover).toHaveBeenCalledTimes(1); expect(observe).toHaveBeenCalledTimes(1);
  });
  it('rejects even editor-origin child frames', () => {
    const {guard, recover} = fixture();
    guard.check({url: editor, isMainFrame: false});
    expect(recover).toHaveBeenCalledTimes(1);
  });
  it('recovers at most three times in 60 seconds then quits', () => {
    const {guard, recover, quit, observe} = fixture();
    for (let i = 0; i < 4; i++) guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    expect(recover).toHaveBeenCalledTimes(3); expect(quit).toHaveBeenCalledTimes(1); expect(observe).toHaveBeenCalledTimes(4);
  });
  it('expires recovery history using the injected clock', () => {
    const {guard, recover, quit, advance} = fixture();
    for (let i = 0; i < 3; i++) guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    advance(60_001);
    guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    expect(recover).toHaveBeenCalledTimes(4); expect(quit).not.toHaveBeenCalled();
  });
  it('quits on a fourth violation at t=59,999 while three recoveries are still inside the 60 s window', () => {
    const {guard, recover, quit, advance} = fixture();
    guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    advance(10);
    guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    advance(10);
    guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    advance(59_979);
    guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    expect(recover).toHaveBeenCalledTimes(3); expect(quit).toHaveBeenCalledTimes(1);
  });
  it('recovers at exactly t=60,000 because the t=0 recovery has expired (strict time - previous < 60_000)', () => {
    const {guard, recover, quit, advance} = fixture();
    guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    advance(10);
    guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    advance(10);
    guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    advance(59_980);
    guard.check({url: 'about:blank', isMainFrame: true, target: {}});
    expect(recover).toHaveBeenCalledTimes(4); expect(quit).not.toHaveBeenCalled();
  });
});
