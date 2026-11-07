// Card 1.8f, step 5 (GREEN): pure frame placement, detail v14. Reuses packAtlas (src/core/symbols/atlas.ts) unchanged. DOM-free.
import { packAtlas, type AtlasItem, type AtlasOptions } from '../symbols/atlas.ts';

export type FrameLabel = Readonly<{ id: string; items: readonly AtlasItem[] }>;
export type DropReason = 'oversize' | 'no-fit-after-clear';
export type FrameDrop = Readonly<{ id: string; reason: DropReason }>;
export type FramePlan = Readonly<{
  drawn: readonly string[];
  dropped: readonly FrameDrop[];
  cleared: boolean;
  packings: number;
  resident: readonly AtlasItem[];
}>;

type Status = 'drawn' | 'empty' | DropReason;

// Unique by key, first occurrence kept: a key shared by labels is packed once.
function uniqueByKey(items: readonly AtlasItem[]): AtlasItem[] {
  const seen = new Set<string>();
  const out: AtlasItem[] = [];
  for (const it of items) {
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    out.push(it);
  }
  return out;
}

function sortByKey(items: readonly AtlasItem[]): AtlasItem[] {
  return [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// Procedure of detail v14: oversize drops whole; pack resident union needed; on LIMIT clear and pack needed; on LIMIT again, greedy in frame order from empty.
export function placeFrame(frame: readonly FrameLabel[], resident: readonly AtlasItem[], options: AtlasOptions): FramePlan {
  let packings = 0;
  const pack = (items: readonly AtlasItem[]): boolean => {
    packings += 1;
    const verdict = packAtlas(items, options);
    if (verdict.ok) return true;
    if (verdict.code === 'INPUT') throw new Error(`placeFrame: ${verdict.message}`); // cannot occur with the page's constants (detail v14)
    return false;
  };

  // Step 1: a label with no items is not part of the frame; a label with an oversize item is dropped whole.
  const status: Status[] = frame.map((label): Status => (label.items.length === 0 ? 'empty' : 'drawn'));
  for (let i = 0; i < frame.length; i++) {
    if (status[i] === 'empty') continue;
    if (frame[i].items.some((it) => it.width > options.maxSide || it.height > options.maxSide)) status[i] = 'oversize';
  }
  const live: number[] = [];
  for (let i = 0; i < frame.length; i++) if (status[i] === 'drawn') live.push(i);
  const needed = uniqueByKey(live.flatMap((i) => frame[i].items));

  let cleared = false;
  let state: AtlasItem[] = uniqueByKey(resident);

  // Step 2: nothing is packed when needed is empty; otherwise pack resident union needed.
  if (needed.length > 0) {
    const union = uniqueByKey([...resident, ...needed]);
    if (pack(union)) {
      state = union;
    } else {
      // Step 3: LIMIT clears the atlas; needed is packed alone.
      cleared = true;
      if (pack(needed)) {
        state = needed;
      } else {
        // Step 4: greedy in frame order from empty; a label that does not fit at its turn is dropped whole.
        let accepted: AtlasItem[] = [];
        for (const i of live) {
          const attempt = uniqueByKey([...accepted, ...frame[i].items]);
          if (pack(attempt)) {
            accepted = attempt;
          } else {
            status[i] = 'no-fit-after-clear';
          }
        }
        state = accepted;
      }
    }
  }

  const drawn: string[] = [];
  const dropped: FrameDrop[] = [];
  frame.forEach((label, i) => {
    const s = status[i];
    if (s === 'drawn') drawn.push(label.id);
    else if (s === 'oversize' || s === 'no-fit-after-clear') dropped.push({ id: label.id, reason: s });
  });
  return { drawn, dropped, cleared, packings, resident: sortByKey(state) };
}
