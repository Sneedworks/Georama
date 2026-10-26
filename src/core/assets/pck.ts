export type PckErrorCode =
  | 'TRUNCATED'
  | 'MAGIC'
  | 'VERSION'
  | 'LIMIT'
  | 'FORMAT'
  | 'RANGE'
  | 'SOURCE'
  | 'MISSING'
  | 'EXTENSION';

export class PckError extends Error {
  readonly code: PckErrorCode;
  readonly offset: number;

  constructor(code: PckErrorCode, message: string, offset: number) {
    super(message);
    this.name = 'PckError';
    this.code = code;
    this.offset = offset;
  }
}

export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface PckEntry {
  readonly path: string;
  readonly offset: number;
  readonly size: number;
}

export interface PckIndex {
  readonly godotVersion: readonly [number, number, number];
  readonly fileSize: number;
  readonly indexEnd: number;
  readonly entries: ReadonlyMap<string, PckEntry>;
}

export const PCK_LIMITS: Readonly<{
  maxFiles: number;
  maxPathBytes: number;
  maxIndexBytes: number;
  maxEntryBytes: number;
}> = Object.freeze({
  maxFiles: 200_000,
  maxPathBytes: 1024,
  maxIndexBytes: 67_108_864,
  maxEntryBytes: 268_435_456,
});

export const PCK_DATA_EXTENSIONS: readonly string[] = Object.freeze([
  '.wonderdraft_image',
  '.wonderdraft_symbols',
  '.wonderdraft_theme',
  '.wonderdraft_9patch',
  '.ttf',
  '.otf',
  '.csv',
  '.png',
]);

export function isPckDataPath(path: string): boolean {
  if (typeof path !== 'string') return false;
  for (const ext of PCK_DATA_EXTENSIONS) {
    if (path.endsWith(ext)) return true;
  }
  return false;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const SAFE_MAX = Number.MAX_SAFE_INTEGER;
const PREFIX = 'res://';

function u32le(view: DataView, pos: number): number {
  return view.getUint32(pos, true);
}

function u64le(view: DataView, pos: number): bigint {
  return view.getBigUint64(pos, true);
}

function fail(code: PckErrorCode, message: string, offset: number): never {
  throw new PckError(code, message, offset);
}

function checkPath(path: string, at: number): void {
  if (!path.startsWith(PREFIX) || path.length <= PREFIX.length) {
    fail('FORMAT', `Bad PCK path at ${at}`, at);
  }
  if (path.includes('\\')) fail('FORMAT', `Bad PCK path at ${at}`, at);
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) fail('FORMAT', `Bad PCK path at ${at}`, at);
  }
  if (path.endsWith('/')) fail('FORMAT', `Bad PCK path at ${at}`, at);
  // Validate segments without allocating an array and substrings for every entry.
  let start = PREFIX.length;
  for (let i = start; i <= path.length; i++) {
    if (i !== path.length && path.charCodeAt(i) !== 47) continue;
    const length = i - start;
    if (length === 0 || (length === 1 && path.charCodeAt(start) === 46)
      || (length === 2 && path.charCodeAt(start) === 46 && path.charCodeAt(start + 1) === 46)) {
      fail('FORMAT', `Bad PCK path at ${at}`, at);
    }
    start = i + 1;
  }
}

