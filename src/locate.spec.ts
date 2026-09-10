import { editDistance, locate } from './locate.js';

const text = `The council approved the plan on Tuesday. “We expect construction to begin in March,” said the mayor.
The plan was first proposed in 2019. The council approved the plan on Tuesday after a short debate.`;

function slice(m: { start: number; end: number } | null) {
  return m ? text.slice(m.start, m.end) : null;
}

describe('locate', () => {
  it('finds an exact quote', () => {
    const m = locate('first proposed in 2019', text)!;
    expect(m).toMatchObject({ method: 'exact', score: 1 });
    expect(slice(m)).toBe('first proposed in 2019');
    expect(m.text).toBe('first proposed in 2019');
  });

  it('prefers the occurrence nearest to `near`', () => {
    const first = locate('The council approved the plan', text)!;
    const second = locate('The council approved the plan', text, { near: 150 })!;
    expect(first.start).toBe(0);
    expect(second.start).toBeGreaterThan(100);
  });

  it('matches after normalization and reports original offsets', () => {
    const m = locate('"we expect construction to begin in march," said the Mayor', text)!;
    expect(m.method).toBe('normalized');
    expect(slice(m)).toBe('“We expect construction to begin in March,” said the mayor');
    const spaced = locate('plan   was\nfirst proposed', text)!;
    expect(spaced.method).toBe('normalized');
    expect(slice(spaced)).toBe('plan was first proposed');
  });

  it('matches fuzzily when a word changed, went missing, or was added', () => {
    const changed = locate('We expect construction to start in March', text)!;
    expect(changed.method).toBe('fuzzy');
    expect(slice(changed)).toBe('We expect construction to begin in March');
    expect(changed.score).toBeCloseTo(1 - 1 / 7, 2);

    const missing = locate('We expect construction begin in March', text)!;
    expect(missing.method).toBe('fuzzy');
    expect(slice(missing)).toBe('We expect construction to begin in March');

    const added = locate('the plan was first officially proposed in 2019', text)!;
    expect(added.method).toBe('fuzzy');
    expect(slice(added)).toBe('The plan was first proposed in 2019');
    expect(added.score).toBeCloseTo(1 - 1 / 8, 2);
  });

  it('uses `near` to break fuzzy ties and respects minScore, slack and fuzzy:false', () => {
    const early = locate('The council approved the plans on Tuesday', text)!;
    const late = locate('The council approved the plans on Tuesday', text, { near: 190 })!;
    expect(early.start).toBe(0);
    expect(late.start).toBeGreaterThan(100);
    expect(locate('We expect construction to start in March', text, { minScore: 0.95 })).toBeNull();
    expect(locate('We expect construction to start in March', text, { fuzzy: false })).toBeNull();
    expect(locate('We construction March', text, { slack: 0 })).toBeNull();
  });

  it('returns null for text that is not there, empty quotes, or empty text', () => {
    expect(locate('the budget was rejected outright', text)).toBeNull();
    expect(locate('   ', text)).toBeNull();
    expect(locate('plan', '')).toBeNull();
    expect(locate('!!!', text)).toBeNull();
    expect(locate('xyz', '...')).toBeNull();
  });

  it('editDistance is a word-level Levenshtein distance', () => {
    expect(editDistance([], ['a'])).toBe(1);
    expect(editDistance(['a', 'b'], [])).toBe(2);
    expect(editDistance(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1);
    expect(editDistance(['a', 'b', 'c'], ['a', 'c'])).toBe(1);
    expect(editDistance(['a', 'b'], ['a', 'b'])).toBe(0);
  });
});
