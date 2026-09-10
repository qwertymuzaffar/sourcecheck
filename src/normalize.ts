export interface Normalized {
  text: string;
  /** map[i] is the index in the original string of normalized character i. */
  map: number[];
}

const QUOTES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  '«': '"',
  '»': '"',
};
const DASH = /[‐-―−]/;

/**
 * Lowercases, folds curly quotes and dashes to ASCII, turns an ellipsis into three dots, applies NFKC,
 * collapses runs of whitespace to one space and trims, while recording where each character came from
 * so a match in normalized space maps back to offsets in the original.
 */
export function normalize(input: string): Normalized {
  let text = '';
  const map: number[] = [];
  let pendingSpace = -1;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      if (text.length > 0) pendingSpace = i;
      continue;
    }
    if (pendingSpace >= 0) {
      text += ' ';
      map.push(pendingSpace);
      pendingSpace = -1;
    }
    let rep = QUOTES[ch] ?? (DASH.test(ch) ? '-' : ch === '…' ? '...' : ch);
    rep = rep.normalize('NFKC').toLowerCase();
    for (let k = 0; k < rep.length; k++) {
      text += rep[k]!;
      map.push(i);
    }
  }
  return { text, map };
}

export function normalizeText(input: string): string {
  return normalize(input).text;
}

/** Index in normalized space of the first character that comes from `original` or later. */
export function toNormalizedIndex(n: Normalized, original: number): number {
  let lo = 0;
  let hi = n.map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (n.map[mid]! < original) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface Token {
  text: string;
  start: number;
  end: number;
}

/** Word tokens (letters and digits) with offsets into the given string. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}
