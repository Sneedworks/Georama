import { describe, expect, it } from 'vitest';
import { GdDict, type GdValue } from '../../src/core/formats/godot-var.ts';
import {
  WdSchemaError, f, readBool, readInt, readRecord, readRecordList, readString,
  reqInt, writeBool, writeRecord, writeRecordList, writeString,
} from '../../src/core/formats/wonderdraft-map-engine.ts';

const table = [
  f('enabled', readBool, writeBool),
  f('z_index', readInt, (value: unknown, path: string) => BigInt(reqInt(value, path))),
  f('asset_name', readString, writeString),
];

function makeRecord(i: number): GdDict {
  const known: Array<[GdValue, GdValue]> = [
    ['enabled', i % 2 === 0],
    ['z_index', BigInt(i - 300)],
    ['asset_name', `asset_${i}`],
  ];
  if (i % 4 === 1) known.reverse();
  if (i % 4 === 2) known.push(['custom_note', BigInt(i)]);
  if (i % 4 === 3) known.unshift([BigInt(i), 'unknown non-string key']);
  return new GdDict(known, i % 7 === 0);
}

function errorDetails(run: () => unknown): { code: string; path: string; message: string } {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WdSchemaError);
    const err = error as WdSchemaError;
    return { code: err.code, path: err.path, message: err.message };
  }
  throw new Error('expected a WdSchemaError');
}

describe('Wonderdraft record list field lookup reuse', () => {
  it('matches standalone readRecord and writeRecord for 600 mixed canonical, reordered and extra-key records', () => {
    const entries = Array.from({ length: 600 }, (_, i) => makeRecord(i));
    const before = entries.map((entry) => ({ entries: entry.entries.slice(), shared: entry.shared }));
    const perRecord = entries.map((entry, i) => readRecord(entry, table, `/symbols[${i}]`));
    const batched = readRecordList<Record<string, unknown>>(entries, '/symbols', table, entries.length);
    expect(batched).toEqual(perRecord);
    expect(batched.filter((record) => Array.isArray(record['layout'])).length).toBeGreaterThan(100);
    expect(batched.filter((record) => record['shared'] === true).length).toBeGreaterThan(20);

    const perRecordWritten = perRecord.map((model, i) => writeRecord(model, table, `/symbols[${i}]`));
    const batchedWritten = writeRecordList(batched, '/symbols', table, entries.length);
    expect(batchedWritten).toEqual(perRecordWritten);
    // Known field order, raw unknown-key identity and shared flag all survive the complete round trip.
    for (let i = 0; i < entries.length; i++) {
      expect((batchedWritten[i] as GdDict).entries).toEqual(entries[i].entries);
      expect((batchedWritten[i] as GdDict).shared).toBe(entries[i].shared);
      expect(entries[i].entries).toEqual(before[i].entries);
      expect(entries[i].shared).toBe(before[i].shared);
    }
  });

  it('keeps exact error code, path, and message for malformed list records', () => {
    const valid = makeRecord(0);
    const badReads: GdDict[] = [
      new GdDict([['enabled', true], ['asset_name', 'missing-index']]),
      new GdDict([['enabled', true], ['z_index', 0n], ['z_index', 1n], ['asset_name', 'duplicate']]),
      new GdDict([['enabled', 3n], ['z_index', 0n], ['asset_name', 'wrong-type']]),
    ];
    for (const bad of badReads) {
      // The first record has already been processed, so the shared lookup cannot
      // affect error ordering or location in a later record.
      const expected = errorDetails(() => readRecord(bad, table, '/symbols[1]'));
      const actual = errorDetails(() => readRecordList([valid, bad], '/symbols', table, 2));
      expect(actual).toEqual(expected);
    }

    const good = readRecord(valid, table, '/symbols[0]');
    const badWrites: Record<string, unknown>[] = [
      { ...good, zIndex: Number.NaN },
      { ...good, layout: ['enabled', 'enabled', 'z_index', 'asset_name'] },
      { ...good, extra: [['enabled', false]] },
      { ...good, extra: [[7n]] },
    ];
    for (const bad of badWrites) {
      const expected = errorDetails(() => writeRecord(bad, table, '/symbols[1]'));
      const actual = errorDetails(() => writeRecordList([good, bad], '/symbols', table, 2));
      expect(actual).toEqual(expected);
    }
  });

  it('respects count limits and the empty-list contract', () => {
    expect(readRecordList([], '/symbols', table, 0)).toEqual([]);
    expect(writeRecordList([], '/symbols', table, 0)).toEqual([]);
    expect(errorDetails(() => readRecordList([makeRecord(0)], '/symbols', table, 0)).code).toBe('LIMIT');
    expect(errorDetails(() => writeRecordList([{ enabled: true }], '/symbols', table, 0)).code).toBe('LIMIT');
  });

  it('uses current schema definitions on separate list calls, not a global stale snapshot', () => {
    const mutable = [f('enabled', readBool, writeBool)];
    const first = new GdDict([['enabled', true]]);
    expect(readRecordList([first], '/items', mutable, 1)).toEqual([{ enabled: true }]);
    mutable.push(f('asset_name', readString, writeString));
    const second = new GdDict([['enabled', true], ['asset_name', 'new-field']]);
    expect(readRecordList([second], '/items', mutable, 1)).toEqual([{ enabled: true, assetName: 'new-field' }]);
    expect(writeRecordList([{ enabled: false, assetName: 'updated' }], '/items', mutable, 1)).toEqual([
      new GdDict([['enabled', false], ['asset_name', 'updated']]),
    ]);
  });
});
