import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('native asset IPC startup boundary', () => {
  it('keeps helper configuration and asset-handler registration in the same Windows-only block', () => {
    // main.ts has Electron startup side effects, so assert the production
    // registration site directly; the hidden-window E2E checks its behavior.
    const main = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
    const startup = main.slice(main.indexOf('void app.whenReady().then'));
    expect(startup.match(/\bregisterAssetIpc\s*\(/g)).toHaveLength(1);
    expect(startup).toMatch(
      /if\s*\(process\.platform\s*===\s*'win32'\)\s*\{\s*configureWindowsAssetHelper\(app\.getAppPath\(\)\);\s*registerAssetIpc\(/,
    );
  });
});
