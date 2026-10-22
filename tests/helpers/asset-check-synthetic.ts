import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeSyntheticRoot } from './wd-synthetic.ts';
import type { GdDict, GdValue } from '../../src/core/formats/godot-var.ts';
import { encodeStoreVar } from '../../src/core/formats/godot-var.ts';
import { encodeGcpf } from '../../src/core/formats/gcpf.ts';
import { buildPck, makePng } from './pck-synthetic.ts';

export interface AssetCheckSyntheticOptions {
  readonly waterLevel?: number;
  readonly pathStyle?: string;
  readonly borderStyle?: string;
  readonly symbolTexture?: string;
  readonly waterTexture?: string;
  readonly groundTexture?: string;
  readonly frameTexture?: string;
  readonly omitUserPng?: boolean;
}

export interface AssetCheckFixture {
  readonly base: string;
  readonly installRoot: string;
  readonly userDataRoot: string;
  readonly configFile: string;
  readonly mapFile: string;
  readonly cleanup: () => Promise<void>;
}

function setKey(dict: GdDict, key: string, value: GdValue): void {
  const pair = dict.entries.find((p) => p[0] === key);
  if (pair === undefined) throw new Error(`missing key ${key}`);
  pair[1] = value;
}

function getDict(dict: GdDict, key: string): GdDict {
  const pair = dict.entries.find((p) => p[0] === key);
  if (pair === undefined) throw new Error(`missing key ${key}`);
  return pair[1] as GdDict;
}

export async function makeAssetCheckFixture(options: AssetCheckSyntheticOptions = {}): Promise<AssetCheckFixture> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-asset-check-'));
  const cleanup = async (): Promise<void> => {
    await fs.rm(base, { recursive: true, force: true });
  };
  try {
    const installRoot = path.join(base, 'install');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(installRoot, { recursive: true });
    const png = makePng({ width: 2, height: 2 });
    const archive = buildPck([
      { path: 'res://textures/water/SynthWater.wonderdraft_image', data: png },
      { path: 'res://textures/ground/SynthGround.wonderdraft_image', data: png },
      { path: 'res://textures/frames/SynthFrame.wonderdraft_image', data: png },
      { path: 'res://textures/paths/SynthPath.wonderdraft_image', data: png },
      { path: 'res://textures/borders/SynthBorder.wonderdraft_image', data: png },
    ]);
    await fs.writeFile(path.join(installRoot, 'Wonderdraft.pck'), archive);
    if (options.omitUserPng !== true) {
      await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
      await fs.writeFile(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', 'tree.png'), png);
    } else {
      await fs.mkdir(path.join(userDataRoot, 'assets'), { recursive: true });
    }

    const root = makeSyntheticRoot();
    const theme = getDict(root, 'theme');
    setKey(theme, 'water_texture', options.waterTexture ?? 'SynthWater');
    setKey(theme, 'ground_texture', options.groundTexture ?? 'SynthGround');
    const frame = getDict(root, 'frame');
    setKey(frame, 'texture', options.frameTexture ?? 'SynthFrame');
    const pathsPair = root.entries.find((p) => p[0] === 'paths');
    if (pathsPair === undefined) throw new Error('missing paths');
    const paths = pathsPair[1] as Array<GdDict>;
    setKey(paths[0] as GdDict, 'style', options.pathStyle ?? 'res://textures/paths/SynthPath');
    const territories = getDict(root, 'territories');
    const terrPair = territories.entries.find((p) => p[0] === 'territories');
    if (terrPair === undefined) throw new Error('missing territories');
    const terrList = terrPair[1] as Array<GdDict>;
    setKey(terrList[0] as GdDict, 'style', options.borderStyle ?? 'res://textures/borders/SynthBorder');
    const symbolsPair = root.entries.find((p) => p[0] === 'symbols');
    if (symbolsPair === undefined) throw new Error('missing symbols');
    const symbols = symbolsPair[1] as Array<GdValue>;
    setKey(symbols[0] as GdDict, 'texture', options.symbolTexture ?? 'user://assets/synthetic-pack/trees/tree');
    if (options.waterLevel !== undefined) {
      setKey(root, 'water_level', options.waterLevel);
    }

    const payload = encodeStoreVar(root);
    const file = encodeGcpf(payload);
    const mapFile = path.join(base, 'map.wonderdraft_map');
    await fs.writeFile(mapFile, file);
    const configFile = path.join(base, 'config.json');
    await fs.writeFile(configFile, JSON.stringify({ wonderdraftInstall: installRoot, wonderdraftUserData: userDataRoot }));
    return { base, installRoot, userDataRoot, configFile, mapFile, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
