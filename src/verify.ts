import type {
  CheckOptions,
  Citation,
  CitationResult,
  Claim,
  ClaimResult,
  ClaimStatus,
  FieldEvidence,
  FieldReport,
  FieldResult,
  LocateOptions,
  Passage,
  Report,
  Source,
  Sources,
  Summary,
  Threshold,
} from './types.js';
import { locate } from './locate.js';
import { normalizeText } from './normalize.js';

export function findSource(sources: Sources, id: string): Source | undefined {
  if (Array.isArray(sources)) return sources.find((s) => s.id === id);
  if (sources instanceof Map) return sources.get(id);
  return Object.prototype.hasOwnProperty.call(sources, id) ? sources[id] : undefined;
}

function passageOf(source: Source, start: number, end: number): Passage {
  return { sourceId: source.id, start, end, text: source.text.slice(start, end) };
}

function sameText(a: string, b: string): boolean {
  return a === b || normalizeText(a) === normalizeText(b);
}

/** Resolves one citation against its source. */
export function verifyCitation(citation: Citation, sources: Sources, options: LocateOptions = {}): CitationResult {
  const source = findSource(sources, citation.sourceId);
  if (!source) return { citation, status: 'missing-source', ok: false, score: 0, note: `no source with id "${citation.sourceId}"` };

  const quote = citation.quote?.trim() ?? '';
  const { start, end } = citation;
  const hasOffsets = Number.isInteger(start) && Number.isInteger(end) && (end as number) > (start as number);
  if (!quote && !hasOffsets) return { citation, status: 'empty', ok: false, score: 0, note: 'neither a quote nor offsets' };

  if (hasOffsets) {
    const s = start as number;
    const e = end as number;
    const inRange = s >= 0 && e <= source.text.length;
    if (inRange) {
      const slice = source.text.slice(s, e);
      if (!quote || sameText(slice, quote)) {
        return { citation, status: 'exact', ok: true, score: 1, passage: passageOf(source, s, e) };
      }
    }
    if (!quote) return { citation, status: 'out-of-range', ok: false, score: 0, note: `offsets ${s}-${e} fall outside a ${source.text.length}-character source` };
    const match = locate(quote, source.text, { ...options, near: s });
    if (!match) return { citation, status: 'not-found', ok: false, score: 0, note: inRange ? 'offsets point at different text and the quote is not in the source' : 'offsets out of range and the quote is not in the source' };
    return {
      citation,
      status: 'relocated',
      ok: true,
      score: match.score,
      passage: passageOf(source, match.start, match.end),
      note: `offsets said ${s}-${e}, quote found at ${match.start}-${match.end} (${match.method})`,
    };
  }

  const match = locate(quote, source.text, options);
  if (!match) return { citation, status: 'not-found', ok: false, score: 0 };
  return { citation, status: match.method, ok: true, score: match.score, passage: passageOf(source, match.start, match.end) };
}

function statusOf(results: CitationResult[]): ClaimStatus {
  if (results.length === 0) return 'uncited';
  const ok = results.filter((r) => r.ok).length;
  if (ok === results.length) return 'supported';
  return ok === 0 ? 'unsupported' : 'partial';
}

function scoreOf(results: CitationResult[]): number {
  if (results.length === 0) return 0;
  const total = results.reduce((t, r) => t + (r.ok ? r.score : 0), 0);
  return Math.round((total / results.length) * 1000) / 1000;
}

/** Resolves every citation of a claim and grades the claim. */
export function verifyClaim(claim: Claim, sources: Sources, options: LocateOptions = {}, index = 0): ClaimResult {
  const citations = (claim.citations ?? []).map((c) => verifyCitation(c, sources, options));
  return { index, claim, status: statusOf(citations), score: scoreOf(citations), citations };
}

export function passagesOf(result: ClaimResult): Passage[] {
  return result.citations.flatMap((c) => (c.ok && c.passage ? [c.passage] : []));
}

