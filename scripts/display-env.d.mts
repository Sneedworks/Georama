export interface DisplayFileSystem {
  readdir(directory: string): Promise<string[]>;
  stat(socket: string): Promise<{ isSocket(): boolean }>;
}

export interface DisplayOptions {
  env: Readonly<Record<string, string | undefined>>;
  uid: number;
  fs: DisplayFileSystem;
}

export function resolveDisplayEnv(options: DisplayOptions): Promise<{
  env: Record<string, string | undefined>;
  args: string[];
}>;

export interface LauncherOptions {
  platform: string;
  env: Readonly<Record<string, string | undefined>>;
  fs: DisplayFileSystem;
  getuid(): number;
}

export function resolveLauncherEnv(options: LauncherOptions): Promise<{
  env: Record<string, string | undefined>;
  args: string[];
}>;

export function launcherSignals(platform: string): Array<'SIGINT' | 'SIGTERM' | 'SIGHUP'>;
