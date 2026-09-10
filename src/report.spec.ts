import { check, checkFields } from './verify.js';
import { renderReport } from './report.js';
import type { Source } from './types.js';

const sources: Source[] = [{ id: 'a', text: 'The bridge opened in 1932 and carries 160,000 vehicles a day across the harbour, which is a lot | of traffic.' }];

describe('renderReport', () => {
  it('renders a claim report with counts, status rows and clipped, escaped evidence', () => {
    const report = check(
      [
        { text: 'Opened in 1932.', citations: [{ sourceId: 'a', quote: 'opened in 1932' }] },
        { text: 'Busy | road.', citations: [{ sourceId: 'a', quote: 'carries 160,000 vehicles a day across the harbour, which is a lot | of traffic' }, { sourceId: 'b', quote: 'x' }] },
        { text: 'No evidence.', citations: [] },
      ],
      sources,
      { threshold: { coverage: 0.5, allowPartial: true } },
    );
    report.claims[1]!.judgment = { verdict: 'supports', confidence: 0.9 };
    report.claims[1]!.note = 'checked';
    const md = renderReport(report, { maxQuote: 30 });
    expect(md).toContain('# sourcecheck report');
    expect(md).toContain('- Claims: 3 - supported 1, partial 1, unsupported 0, uncited 1');
    expect(md).toContain('- Citations resolved: 2 of 3');
    expect(md).toContain('- Coverage: 67% (threshold 50%, partial counts) - PASS');
    expect(md).toContain('| 1 | supported | Opened in 1932. | a 11-25 exact: "opened in 1932" |');
    expect(md).toContain('| 2 | partial | Busy \\| road. | a 30-108 exact: "carries 160,000 vehicles a..."<br>b missing-source<br>judge: supports (0.9); checked |');
    expect(md).toContain('| 3 | uncited | No evidence. | no citations |');
  });

  it('renders a field report with the value mismatch line and fuzzy scores', () => {
    const report = checkFields(
      {
        year: { value: 1932, citations: [{ sourceId: 'a', quote: 'the bridge opened in 1932' }] },
        traffic: { value: '200,000', citations: [{ sourceId: 'a', quote: 'carries 160,000 cars a day' }] },
      },
      sources,
    );
    const md = renderReport(report, { title: 'Deck extraction' });
    expect(md).toContain('# Deck extraction');
    expect(md).toContain('- Fields: 2 - supported 1, partial 1, unsupported 0, uncited 0');
    expect(md).toContain('- Values not found in their passage: 1');
    expect(md).toContain('- Coverage: 50% (threshold 100%) - FAIL');
    expect(md).toContain('| 1 | supported | year = 1932 | a 0-25 normalized: "The bridge opened in 1932" |');
    expect(md).toMatch(/\| 2 \| partial \| traffic = 200,000 \| a \d+-\d+ fuzzy \(0\.8\d*\): "carries 160,000 vehicles a day"<br>the cited passage resolves but does not contain the value \|/);
  });
});
