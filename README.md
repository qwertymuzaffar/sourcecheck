# sourcecheck

Check that every claim an LLM makes points at a real passage in your sources. TypeScript, zero dependencies, ESM and CommonJS, Node 18+.

A model that cites is not a model that is right. Quotes get paraphrased, offsets drift after a re-chunk, source labels get mixed up, and a confident sentence arrives with no citation at all. sourcecheck is the deterministic half of grounding: give it the source texts and the model's claims with citations, and it finds each quoted passage (exactly, after normalization, or fuzzily), reports where it is, grades every claim, and tells you whether the output as a whole clears your bar. For the other half, whether a passage actually supports the claim, plug in a model judge.

```
sources + claims ──> locate each quote ──> supported / partial / unsupported / uncited ──> coverage ──> pass or fail
                          │                                                                   │
                  exact → normalized → fuzzy                                          Markdown report
```

## Install

```sh
npm install sourcecheck
```

## Quick start

```ts
import OpenAI from 'openai';
import { citationInstructions, parseClaims, check, renderReport } from 'sourcecheck';

const sources = [
  { id: 'deck', title: 'Pitch deck', text: deckText },
  { id: 'sheet', title: 'Fact sheet', text: sheetText },
];

const openai = new OpenAI();
const res = await openai.chat.completions.create({
  model: 'gpt-4.1-mini',
  messages: [
    { role: 'system', content: 'Summarize the strategy for an insurance investment committee.' },
    { role: 'user', content: citationInstructions(sources) },
  ],
});

const claims = parseClaims(res.choices[0]!.message.content!, sources);
const report = check(claims, sources, { threshold: { coverage: 0.9 } });

console.log(renderReport(report));
if (!report.pass) throw new Error(`only ${report.summary.coverage * 100}% of claims are grounded`);
```

`citationInstructions` lists the sources with labels and tells the model to cite like `[S1: "exact words"]`. `parseClaims` turns the reply back into claims. `check` resolves every citation and grades. `renderReport` prints:

```md
# sourcecheck report

- Claims: 6 - supported 5, partial 0, unsupported 1, uncited 0
- Citations resolved: 6 of 7
- Coverage: 83% (threshold 90%) - FAIL

| # | Status | Claim | Evidence |
|---|---|---|---|
| 1 | supported | The fund targets a net return of 8-10%. | deck 31-58 exact: "net return of 8-10%" |
| 2 | unsupported | The strategy is rated AAA. | sheet not-found |
```

## Locating quotes

`locate(quote, text)` is the core. It tries three things in order and always returns offsets into the original text, so `text.slice(match.start, match.end)` is the passage:

| Method | What it tolerates | Score |
|---|---|---|
| `exact` | Nothing | 1 |
| `normalized` | Case, whitespace and line breaks, curly quotes, dashes, ellipses, ligatures and other Unicode compatibility forms | 1 |
| `fuzzy` | Changed, missing or extra words, judged by word-level edit distance over a sliding window | Similarity, 0.8 or higher by default |

```ts
import { locate } from 'sourcecheck';

locate('"we expect construction to begin in march," said the mayor', text);
// { start: 42, end: 100, text: '“We expect construction to begin in March,” said the mayor', method: 'normalized', score: 1 }

locate('We expect construction to start in March', text);
// { ..., method: 'fuzzy', score: 0.857 }

locate('The council approved the plan', text, { near: 150 }); // the occurrence closest to offset 150
locate(quote, text, { fuzzy: false });                        // exact and normalized only
locate(quote, text, { minScore: 0.9, slack: 2 });             // stricter similarity, fewer extra or missing words
```

The fuzzy floor is deliberate. A four-word quote with one extra word scores 0.75 and fails; a ten-word quote with one wrong word scores 0.9 and passes. Short quotes have to be exact, which is what you want from a citation.

## Citations, claims and grades

A citation names a source and carries a quote, offsets, or both:

```ts
{ sourceId: 'deck', quote: 'net return of 8-10%' }
{ sourceId: 'deck', start: 31, end: 58 }
{ sourceId: 'deck', quote: 'net return of 8-10%', start: 31, end: 58 }
```

`verifyCitation` resolves one and returns a status:

| Status | Meaning |
|---|---|
| `exact`, `normalized`, `fuzzy` | The quote was found by that method |
| `relocated` | The offsets pointed at other text; the quote was found elsewhere, and the passage says where |
| `not-found` | The quote is not in the source |
| `out-of-range` | Offsets fall outside the source and there is no quote to search for |
| `missing-source` | No source has that id |
| `empty` | Neither a quote nor usable offsets |

`verifyClaim` resolves all of a claim's citations and grades it `supported` (every citation resolved), `partial` (some), `unsupported` (none) or `uncited` (no citations). `check` does that for a list and adds a summary and a pass flag:

