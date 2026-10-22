import { readSelectedDataFile } from './selected-file.ts';
import { CONFIG_LIMITS, ConfigError, parseConfig } from '../assets/config.ts';
import type { GeoramaConfig } from '../assets/config.ts';
import { decodeAssetText } from '../../src/core/assets/asset-json.ts';

export async function readSelectedConfigFile(filename: string): Promise<GeoramaConfig> {
  const bytes = await readSelectedDataFile(filename, CONFIG_LIMITS.maxBytes);
  let text: string;
  try {
    text = decodeAssetText(bytes);
  } catch {
    throw new ConfigError('SYNTAX', '', 'config is not valid UTF-8');
  }
  return parseConfig(text);
}
