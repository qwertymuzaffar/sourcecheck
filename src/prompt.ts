import type { Citation, Claim, Source } from './types.js';

export function labelOf(source: Source, index: number): string {
  return source.label ?? `S${index + 1}`;
}

function labelMap(sources: Source[]): Map<string, string> {
  const map = new Map<string, string>();
  sources.forEach((s, i) => {
    map.set(labelOf(s, i), s.id);
    map.set(s.id, s.id);
  });
  return map;
}

export interface InstructionOptions {
  /** `inline` asks for [S1: "quote"] markers in prose; `json` asks for a claims array. Default inline. */
  style?: 'inline' | 'json';
  /** Include the source texts. Default true. */
  includeText?: boolean;
}

/** Text to put in a prompt: the labelled sources and the rule for citing them. */
export function citationInstructions(sources: Source[], options: InstructionOptions = {}): string {
  const style = options.style ?? 'inline';
  const includeText = options.includeText ?? true;
  const listing = sources
    .map((s, i) => {
      const head = [`[${labelOf(s, i)}]`, s.title, s.url ? `(${s.url})` : undefined].filter(Boolean).join(' ');
      return includeText ? `${head}\n${s.text.trim()}` : head;
    })
    .join('\n\n');
  const rule =
    style === 'json'
      ? [
          'Reply with JSON only: {"claims": [{"text": "one factual statement", "citations": [{"source": "S1", "quote": "exact words copied from that source"}]}]}.',
          'Every claim needs at least one citation. Quotes must be copied verbatim from the source text; never paraphrase inside a quote.',
          'A claim you cannot support from the sources gets an empty citations array.',
        ]
      : [
          'Cite every factual statement with the source label and an exact quote from that source, like this: [S1: "exact words copied from the source"].',
          'Quotes must be copied verbatim; never paraphrase inside a quote. Put the marker at the end of the sentence it supports.',
          'A sentence you cannot support from the sources gets the marker [uncited].',
        ];
  return `Sources:\n\n${listing}\n\n${rule.join(' ')}`;
}

function splitSentences(text: string): string[] {
  const Seg = (globalThis as { Intl?: { Segmenter?: new (locale: string, opts: { granularity: 'sentence' }) => { segment(s: string): Iterable<{ segment: string }> } } }).Intl?.Segmenter;
  if (Seg) return [...new Seg('en', { granularity: 'sentence' }).segment(text)].map((s) => s.segment);
  return text.split(/(?<=[.!?])\s+/);
}

const MARKER = /\[(uncited|[^\]:]+?)(?::\s*"((?:[^"\\]|\\.)*)")?\]/g;

interface RawCitation {
  source?: string;
  sourceId?: string;
  quote?: string;
  start?: number;
  end?: number;
}

function toCitation(raw: RawCitation, labels: Map<string, string>): Citation {
  const ref = String(raw.sourceId ?? raw.source ?? '').trim();
  const c: Citation = { sourceId: labels.get(ref) ?? ref };
  if (typeof raw.quote === 'string' && raw.quote.trim()) c.quote = raw.quote;
  if (Number.isInteger(raw.start)) c.start = raw.start;
  if (Number.isInteger(raw.end)) c.end = raw.end;
  return c;
}

/** Claims from the JSON reply shape (an array, or `{ claims: [...] }`); null when the body is not that shape. */
function parseJsonClaims(body: string, labels: Map<string, string>): Claim[] | null {
  if (!body.startsWith('{') && !body.startsWith('[')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { claims?: unknown }).claims;
  if (!Array.isArray(list)) return null;
  return list
    .filter((entry): entry is { text: unknown; citations?: unknown; id?: unknown } => !!entry && typeof entry === 'object' && 'text' in entry)
    .map((entry) => {
      const claim: Claim = {
        text: String(entry.text).trim(),
        citations: (Array.isArray(entry.citations) ? (entry.citations as RawCitation[]) : []).map((raw) => toCitation(raw, labels)),
      };
      if (typeof entry.id === 'string') claim.id = entry.id;
      return claim;
    })
    .filter((claim) => claim.text);
}

/** Claims from prose with inline `[S1: "quote"]` / `[uncited]` markers, one claim per sentence. */
function parseInlineClaims(body: string, labels: Map<string, string>): Claim[] {
  const claims: Claim[] = [];
  for (const sentence of splitSentences(body)) {
    const citations: Citation[] = [];
    const text = sentence
      .replace(MARKER, (_marker, ref: string, quote: string | undefined) => {
        if (ref.toLowerCase() !== 'uncited') {
          const citation: Citation = { sourceId: labels.get(ref.trim()) ?? ref.trim() };
          if (quote) citation.quote = quote.replace(/\\"/g, '"');
          citations.push(citation);
        }
        return '';
      })
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();
    if (text) claims.push({ text, citations });
  }
  return claims;
}

/** Reads claims from a model reply written under `citationInstructions`, JSON or inline. */
export function parseClaims(reply: string, sources: Source[]): Claim[] {
  const labels = labelMap(sources);
  const body = reply.replace(/^\s*```[a-z]*\s*|\s*```\s*$/g, '').trim();
  if (!body) return [];
  return parseJsonClaims(body, labels) ?? parseInlineClaims(body, labels);
}

/** Claims as Markdown with footnotes for their citations. */
export function toFootnotes(claims: Claim[], sources: Source[]): string {
  const byId = new Map(sources.map((s, i) => [s.id, { source: s, label: labelOf(s, i) }]));
  const lines: string[] = [];
  const notes: string[] = [];
  let n = 0;
  for (const claim of claims) {
    const refs: string[] = [];
    for (const c of claim.citations) {
      n++;
      refs.push(`[^${n}]`);
      const entry = byId.get(c.sourceId);
      const where = entry ? (entry.source.url ? `[${entry.label}](${entry.source.url})` : entry.label) : c.sourceId;
      notes.push(`[^${n}]: ${where}${c.quote ? ` - "${c.quote}"` : c.start !== undefined ? ` - ${c.start}-${c.end}` : ''}`);
    }
    lines.push(`${claim.text}${refs.join('')}`);
  }
  return [lines.join('\n\n'), notes.join('\n')].filter(Boolean).join('\n\n');
}
