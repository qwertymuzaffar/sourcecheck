import { citationInstructions, labelOf, parseClaims, toFootnotes } from './prompt.js';
import type { Source } from './types.js';

const sources: Source[] = [
  { id: 'deck-2026', text: 'The fund launched in 2021.', title: 'Pitch deck', url: 'https://example.com/deck.pdf' },
  { id: 'sheet', text: 'Rated A- by Fitch.', label: 'FACTS' },
];

describe('citationInstructions', () => {
  it('labels sources S1.. unless a label is given, and lists them with the citing rule', () => {
    const text = citationInstructions(sources);
    expect(text).toContain('[S1] Pitch deck (https://example.com/deck.pdf)\nThe fund launched in 2021.');
    expect(text).toContain('[FACTS]\nRated A- by Fitch.');
    expect(text).toContain('[S1: "exact words copied from the source"]');
    expect(labelOf(sources[1]!, 1)).toBe('FACTS');
  });

  it('can ask for JSON and can omit the texts', () => {
    const text = citationInstructions(sources, { style: 'json', includeText: false });
    expect(text).toContain('Reply with JSON only');
    expect(text).not.toContain('launched in 2021');
    expect(text).toContain('[S1] Pitch deck');
  });
});

describe('parseClaims', () => {
  it('reads inline markers, maps labels to ids, keeps unknown labels, and honours [uncited]', () => {
    const reply = 'The fund launched in 2021 [S1: "launched in 2021"]. It is rated A- [FACTS: "Rated A-"] [S9: "x"]. The manager is in Boston [uncited]. Fees are low.';
    expect(parseClaims(reply, sources)).toEqual([
      { text: 'The fund launched in 2021.', citations: [{ sourceId: 'deck-2026', quote: 'launched in 2021' }] },
      { text: 'It is rated A-.', citations: [{ sourceId: 'sheet', quote: 'Rated A-' }, { sourceId: 'S9', quote: 'x' }] },
      { text: 'The manager is in Boston.', citations: [] },
      { text: 'Fees are low.', citations: [] },
    ]);
  });

  it('reads escaped quotes and markers without a quote', () => {
    expect(parseClaims('They said \\"no\\" [S1: "said \\"no\\""] [S1].', sources)).toEqual([
      { text: 'They said \\"no\\".', citations: [{ sourceId: 'deck-2026', quote: 'said "no"' }, { sourceId: 'deck-2026' }] },
    ]);
  });

  it('reads JSON replies in either shape, with fences, offsets and ids', () => {
    const json = '```json\n{"claims":[{"id":"c1","text":"Launched in 2021.","citations":[{"source":"S1","quote":"launched in 2021"},{"sourceId":"sheet","start":0,"end":8}]},{"text":"","citations":[]},{"nope":1}]}\n```';
    expect(parseClaims(json, sources)).toEqual([
      { id: 'c1', text: 'Launched in 2021.', citations: [{ sourceId: 'deck-2026', quote: 'launched in 2021' }, { sourceId: 'sheet', start: 0, end: 8 }] },
    ]);
    expect(parseClaims('[{"text":"A claim","citations":[{"source":"deck-2026"}]}]', sources)).toEqual([{ text: 'A claim', citations: [{ sourceId: 'deck-2026' }] }]);
    expect(parseClaims('{"claims":"nope"}', sources)).toEqual([{ text: '{"claims":"nope"}', citations: [] }]);
    expect(parseClaims('{broken json [S1: "launched"]', sources)[0]!.citations).toEqual([{ sourceId: 'deck-2026', quote: 'launched' }]);
    expect(parseClaims('   ', sources)).toEqual([]);
  });

  it('falls back to a regex sentence splitter when Intl.Segmenter is unavailable', () => {
    const original = Intl.Segmenter;
    // @ts-expect-error removing for the test
    Intl.Segmenter = undefined;
    try {
      expect(parseClaims('One [S1: "a"]. Two [uncited]!', sources).map((c) => c.text)).toEqual(['One.', 'Two!']);
    } finally {
      Intl.Segmenter = original;
    }
  });
});

describe('toFootnotes', () => {
  it('renders claims with numbered footnotes linking to sources', () => {
    const md = toFootnotes(
      [
        { text: 'Launched in 2021.', citations: [{ sourceId: 'deck-2026', quote: 'launched in 2021' }, { sourceId: 'sheet', start: 0, end: 8 }] },
        { text: 'Unknown source.', citations: [{ sourceId: 'ghost' }] },
        { text: 'No citation.', citations: [] },
      ],
      sources,
    );
    expect(md).toBe(
      'Launched in 2021.[^1][^2]\n\nUnknown source.[^3]\n\nNo citation.\n\n[^1]: [S1](https://example.com/deck.pdf) - "launched in 2021"\n[^2]: FACTS - 0-8\n[^3]: ghost',
    );
    expect(toFootnotes([], sources)).toBe('');
  });
});
