export function take(f: { constructor: unknown }): unknown { let F: unknown; ({ constructor: F } = f); return F; }