```ts
const report = check(claims, sources, {
  threshold: { coverage: 0.9, allowPartial: true }, // share of claims that must be covered; partial counts here
  minScore: 0.85,                                    // fuzzy floor, passed through to locate
});
report.summary; // { claims, supported, partial, unsupported, uncited, citations, citationsOk, coverage }
report.pass;    // coverage >= threshold.coverage
```

Sources can be an array, a `Map`, or a plain object keyed by id.

## Structured extraction

When the model fills a schema rather than writing prose, each field should carry its evidence. `checkFields` resolves the citations and then checks that the value itself appears in the cited text, so a field that quotes a real passage but reports a number that is not in it is caught:

```ts
import { checkFields, renderReport } from 'sourcecheck';

const report = checkFields(
  {
    targetReturn: { value: '8-10%', citations: [{ sourceId: 'deck', quote: 'targets a net return of 8-10%' }] },
    minimum: { value: 25000000, citations: [{ sourceId: 'deck', quote: 'Minimum commitment is $25,000,000.' }] },
    rating: { value: 'AAA', citations: [{ sourceId: 'sheet', quote: 'rated A- by Fitch' }] },
  },
  sources,
);

report.fields[2]; // { field: 'rating', status: 'partial', valueFound: false, note: 'the cited passage resolves but does not contain the value' }
report.summary.valueMismatches; // 1
```

Values are compared after normalization; numbers also match with currency symbols, commas and percent signs stripped, so `25000000` is found in `$25,000,000`. Arrays and objects must have every leaf found.

## A model judge

Finding the words proves the words exist. Whether they support the claim is a judgment, and `checkWithJudge` makes room for one. It runs `check`, then asks your function about every claim that has passages; claims the judge does not mark `supports` become `unsupported`, keeping their citation results and the judgment.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { checkWithJudge, judgePrompt } from 'sourcecheck';

const anthropic = new Anthropic();

const report = await checkWithJudge(claims, sources, {
  concurrency: 4,
  judge: async (input) => {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: judgePrompt(input) }],
    });
    return res.content[0]?.type === 'text' ? res.content[0].text : 'unknown';
  },
});
```

The judge may return a string, parsed by `parseVerdict` (JSON `{"verdict", "confidence", "rationale"}` or a leading `supports` / `contradicts` / `unrelated`), or a `Judgment` object.

## Prompts and parsing

- `citationInstructions(sources, { style: 'inline' | 'json', includeText })` lists sources as `[S1]`, `[S2]` (or a source's own `label`) and states the citing rule. Inline asks for `[S1: "quote"]` markers and `[uncited]` for unsupported sentences; JSON asks for `{"claims": [{"text", "citations": [{"source", "quote"}]}]}`.
- `parseClaims(reply, sources)` reads either shape, maps labels back to source ids, keeps unknown labels as-is so they show up as `missing-source`, and splits prose into sentences with `Intl.Segmenter` when it is available.
- `toFootnotes(claims, sources)` renders claims as Markdown with numbered footnotes that link to the sources.

## With chunklet

If the sources are chunks from [chunklet](https://www.npmjs.com/package/chunklet), use the chunk index as the source id and add the chunk's start to a passage's offsets to get positions in the original document:

```ts
import { chunkText } from 'chunklet';

const chunks = chunkText(document, { maxTokens: 400 });
const sources = chunks.map((c, i) => ({ id: `c${i}`, text: c.text }));
const report = check(claims, sources);
for (const claim of report.claims) {
  for (const c of claim.citations) {
    if (c.passage) {
      const chunk = chunks[Number(c.passage.sourceId.slice(1))]!;
      console.log(chunk.start + c.passage.start, chunk.start + c.passage.end); // offsets in `document`
    }
  }
}
```

## Design notes and limitations

- Everything except the judge is deterministic and runs without a model, so it belongs in tests and CI. Put `check` on a fixture of past outputs and fail the build when coverage drops.
- Fuzzy search is a sliding window over words with a word-level edit distance, roughly linear in the source length for a fixed quote. Very long sources with very long quotes get slow; pass chunks as sources instead of a whole book.
- Normalization folds case, whitespace, common typographic quotes and dashes, ellipses and NFKC compatibility forms. It does not stem, translate, or expand abbreviations; `US` and `United States` are different words to the fuzzy matcher.
- A resolved quote is evidence that the words exist, not that they mean what the claim says. Use the judge for that, or a human review queue.
- `checkFields` matches values as text. It does not know that `3.5 years` and `42 months` are the same.
- Sentence splitting in `parseClaims` follows `Intl.Segmenter`; a claim that spans two sentences becomes two claims, and a marker placed mid-sentence is attributed to that sentence.

## Alternatives

Evaluation frameworks such as promptfoo, ragas and DeepEval score groundedness with a model judge as part of a test suite, mostly in Python. sourcecheck is the small library underneath: deterministic quote location with offsets, field-level checks for extraction, and a judge hook, usable inside the application at request time as well as in tests.

## License

MIT
