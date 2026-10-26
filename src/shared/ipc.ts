export const IPC = {\n  getInfo: 'app:get-info',\n  selectUserAssets: 'assets:select-user-root',\n  readUserImage: 'assets:read-user-image',\n} as const;

export interface AppInfo {
  name: string;
  id: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  e2e: boolean;
}

export interface GeoramaApi {
  getAppInfo(): Promise<AppInfo>;
}