function resolveThreshold(t: Threshold | undefined): Required<Threshold> {
  const coverage = t?.coverage ?? 1;
  if (!(coverage >= 0 && coverage <= 1)) throw new RangeError('sourcecheck: threshold.coverage must be between 0 and 1');
  return { coverage, allowPartial: t?.allowPartial ?? false };
}

export function summarize(results: ClaimResult[], threshold: Required<Threshold>): Summary {
  const count = (status: ClaimStatus) => results.filter((r) => r.status === status).length;
  const supported = count('supported');
  const partial = count('partial');
  const covered = supported + (threshold.allowPartial ? partial : 0);
  const citations = results.reduce((t, r) => t + r.citations.length, 0);
  const citationsOk = results.reduce((t, r) => t + r.citations.filter((c) => c.ok).length, 0);
  return {
    claims: results.length,
    supported,
    partial,
    unsupported: count('unsupported'),
    uncited: count('uncited'),
    citations,
    citationsOk,
    coverage: results.length === 0 ? 1 : Math.round((covered / results.length) * 1000) / 1000,
  };
}

export function buildReport(results: ClaimResult[], threshold: Threshold | undefined): Report {
  const t = resolveThreshold(threshold);
  const summary = summarize(results, t);
  return { claims: results, summary, threshold: t, pass: summary.coverage >= t.coverage };
}

function claimList(input: Claim[] | { claims: Claim[] }): Claim[] {
  return Array.isArray(input) ? input : input.claims;
}

/** Checks every claim against the sources. Deterministic; no model involved. */
export function check(claims: Claim[] | { claims: Claim[] }, sources: Sources, options: CheckOptions = {}): Report {
  const { threshold, ...locateOptions } = options;
  const results = claimList(claims).map((claim, i) => verifyClaim(claim, sources, locateOptions, i));
  return buildReport(results, threshold);
}

function valueStrings(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(valueStrings);
  if (typeof value === 'object') return valueStrings(Object.values(value as Record<string, unknown>));
  const s = String(value).trim();
  return s ? [s] : [];
}

function looseNumber(s: string): string | null {
  const stripped = s.replace(/[$€£%,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(stripped) ? stripped : null;
}

/** True when the value, or every element of an array value, appears in one of the passages. */
export function valueInPassages(value: unknown, passages: Passage[]): boolean | null {
  const parts = valueStrings(value);
  if (parts.length === 0) return null;
  const haystacks = passages.map((p) => normalizeText(p.text));
  const numericHaystacks = haystacks.map((h) => h.replace(/[$€£%,\s]/g, ''));
  return parts.every((part) => {
    const needle = normalizeText(part);
    if (haystacks.some((h) => h.includes(needle))) return true;
    const num = looseNumber(part);
    return num !== null && numericHaystacks.some((h) => h.includes(num));
  });
}

/**
 * Checks a structured extraction: each field carries a value and the citations that justify it. A field
 * is supported only when its citations resolve and the value itself appears in the cited text.
 */
export function checkFields(fields: Record<string, FieldEvidence>, sources: Sources, options: CheckOptions = {}): FieldReport {
  const { threshold, ...locateOptions } = options;
  const results: FieldResult[] = Object.entries(fields).map(([field, evidence], i) => {
    const claim: Claim = { id: field, text: valueStrings(evidence.value).join(', '), citations: evidence.citations ?? [] };
    const base = verifyClaim(claim, sources, locateOptions, i);
    const valueFound = base.citations.some((c) => c.ok) ? valueInPassages(evidence.value, passagesOf(base)) : null;
    const result: FieldResult = { ...base, field, valueFound };
    if (base.status === 'supported' && valueFound === false) {
      result.status = 'partial';
      result.note = 'the cited passage resolves but does not contain the value';
    }
    return result;
  });
  const t = resolveThreshold(threshold);
  const summary = summarize(results, t);
  return {
    fields: results,
    summary: { ...summary, valueMismatches: results.filter((r) => r.valueFound === false).length },
    threshold: t,
    pass: summary.coverage >= t.coverage,
  };
}
