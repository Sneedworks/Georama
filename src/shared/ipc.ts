export const IPC = { getInfo: 'app:get-info' } as const;

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
