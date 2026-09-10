export interface Source {
  id: string;
  text: string;
  title?: string;
  url?: string;
  /** Label used in prompts and parsed replies. Defaults to S1, S2, ... in array order. */
  label?: string;
}

export type Sources = Source[] | Map<string, Source> | Record<string, Source>;

export interface Citation {
  sourceId: string;
  /** Verbatim words the model quoted. */
  quote?: string;
  /** Character offsets into the source text, when the model or your pipeline tracked them. */
  start?: number;
  end?: number;
}

export interface Claim {
  id?: string;
  text: string;
  citations: Citation[];
}

export interface Passage {
  sourceId: string;
  start: number;
  end: number;
  text: string;
}

export type MatchMethod = 'exact' | 'normalized' | 'fuzzy';

export interface Match {
  start: number;
  end: number;
  text: string;
  method: MatchMethod;
  /** 1 for exact and normalized matches; word-level similarity for fuzzy ones. */
  score: number;
}

export interface LocateOptions {
  /** Lowest fuzzy similarity accepted. Default 0.8. */
  minScore?: number;
  /** Allow fuzzy matching. Default true. */
  fuzzy?: boolean;
  /** Words a fuzzy window may be shorter or longer than the quote. Default a quarter of the quote's length, at least 1. */
  slack?: number;
  /** Prefer the occurrence closest to this offset when there are several. */
  near?: number;
}

export type CitationStatus =
  | 'exact'
  | 'normalized'
  | 'fuzzy'
  | 'relocated'
  | 'not-found'
  | 'missing-source'
  | 'out-of-range'
  | 'empty';

export interface CitationResult {
  citation: Citation;
  status: CitationStatus;
  /** True when the citation resolved to a passage. */
  ok: boolean;
  score: number;
  passage?: Passage;
  note?: string;
}

export type ClaimStatus = 'supported' | 'partial' | 'unsupported' | 'uncited';

export interface Judgment {
  verdict: 'supports' | 'contradicts' | 'unrelated' | 'unknown';
  confidence: number;
  rationale?: string;
}

export interface ClaimResult {
  index: number;
  claim: Claim;
  status: ClaimStatus;
  /** Mean score of the resolved citations over all citations; 0 when uncited. */
  score: number;
  citations: CitationResult[];
  judgment?: Judgment;
  note?: string;
}

export interface Threshold {
  /** Share of claims that must be supported for `pass`. Default 1. */
  coverage?: number;
  /** Count partial claims as covered. Default false. */
  allowPartial?: boolean;
}

export interface CheckOptions extends LocateOptions {
  threshold?: Threshold;
}

export interface Summary {
  claims: number;
  supported: number;
  partial: number;
  unsupported: number;
  uncited: number;
  citations: number;
  citationsOk: number;
  /** Covered claims over all claims; 1 when there are no claims. */
  coverage: number;
}

export interface Report {
  claims: ClaimResult[];
  summary: Summary;
  threshold: Required<Threshold>;
  pass: boolean;
}

export interface FieldEvidence {
  value: unknown;
  citations: Citation[];
}

export interface FieldResult extends ClaimResult {
  field: string;
  /** Whether the value appears in a resolved passage; null when the value is empty. */
  valueFound: boolean | null;
}

export interface FieldReport extends Omit<Report, 'claims'> {
  fields: FieldResult[];
  summary: Summary & { valueMismatches: number };
}

export interface JudgeInput {
  claim: Claim;
  passages: Passage[];
}

export type Judge = (input: JudgeInput) => Promise<Judgment | string> | Judgment | string;

export interface JudgeOptions extends CheckOptions {
  judge: Judge;
  /** Parallel judge calls. Default 4. */
  concurrency?: number;
}
