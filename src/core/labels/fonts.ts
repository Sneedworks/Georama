// Card 1.8f, step 3 (GREEN): the four families (fact 3) and the fallback (D1). Pure: the core never reads the environment.
// The four LABEL_FONT_* variables are read by the hidden harness only, never here (D1).

export const FALLBACK_KEY = 'fallback';

const KEYS: Readonly<Record<string, string>> = {
  'East Sea Dokdo': 'east-sea-dokdo',
  'Marko One': 'marko-one',
  Aladin: 'aladin',
  'Cinzel Decorative': 'cinzel-decorative',
};

/** Maps a font family name to its key. An unknown name maps to FALLBACK_KEY and is reported (fact 3). */
export function fontKey(name: string): Readonly<{ key: string; reported: boolean }> {
  if (Object.prototype.hasOwnProperty.call(KEYS, name)) return { key: KEYS[name], reported: false };
  return { key: FALLBACK_KEY, reported: true };
}
