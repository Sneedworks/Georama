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
