export interface NavigationCheck {
  url: string;
  isMainFrame: boolean;
  target?: object;
  /** Main frame, judged before commit: the document never loads, so the window is kept and never replaced. */
  precommit?: boolean;
}
export interface NavigationViolation extends NavigationCheck {
  action: 'recover' | 'refuse' | 'quit';
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
    // A committed violation discards its window once. A refusal leaves the window alive, so it discards nothing.
    if (!event.precommit && event.target && discarded.has(event.target)) return;
    if (!event.precommit && event.target) discarded.add(event.target);
    const time = options.now();
    recoveries = recoveries.filter(previous => time - previous < 60_000);
    // Refusals and committed violations share one limit: the fourth within 60 s quits.
    const action = recoveries.length < 3 ? (event.precommit ? 'refuse' : 'recover') : 'quit';
    const violation: NavigationViolation = {...event, action};
    options.observe(violation);
    if (action === 'quit') { quitting = true; options.quit(violation); }
    else {
      recoveries.push(time);
      if (action === 'recover') options.recover(violation);
    }
  }};
}
