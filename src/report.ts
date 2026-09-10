import type { CitationResult, ClaimResult, FieldReport, Report } from './types.js';

export interface RenderOptions {
  title?: string;
  /** Characters of each passage shown. Default 80. */
  maxQuote?: number;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function evidence(c: CitationResult, maxQuote: number): string {
  const where = c.passage ? `${c.passage.sourceId} ${c.passage.start}-${c.passage.end}` : c.citation.sourceId;
  const score = c.ok && c.score < 1 ? ` (${c.score})` : '';
  const quote = c.passage ? `: "${clip(c.passage.text, maxQuote)}"` : '';
  return `${where} ${c.status}${score}${quote}`;
}

function rows<R extends ClaimResult>(results: R[], label: (r: R) => string, maxQuote: number): string[] {
  return results.map((r) => {
    const ev = r.citations.length ? r.citations.map((c) => evidence(c, maxQuote)).join('<br>') : 'no citations';
    const extra = [r.judgment ? `judge: ${r.judgment.verdict} (${r.judgment.confidence})` : '', r.note ?? ''].filter(Boolean).join('; ');
    return `| ${r.index + 1} | ${r.status} | ${cell(clip(label(r), 120))} | ${cell(ev)}${extra ? `<br>${cell(extra)}` : ''} |`;
  });
}

/** A Markdown report for a claim or field check. */
export function renderReport(report: Report | FieldReport, options: RenderOptions = {}): string {
  const maxQuote = options.maxQuote ?? 80;
  const isFields = 'fields' in report;
  const s = report.summary;
  const head = [
    `# ${options.title ?? (isFields ? 'sourcecheck field report' : 'sourcecheck report')}`,
    '',
    `- ${isFields ? 'Fields' : 'Claims'}: ${s.claims} - supported ${s.supported}, partial ${s.partial}, unsupported ${s.unsupported}, uncited ${s.uncited}`,
    `- Citations resolved: ${s.citationsOk} of ${s.citations}`,
    ...(isFields ? [`- Values not found in their passage: ${(report as FieldReport).summary.valueMismatches}`] : []),
    `- Coverage: ${Math.round(s.coverage * 100)}% (threshold ${Math.round(report.threshold.coverage * 100)}%${report.threshold.allowPartial ? ', partial counts' : ''}) - ${report.pass ? 'PASS' : 'FAIL'}`,
    '',
    `| # | Status | ${isFields ? 'Field' : 'Claim'} | Evidence |`,
    '|---|---|---|---|',
  ];
  const body = isFields
    ? rows((report as FieldReport).fields, (r) => `${r.field} = ${r.claim.text}`, maxQuote)
    : rows((report as Report).claims, (r) => r.claim.text, maxQuote);
  return [...head, ...body].join('\n');
}
