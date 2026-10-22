export function take(h: { constructor: unknown }): unknown { const { constructor: F = 1 } = h; return F; }
