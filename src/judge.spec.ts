import { checkWithJudge, judgePrompt, parseVerdict } from './judge.js';
import type { Claim, JudgeInput, Source } from './types.js';

const sources: Source[] = [{ id: 'a', text: 'The bridge opened in 1932 and carries 160,000 vehicles a day. It was painted grey until 1960.' }];
const claims: Claim[] = [
  { text: 'The bridge opened in 1932.', citations: [{ sourceId: 'a', quote: 'opened in 1932' }] },
  { text: 'The bridge opened in 1935.', citations: [{ sourceId: 'a', quote: 'opened in 1932' }] },
  { text: 'It is the longest bridge in the world.', citations: [{ sourceId: 'a', quote: 'carries 160,000 vehicles' }] },
  { text: 'Nothing cited.', citations: [] },
];

describe('judgePrompt and parseVerdict', () => {
  it('lists the claim and numbered passages', () => {
    const text = judgePrompt({ claim: claims[0]!, passages: [{ sourceId: 'a', start: 11, end: 25, text: 'opened in 1932' }] });
    expect(text).toContain('Claim:\nThe bridge opened in 1932.');
    expect(text).toContain('[1] (a 11-25)\nopened in 1932');
    expect(judgePrompt({ claim: claims[0]!, passages: [] })).toContain('(none)');
  });

  it('parses JSON verdicts, with or without fences, clamping confidence', () => {
    expect(parseVerdict('```json\n{"verdict":"Supports","confidence":0.9,"rationale":"Says so."}\n```')).toEqual({ verdict: 'supports', confidence: 0.9, rationale: 'Says so.' });
    expect(parseVerdict('Sure: {"verdict":"contradicts","confidence":7}')).toEqual({ verdict: 'contradicts', confidence: 1 });
    expect(parseVerdict('{"verdict":"unrelated"}')).toEqual({ verdict: 'unrelated', confidence: 1 });
  });

  it('parses a leading verdict word with an optional confidence', () => {
    expect(parseVerdict('Supports. Confidence: 0.75')).toEqual({ verdict: 'supports', confidence: 0.75 });
    expect(parseVerdict('contradicts (confidence 80%)')).toEqual({ verdict: 'contradicts', confidence: 0.8 });
    expect(parseVerdict('Unrelated')).toEqual({ verdict: 'unrelated', confidence: 1 });
  });

  it('returns unknown for anything else', () => {
    expect(parseVerdict('I am not sure.')).toEqual({ verdict: 'unknown', confidence: 0 });
    expect(parseVerdict('{"verdict":"maybe"}')).toEqual({ verdict: 'unknown', confidence: 0 });
    expect(parseVerdict('{broken')).toEqual({ verdict: 'unknown', confidence: 0 });
  });
});

describe('checkWithJudge', () => {
  it('asks the judge only about claims with passages and downgrades the ones it rejects', async () => {
    const seen: string[] = [];
    const judge = async ({ claim }: JudgeInput) => {
      seen.push(claim.text);
      if (claim.text.includes('1935')) return '{"verdict":"contradicts","confidence":0.95,"rationale":"The source says 1932."}';
      if (claim.text.includes('longest')) return { verdict: 'unrelated' as const, confidence: 0.6 };
      return 'supports';
    };
    const report = await checkWithJudge(claims, sources, { judge, concurrency: 2, threshold: { coverage: 0.25 } });
    expect(seen.sort()).toEqual(['It is the longest bridge in the world.', 'The bridge opened in 1932.', 'The bridge opened in 1935.']);
    expect(report.claims.map((c) => c.status)).toEqual(['supported', 'unsupported', 'unsupported', 'uncited']);
    expect(report.claims[1]!.judgment).toEqual({ verdict: 'contradicts', confidence: 0.95, rationale: 'The source says 1932.' });
    expect(report.claims[1]!.note).toBe('judge: contradicts - The source says 1932.');
    expect(report.claims[2]!.note).toBe('judge: unrelated');
    expect(report.claims[1]!.citations[0]!.ok).toBe(true);
    expect(report.summary).toMatchObject({ supported: 1, unsupported: 2, uncited: 1, coverage: 0.25 });
    expect(report.pass).toBe(true);
  });

  it('treats an unusable verdict as unsupported and runs with a single worker', async () => {
    const report = await checkWithJudge({ claims: claims.slice(0, 1) }, sources, { judge: () => 'no idea', concurrency: 1 });
    expect(report.claims[0]).toMatchObject({ status: 'unsupported', note: 'judge gave no usable verdict', judgment: { verdict: 'unknown' } });
  });
});
