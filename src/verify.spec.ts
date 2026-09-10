import { check, checkFields, findSource, valueInPassages, verifyCitation, verifyClaim } from './verify.js';
import type { Claim, Source } from './types.js';

const pitch: Source = {
  id: 'deck',
  text: 'Northwind Credit Fund targets a net return of 8-10% with a 3.5 year duration. Minimum commitment is $25,000,000. The fund launched in 2021 and holds 140 positions.',
};
const sheet: Source = { id: 'sheet', text: 'Fact sheet, Q2 2026. Assets under management: $1.2bn. The strategy is rated A- by Fitch.' };
const sources = [pitch, sheet];

describe('verifyCitation', () => {
  it('resolves quotes exactly, after normalization, and fuzzily', () => {
    expect(verifyCitation({ sourceId: 'deck', quote: 'launched in 2021' }, sources)).toMatchObject({
      status: 'exact',
      ok: true,
      score: 1,
      passage: { sourceId: 'deck', text: 'launched in 2021' },
    });
    expect(verifyCitation({ sourceId: 'sheet', quote: 'RATED A- BY FITCH' }, sources)).toMatchObject({ status: 'normalized', ok: true });
    expect(verifyCitation({ sourceId: 'deck', quote: 'The fund launched in 2021 and holds about 140 positions' }, sources)).toMatchObject({ status: 'fuzzy', ok: true, score: 0.9 });
    // A four-word quote with one extra word scores 0.75, under the default 0.8 floor.
    expect(verifyCitation({ sourceId: 'deck', quote: 'holds about 140 positions' }, sources)).toMatchObject({ status: 'not-found' });
    expect(verifyCitation({ sourceId: 'deck', quote: 'holds about 140 positions' }, sources, { minScore: 0.7 })).toMatchObject({ status: 'fuzzy', score: 0.75 });
  });

  it('accepts offsets that point at the quote, and relocates when they drift', () => {
    const start = pitch.text.indexOf('Minimum');
    const end = start + 'Minimum commitment is $25,000,000.'.length;
    expect(verifyCitation({ sourceId: 'deck', start, end }, sources)).toMatchObject({ status: 'exact', passage: { start, end } });
    expect(verifyCitation({ sourceId: 'deck', quote: 'minimum commitment is $25,000,000.', start, end }, sources)).toMatchObject({ status: 'exact' });
    const drifted = verifyCitation({ sourceId: 'deck', quote: 'Minimum commitment is $25,000,000.', start: start + 5, end: end + 5 }, sources);
    expect(drifted).toMatchObject({ status: 'relocated', ok: true, score: 1, passage: { start, end } });
    expect(drifted.note).toContain('quote found at');
    const beyond = verifyCitation({ sourceId: 'deck', quote: 'Minimum commitment is $25,000,000.', start: 5000, end: 5010 }, sources);
    expect(beyond.status).toBe('relocated');
  });

  it('reports out-of-range offsets, missing sources, empty citations and unfindable quotes', () => {
    expect(verifyCitation({ sourceId: 'deck', start: 5, end: 9999 }, sources)).toMatchObject({ status: 'out-of-range', ok: false });
    expect(verifyCitation({ sourceId: 'deck', start: 9, end: 3 }, sources)).toMatchObject({ status: 'empty' });
    expect(verifyCitation({ sourceId: 'nope', quote: 'x' }, sources)).toMatchObject({ status: 'missing-source' });
    expect(verifyCitation({ sourceId: 'deck' }, sources)).toMatchObject({ status: 'empty' });
    expect(verifyCitation({ sourceId: 'deck', quote: 'guaranteed returns of 20%' }, sources)).toMatchObject({ status: 'not-found', ok: false, score: 0 });
    const wrongOffsets = verifyCitation({ sourceId: 'deck', quote: 'guaranteed returns of 20%', start: 0, end: 10 }, sources);
    expect(wrongOffsets.status).toBe('not-found');
    expect(wrongOffsets.note).toContain('point at different text');
    const outAndMissing = verifyCitation({ sourceId: 'deck', quote: 'guaranteed returns', start: -4, end: 2 }, sources);
    expect(outAndMissing.note).toContain('out of range');
  });

  it('finds sources in arrays, maps and records', () => {
    expect(findSource(sources, 'sheet')).toBe(sheet);
    expect(findSource(new Map([[sheet.id, sheet]]), 'sheet')).toBe(sheet);
    expect(findSource({ sheet }, 'sheet')).toBe(sheet);
    expect(findSource({ sheet }, 'toString')).toBeUndefined();
    expect(verifyCitation({ sourceId: 'sheet', quote: 'Q2 2026' }, { sheet })).toMatchObject({ status: 'exact' });
  });
});

