import type { LocateOptions, Match } from './types.js';
import { normalize, toNormalizedIndex, tokenize, type Normalized } from './normalize.js';

function allIndexes(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i >= 0) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}

function pick(indexes: number[], near: number | undefined): number | undefined {
  if (indexes.length === 0) return undefined;
  if (near === undefined) return indexes[0];
  let best = indexes[0]!;
  for (const i of indexes) if (Math.abs(i - near) < Math.abs(best - near)) best = i;
  return best;
}

/** Levenshtein distance over word arrays. */
export function editDistance(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

function fuzzy(nt: Normalized, nq: Normalized, text: string, options: LocateOptions): Match | null {
  const T = tokenize(nt.text);
  const Q = tokenize(nq.text).map((t) => t.text);
  const n = Q.length;
  if (n === 0 || T.length === 0) return null;
  const minScore = options.minScore ?? 0.8;
  const slack = options.slack ?? Math.max(1, Math.ceil(n * 0.25));
  const near = options.near === undefined ? undefined : toNormalizedIndex(nt, options.near);
  const qset = new Set(Q);
  const words = T.map((t) => t.text);
  let best: { score: number; i: number; len: number } | null = null;

  const better = (score: number, i: number): boolean => {
    if (!best || score > best.score) return true;
    if (score < best.score) return false;
    if (near === undefined) return false;
    return Math.abs(T[i]!.start - near) < Math.abs(T[best.i]!.start - near);
  };

  for (let len = Math.max(1, n - slack); len <= n + slack && len <= T.length; len++) {
    let overlap = 0;
    for (let k = 0; k < len; k++) if (qset.has(words[k]!)) overlap++;
    for (let i = 0; i + len <= T.length; i++) {
      if (i > 0) {
        if (qset.has(words[i - 1]!)) overlap--;
        if (qset.has(words[i + len - 1]!)) overlap++;
      }
      // Cheap screen: a window sharing too few words with the quote cannot reach minScore.
      if (overlap / Math.max(n, len) < minScore - 0.15) continue;
      const score = 1 - editDistance(Q, words.slice(i, i + len)) / Math.max(n, len);
      if (score >= minScore && better(score, i)) best = { score, i, len };
    }
  }
  if (!best) return null;
  const ns = T[best.i]!.start;
  const ne = T[best.i + best.len - 1]!.end;
  const start = nt.map[ns]!;
  const end = nt.map[ne - 1]! + 1;
  return { start, end, text: text.slice(start, end), method: 'fuzzy', score: Math.round(best.score * 1000) / 1000 };
}

/**
 * Finds `quote` in `text`: exactly, then after normalization (case, whitespace, curly quotes, dashes,
 * ellipses, NFKC), then by fuzzy word-level matching. Offsets always refer to the original text, so
 * `text.slice(match.start, match.end)` is the passage.
 */
export function locate(quote: string, text: string, options: LocateOptions = {}): Match | null {
  const q = quote.trim();
  if (!q || !text) return null;
  const exact = pick(allIndexes(text, q), options.near);
  if (exact !== undefined) return { start: exact, end: exact + q.length, text: q, method: 'exact', score: 1 };

  const nt = normalize(text);
  const nq = normalize(q);
  if (!nq.text) return null;
  const near = options.near === undefined ? undefined : toNormalizedIndex(nt, options.near);
  const ni = pick(allIndexes(nt.text, nq.text), near);
  if (ni !== undefined) {
    const start = nt.map[ni]!;
    const end = nt.map[ni + nq.text.length - 1]! + 1;
    return { start, end, text: text.slice(start, end), method: 'normalized', score: 1 };
  }
  if (options.fuzzy === false) return null;
  return fuzzy(nt, nq, text, options);
}
