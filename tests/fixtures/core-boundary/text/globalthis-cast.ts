export const platform = (globalThis as { process?: { platform: string } }).process?.platform;
