import type { Claim, JudgeInput, JudgeOptions, Judgment, Report, Sources } from './types.js';
import { buildReport, check, passagesOf } from './verify.js';

/** A prompt asking a chat model whether the passages support the claim. */
export function judgePrompt({ claim, passages }: JudgeInput): string {
  const evidence = passages.map((p, i) => `[${i + 1}] (${p.sourceId} ${p.start}-${p.end})\n${p.text.trim()}`).join('\n\n');
  return [
    'Decide whether the evidence passages support the claim. Use only the passages; ignore anything you know from elsewhere.',
    'Reply with JSON: {"verdict": "supports" | "contradicts" | "unrelated", "confidence": 0 to 1, "rationale": "one sentence"}.',
    '',
    'Claim:',
    claim.text.trim(),
    '',
    'Evidence:',
    evidence || '(none)',
  ].join('\n');
}

const VERDICTS = new Set(['supports', 'contradicts', 'unrelated']);

/** Reads a judgment from a model reply: JSON, or a first word of supports/contradicts/unrelated with an optional confidence. */
export function parseVerdict(text: string): Judgment {
  const body = text.replace(/^\s*```[a-z]*\s*|\s*```\s*$/g, '').trim();
  const json = body.indexOf('{');
  if (json >= 0) {
    try {
      const parsed = JSON.parse(body.slice(json, body.lastIndexOf('}') + 1)) as { verdict?: unknown; confidence?: unknown; rationale?: unknown };
      const verdict = String(parsed.verdict ?? '').toLowerCase();
      if (VERDICTS.has(verdict)) {
        const confidence = typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 1;
        const out: Judgment = { verdict: verdict as Judgment['verdict'], confidence };
        if (typeof parsed.rationale === 'string' && parsed.rationale.trim()) out.rationale = parsed.rationale.trim();
        return out;
      }
    } catch {
      // fall through
    }
  }
  const word = /^\W*(supports|contradicts|unrelated)\b/i.exec(body);
  if (word) {
    const conf = /confidence\s*[:=]?\s*(0?\.\d+|1(?:\.0+)?|\d{1,3}%)/i.exec(body);
    let confidence = 1;
    if (conf) confidence = conf[1]!.endsWith('%') ? Number(conf[1]!.slice(0, -1)) / 100 : Number(conf[1]);
    return { verdict: word[1]!.toLowerCase() as Judgment['verdict'], confidence: Math.min(1, Math.max(0, confidence)) };
  }
  return { verdict: 'unknown', confidence: 0 };
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * `check` plus a model judge. Locating a quote proves the words exist, not that they support the claim;
 * the judge closes that gap. Claims whose passages the judge does not find supportive become
 * unsupported, keeping their citation results and the judgment.
 */
export async function checkWithJudge(claims: Claim[] | { claims: Claim[] }, sources: Sources, options: JudgeOptions): Promise<Report> {
  const { judge, concurrency, ...rest } = options;
  const report = check(claims, sources, rest);
  const candidates = report.claims.filter((r) => r.status === 'supported' || r.status === 'partial');
  await pool(candidates, concurrency ?? 4, async (result) => {
    const raw = await judge({ claim: result.claim, passages: passagesOf(result) });
    const judgment = typeof raw === 'string' ? parseVerdict(raw) : raw;
    result.judgment = judgment;
    if (judgment.verdict !== 'supports') {
      result.status = 'unsupported';
      result.note = judgment.verdict === 'unknown' ? 'judge gave no usable verdict' : `judge: ${judgment.verdict}${judgment.rationale ? ` - ${judgment.rationale}` : ''}`;
    }
  });
  return buildReport(report.claims, report.threshold);
}
