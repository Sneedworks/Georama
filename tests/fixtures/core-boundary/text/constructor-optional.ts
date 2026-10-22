const maybe = (() => 0) as { constructor?: unknown } | undefined;
export const found = maybe?.constructor;