export function parsePckIndex(prefix: Uint8Array, fileSize: number): PckIndex {
  if (!(prefix instanceof Uint8Array)) fail('TRUNCATED', 'Expected Uint8Array prefix', 0);
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) fail('RANGE', 'Bad fileSize', 0);
  if (prefix.length < 88) fail('TRUNCATED', `PCK header needs 88 bytes, have ${prefix.length}`, prefix.length);
  if (prefix[0] !== 0x47 || prefix[1] !== 0x44 || prefix[2] !== 0x50 || prefix[3] !== 0x43) {
    fail('MAGIC', 'Expected GDPC magic', 0);
  }
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  if (u32le(view, 4) !== 1) fail('VERSION', 'Only GDPC pack version 1 is supported', 4);
  const major = u32le(view, 8);
  const minor = u32le(view, 12);
  const rev = u32le(view, 16);
  if (major !== 3) fail('VERSION', 'Only Godot major version 3 is supported', 8);
  const fileCount = u32le(view, 84);
  if (fileCount > PCK_LIMITS.maxFiles) fail('LIMIT', `Too many files: ${fileCount}`, 84);
  const entries = new Map<string, PckEntry>();
  let pos = 88;
  for (let i = 0; i < fileCount; i++) {
    if (prefix.length - pos < 4) fail('TRUNCATED', `Entry ${i} needs its path length`, prefix.length);
    const at = pos;
    const pathLen = u32le(view, pos);
    pos += 4;
    if (pathLen === 0) fail('FORMAT', `Entry ${i} has an empty path`, at);
    if (pathLen > PCK_LIMITS.maxPathBytes) fail('LIMIT', `Entry ${i} path is too long`, at);
    if (prefix.length - pos < pathLen + 32) {
      fail('TRUNCATED', `Entry ${i} needs ${pathLen + 32} bytes`, prefix.length);
    }
    const field = prefix.subarray(pos, pos + pathLen);
    pos += pathLen;
    let nul = -1;
    for (let k = 0; k < field.length; k++) {
      if (field[k] === 0) {
        nul = k;
        break;
      }
    }
    // A path whose byte length is already a multiple of 4 needs no padding,
    // so the field holds no NUL at all; otherwise the first NUL ends the path.
    const end = nul < 0 ? field.length : nul;
    if (nul >= 0) {
      for (let k = nul + 1; k < field.length; k++) {
        if (field[k] !== 0) fail('FORMAT', `Entry ${i} has junk after NUL`, at);
      }
    }
    let path: string;
    try {
      path = utf8.decode(field.subarray(0, end));
    } catch {
      fail('FORMAT', `Entry ${i} path is not valid UTF-8`, at);
    }
    checkPath(path, at);
    if (entries.has(path)) fail('FORMAT', `Duplicate PCK path at ${at}`, at);
    const offset = u64le(view, pos);
    pos += 8;
    const size = u64le(view, pos);
    pos += 8;
    pos += 16;
    if (offset > BigInt(SAFE_MAX) || size > BigInt(SAFE_MAX)) {
      fail('RANGE', `Entry ${i} offset or size exceeds 2^53`, at);
    }
    if (offset + size > BigInt(fileSize)) fail('RANGE', `Entry ${i} runs past the file`, at);
    entries.set(path, { path, offset: Number(offset), size: Number(size) });
  }
  const indexEnd = pos;
  for (const entry of entries.values()) {
    if (entry.offset < indexEnd) fail('FORMAT', `Entry points inside the index: ${entry.offset}`, entry.offset);
  }
  return { godotVersion: [major, minor, rev], fileSize, indexEnd, entries };
}

export async function loadPckIndex(
  source: ByteSource,
  maxIndexBytes: number = PCK_LIMITS.maxIndexBytes,
): Promise<PckIndex> {
  const size = source.size;
  if (!Number.isSafeInteger(size) || size < 0) fail('SOURCE', 'Bad source size', 0);
  // The argument can only lower the global cap, never raise it.
  if (!Number.isSafeInteger(maxIndexBytes) || maxIndexBytes < 0 || maxIndexBytes > PCK_LIMITS.maxIndexBytes) {
    fail('LIMIT', 'Bad maxIndexBytes', 0);
  }
  if (size < 88) fail('TRUNCATED', `Source smaller than the header: ${size}`, size);
  const cap = maxIndexBytes + 88;
  let want = Math.min(65_536, size, cap);
  let acc = new Uint8Array(0);
  for (;;) {
    const chunk = await source.read(acc.length, want - acc.length);
    if (!(chunk instanceof Uint8Array) || chunk.length !== want - acc.length) {
      fail('SOURCE', `Short read at ${acc.length}`, acc.length);
    }
    const next = new Uint8Array(want);
    next.set(acc, 0);
    next.set(chunk, acc.length);
    acc = next;
    try {
      return parsePckIndex(acc, size);
    } catch (error) {
      if (error instanceof PckError && error.code === 'TRUNCATED') {
        if (acc.length >= size) throw error;
        if (acc.length >= cap) fail('LIMIT', 'PCK index exceeds the cap', acc.length);
        want = Math.min(acc.length * 2, size, cap);
        if (want <= acc.length) fail('LIMIT', 'PCK index exceeds the cap', acc.length);
        continue;
      }
      throw error;
    }
  }
}

export async function readPckEntry(
  source: ByteSource,
  index: PckIndex,
  path: string,
  maxBytes: number = PCK_LIMITS.maxEntryBytes,
): Promise<Uint8Array> {
  if (!isPckDataPath(path)) fail('EXTENSION', `Refused extension: ${path}`, 0);
  const entry = index.entries.get(path);
  if (!entry) fail('MISSING', `No such entry: ${path}`, 0);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail('LIMIT', 'Bad maxBytes', entry.offset);
  if (entry.size > maxBytes) fail('LIMIT', `Entry too large: ${entry.size}`, entry.offset);
  if (index.fileSize !== source.size) fail('RANGE', 'Stale index for this source', entry.offset);
  if (
    !Number.isSafeInteger(entry.offset) ||
    !Number.isSafeInteger(entry.size) ||
    entry.offset < 0 ||
    entry.size < 0 ||
    entry.size > source.size ||
    entry.offset > source.size - entry.size
  ) {
    fail('RANGE', 'Entry does not fit in this source', entry.offset);
  }
  const data = await source.read(entry.offset, entry.size);
  if (!(data instanceof Uint8Array) || data.length !== entry.size) {
    fail('SOURCE', `Short read at ${entry.offset}`, entry.offset);
  }
  return data;
}
