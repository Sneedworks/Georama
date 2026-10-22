export interface NavigationCheck {
  url: string;
  isMainFrame: boolean;
  target?: object;
}
export interface NavigationViolation extends NavigationCheck {
  action: 'recover' | 'quit';
}

/** Custom-scheme URL.origin is "null": compare the authority fields, not origin. */
export function isEditorDocument(input: string, editorUrl: string): boolean {
  try {
    const url = new URL(input), editor = new URL(editorUrl);
    return url.protocol === editor.protocol && url.host === editor.host
      && url.username === '' && url.password === '' && url.port === ''
      && url.pathname === editor.pathname && url.search === editor.search;
  } catch { return false; }
}

/** Pure policy; effects/clock are injected and shared across recovered windows. */
export function createNavigationGuard(options: {
  editorUrl: string;
  now: () => number;
  recover: (event: NavigationViolation) => void;
  quit: (event: NavigationViolation) => void;
  observe: (event: NavigationViolation) => void;
}): { check: (event: NavigationCheck) => void } {
  let recoveries: number[] = [];
  const discarded = new WeakSet<object>();
  let quitting = false;
  return { check(event) {
    if (quitting || (event.isMainFrame && isEditorDocument(event.url, options.editorUrl))) return;
    if (event.target && discarded.has(event.target)) return;
    if (event.target) discarded.add(event.target);
    const time = options.now();
    recoveries = recoveries.filter(previous => time - previous < 60_000);
    const action = recoveries.length < 3 ? 'recover' : 'quit';
    const violation: NavigationViolation = {...event, action};
    options.observe(violation);
    if (action === 'quit') { quitting = true; options.quit(violation); }
    else { recoveries.push(time); options.recover(violation); }
  }};
}