describe('verifyClaim and check', () => {
  const claims: Claim[] = [
    { text: 'The fund launched in 2021.', citations: [{ sourceId: 'deck', quote: 'launched in 2021' }] },
    { text: 'It targets 8-10% net and is rated A-.', citations: [{ sourceId: 'deck', quote: 'net return of 8-10%' }, { sourceId: 'sheet', quote: 'rated AAA' }] },
    { text: 'Returns are guaranteed.', citations: [{ sourceId: 'deck', quote: 'returns are guaranteed' }] },
    { text: 'The manager is based in Boston.', citations: [] },
  ];

  it('grades claims supported, partial, unsupported and uncited', () => {
    expect(verifyClaim(claims[0]!, sources)).toMatchObject({ status: 'supported', score: 1 });
    expect(verifyClaim(claims[1]!, sources, {}, 1)).toMatchObject({ status: 'partial', score: 0.5, index: 1 });
    expect(verifyClaim(claims[2]!, sources)).toMatchObject({ status: 'unsupported', score: 0 });
    expect(verifyClaim(claims[3]!, sources)).toMatchObject({ status: 'uncited', score: 0, citations: [] });
    expect(verifyClaim({ text: 'x' } as Claim, sources).status).toBe('uncited');
  });

  it('builds a report with a summary, a threshold and a pass flag', () => {
    const report = check(claims, sources);
    expect(report.summary).toEqual({ claims: 4, supported: 1, partial: 1, unsupported: 1, uncited: 1, citations: 4, citationsOk: 2, coverage: 0.25 });
    expect(report.pass).toBe(false);
    expect(report.threshold).toEqual({ coverage: 1, allowPartial: false });
    expect(check({ claims }, sources, { threshold: { coverage: 0.25 } }).pass).toBe(true);
    expect(check(claims, sources, { threshold: { coverage: 0.5, allowPartial: true } })).toMatchObject({ pass: true, summary: { coverage: 0.5 } });
    expect(check([], sources)).toMatchObject({ pass: true, summary: { claims: 0, coverage: 1 } });
    expect(() => check(claims, sources, { threshold: { coverage: 2 } })).toThrow(RangeError);
  });

  it('passes locate options through', () => {
    const fuzzyClaim: Claim = { text: 'x', citations: [{ sourceId: 'deck', quote: 'The fund launched in 2021 and holds about 140 positions' }] };
    expect(check([fuzzyClaim], sources).summary.supported).toBe(1);
    expect(check([fuzzyClaim], sources, { fuzzy: false }).summary.supported).toBe(0);
  });
});

describe('checkFields', () => {
  it('requires the value to appear in the cited passage', () => {
    const report = checkFields(
      {
        targetReturn: { value: '8-10%', citations: [{ sourceId: 'deck', quote: 'targets a net return of 8-10%' }] },
        minimum: { value: 25000000, citations: [{ sourceId: 'deck', quote: 'Minimum commitment is $25,000,000.' }] },
        aum: { value: '$1.2bn', citations: [{ sourceId: 'sheet', quote: 'Assets under management: $1.2bn' }] },
        rating: { value: 'AAA', citations: [{ sourceId: 'sheet', quote: 'rated A- by Fitch' }] },
        launched: { value: 2021, citations: [{ sourceId: 'deck', quote: 'not in the deck at all' }] },
        positions: { value: ['140', 'positions'], citations: [{ sourceId: 'deck', quote: 'holds 140 positions' }] },
        manager: { value: 'Northwind', citations: [] },
        empty: { value: null, citations: [{ sourceId: 'deck', quote: 'launched in 2021' }] },
      },
      sources,
    );
    const by = Object.fromEntries(report.fields.map((f) => [f.field, f]));
    expect(by.targetReturn).toMatchObject({ status: 'supported', valueFound: true });
    expect(by.minimum).toMatchObject({ status: 'supported', valueFound: true });
    expect(by.aum).toMatchObject({ status: 'supported', valueFound: true });
    expect(by.rating).toMatchObject({ status: 'partial', valueFound: false });
    expect(by.rating!.note).toContain('does not contain the value');
    expect(by.launched).toMatchObject({ status: 'unsupported', valueFound: null });
    expect(by.positions).toMatchObject({ status: 'supported', valueFound: true, claim: { text: '140, positions' } });
    expect(by.manager).toMatchObject({ status: 'uncited', valueFound: null });
    expect(by.empty).toMatchObject({ status: 'supported', valueFound: null });
    expect(report.summary).toMatchObject({ claims: 8, supported: 5, partial: 1, unsupported: 1, uncited: 1, valueMismatches: 1, coverage: 0.625 });
    expect(report.pass).toBe(false);
    expect(checkFields({}, sources).pass).toBe(true);
  });

  it('valueInPassages handles nested values and numbers with separators', () => {
    const passages = [{ sourceId: 'deck', start: 0, end: 10, text: 'Minimum commitment is $25,000,000 and fees are 1.5%.' }];
    expect(valueInPassages({ min: 25000000, fee: '1.5%' }, passages)).toBe(true);
    expect(valueInPassages('1.5', passages)).toBe(true);
    expect(valueInPassages(2000, passages)).toBe(false);
    expect(valueInPassages([], passages)).toBeNull();
    expect(valueInPassages(undefined, passages)).toBeNull();
  });
});
