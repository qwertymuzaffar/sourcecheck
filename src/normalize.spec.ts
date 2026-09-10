import { normalize, normalizeText, toNormalizedIndex, tokenize } from './normalize.js';

describe('normalize', () => {
  it('lowercases, folds quotes and dashes, collapses whitespace and trims', () => {
    expect(normalizeText('  “Hello”   —  World… ‘ok’ ')).toBe('"hello" - world... \'ok\'');
    expect(normalizeText('a\n\n\tb')).toBe('a b');
  });

  it('maps every normalized character back to its original index', () => {
    const original = '  The  ﬁsh\tsaid “No”.';
    const n = normalize(original);
    expect(n.text).toBe('the fish said "no".');
    expect(n.map).toHaveLength(n.text.length);
    // "fish": the ligature expands to two characters that both map to the ligature.
    const f = n.text.indexOf('fish');
    expect(n.map[f]).toBe(original.indexOf('ﬁ'));
    expect(n.map[f + 1]).toBe(original.indexOf('ﬁ'));
    // The collapsed space maps to the last whitespace character before the next word.
    expect(original[n.map[n.text.indexOf(' said')]!]).toBe('\t');
    // Mapping a normalized match back yields the original substring.
    const s = n.text.indexOf('"no"');
    const start = n.map[s]!;
    const end = n.map[s + 3]! + 1;
    expect(original.slice(start, end)).toBe('“No”');
  });

  it('handles empty and whitespace-only input', () => {
    expect(normalize('')).toEqual({ text: '', map: [] });
    expect(normalize('  \n ')).toEqual({ text: '', map: [] });
  });

  it('toNormalizedIndex finds the first normalized character at or after an original offset', () => {
    const n = normalize('ab   cd');
    expect(toNormalizedIndex(n, 0)).toBe(0);
    expect(toNormalizedIndex(n, 3)).toBe(2);
    expect(toNormalizedIndex(n, 5)).toBe(3);
    expect(toNormalizedIndex(n, 99)).toBe(n.text.length);
  });

  it('tokenize returns words with offsets', () => {
    expect(tokenize("Don't stop, 42 times!")).toEqual([
      { text: 'Don', start: 0, end: 3 },
      { text: 't', start: 4, end: 5 },
      { text: 'stop', start: 6, end: 10 },
      { text: '42', start: 12, end: 14 },
      { text: 'times', start: 15, end: 20 },
    ]);
  });
});
