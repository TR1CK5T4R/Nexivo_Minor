// Nexivo M2 engine (Phase 3): normalization, composite, personal context, category.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scoringParamsSchema } from '../../src/config/scoringConfig.js';
import { seedParams } from '../helpers/scoringParams.js';
import { assess } from '../../src/engine/index.js';
import { normalize } from '../../src/engine/normalize.js';
import { categorize, composite, expectedScore, scoreObservation, slope } from '../../src/engine/score.js';

const params = seedParams;

// An observation where every parameter is at its best (composite 100).
const best = (o = {}) => ({
  day_post_op: 10,
  pain: 0,
  mobility: 10,
  fatigue: 0,
  symptoms: {},
  doses_prescribed: 0,
  doses_taken: 0,
  milestones_due: 0,
  milestones_completed: 0,
  ...o,
});
// All weight on pain, so composite = (10 - pain) × 10: easy to aim at a value.
const painOnly = { ...params, weights: { pain: 1, mobility: 0, fatigue: 0, symptoms: 0, adherence: 0, milestones: 0 } };
const withComposite = (c, day) => best({ pain: (100 - c) / 10, day_post_op: day });

describe('normalize: bounds', () => {
  it('best values → 100 for every parameter', () => {
    expect(normalize(best(), params)).toEqual({
      pain: 100,
      mobility: 100,
      fatigue: 100,
      symptoms: 100,
      adherence: 100,
      milestones: 100,
    });
  });

  it('worst values → 0 for every parameter', () => {
    const symptoms = Object.fromEntries(params.symptoms.map((s) => [s, 3]));
    const worst = best({ pain: 10, mobility: 0, fatigue: 10, symptoms, doses_prescribed: 4, doses_taken: 0 });
    expect(normalize({ ...worst, milestones_due: 2, milestones_completed: 0 }, params)).toEqual({
      pain: 0,
      mobility: 0,
      fatigue: 0,
      symptoms: 0,
      adherence: 0,
      milestones: 0,
    });
  });

  it('adherence and milestones are 100 when nothing is prescribed or due', () => {
    const n = normalize(best({ doses_prescribed: 0, doses_taken: 0, milestones_due: 0 }), params);
    expect(n.adherence).toBe(100);
    expect(n.milestones).toBe(100);
  });

  it('partial values scale linearly; symptoms average over the configured list', () => {
    const n = normalize(
      best({
        pain: 3,
        mobility: 7,
        fatigue: 4,
        doses_prescribed: 4,
        doses_taken: 3,
        milestones_due: 4,
        milestones_completed: 1,
      }),
      params,
    );
    expect(n).toMatchObject({ pain: 70, mobility: 70, fatigue: 60, adherence: 75, milestones: 25 });
    // Two of five symptoms severe: 100 × (1 − 6 / 15) = 60. Symptoms not mentioned count as none.
    expect(normalize(best({ symptoms: { fever: 3, nausea: 3 } }), params).symptoms).toBeCloseTo(60, 10);
  });

  it('never leaves 0-100, even for inconsistent input', () => {
    const n = normalize(
      best({ doses_prescribed: 2, doses_taken: 5, milestones_due: 1, milestones_completed: 3 }),
      params,
    );
    expect(n.adherence).toBe(100);
    expect(n.milestones).toBe(100);
  });
});

describe('composite', () => {
  it('is the weighted sum: 100 for a perfect observation with the default weights', () => {
    expect(composite(normalize(best(), params), params.weights)).toBeCloseTo(100, 10);
  });

  it('applies each weight', () => {
    const n = { pain: 60, mobility: 50, fatigue: 40, symptoms: 100, adherence: 80, milestones: 0 };
    // 15 + 10 + 6 + 15 + 12 + 0
    expect(composite(n, params.weights)).toBeCloseTo(58, 10);
  });
});

describe('config validation (weights and the rest of Section 8)', () => {
  const issues = (p) => scoringParamsSchema.safeParse(p).error?.issues.map((i) => i.path.join('.')) ?? [];

  it('accepts the seeded defaults', () => {
    expect(issues(params)).toEqual([]);
  });

  it('rejects weights that do not sum to 1.0', () => {
    expect(issues({ ...params, weights: { ...params.weights, pain: 0.15 } })).toEqual(['weights']);
  });

  it('rejects a negative, missing or unknown weight', () => {
    expect(issues({ ...params, weights: { ...params.weights, pain: -0.25, mobility: 0.7 } })).toContain('weights.pain');
    const { milestones: _dropped, ...missing } = params.weights;
    expect(issues({ ...params, weights: missing })).toContain('weights.milestones');
    expect(issues({ ...params, weights: { ...params.weights, mood: 0 } })).toContain('weights');
  });

  it('rejects unknown keys and inconsistent thresholds', () => {
    expect(issues({ ...params, windw_k: 5 })).toEqual(['']);
    expect(issues({ ...params, adherence_high: 0.9 })).toEqual(['adherence_high']);
    expect(issues({ ...params, limited_history_bands: { attention_below: 70, slower_below: 60 } })).toEqual([
      'limited_history_bands',
    ]);
  });
});

describe('expectedScore', () => {
  it('rises linearly from expected_start to target, then stays flat', () => {
    expect(expectedScore(0, params, 42)).toBe(40);
    expect(expectedScore(21, params, 42)).toBeCloseTo(62.5, 10);
    expect(expectedScore(42, params, 42)).toBe(85);
    expect(expectedScore(90, params, 42)).toBe(85);
  });
});

describe('slope', () => {
  it('is the least-squares slope', () => {
    expect(
      slope([
        { x: 0, y: 10 },
        { x: 1, y: 12 },
        { x: 2, y: 14 },
      ]),
    ).toBeCloseTo(2, 10);
    expect(
      slope([
        { x: 1, y: 50 },
        { x: 2, y: 60 },
        { x: 3, y: 52 },
      ]),
    ).toBeCloseTo(1, 10);
  });

  it('is null without a measurable trend', () => {
    expect(slope([{ x: 3, y: 50 }])).toBeNull();
    expect(
      slope([
        { x: 3, y: 50 },
        { x: 3, y: 70 },
      ]),
    ).toBeNull();
  });
});

describe('categorize: each rule', () => {
  const base = {
    composite: 80,
    baseline: 80,
    slope: 1,
    expected: 70,
    day: 20,
    expectedRecoveryDays: 42,
    limitedHistory: false,
  };
  const cat = (overrides) => categorize({ ...base, ...overrides }, params);

  it('normal when nothing matches', () => {
    expect(cat({})).toBe('normal');
  });

  it('limited-history mode uses only the fixed bands (40 / 60)', () => {
    const limited = (c) =>
      cat({ limitedHistory: true, composite: c, baseline: 100, slope: -5, alertSeverities: ['high'] });
    expect(limited(39.9)).toBe('attention');
    expect(limited(40)).toBe('slower');
    expect(limited(59.9)).toBe('slower');
    expect(limited(60)).toBe('normal');
  });

  it('requires attention: a high-severity alert', () => {
    expect(cat({ alertSeverities: ['high'] })).toBe('attention');
  });

  it('requires attention: baseline − C ≥ 15', () => {
    expect(cat({ baseline: 95 })).toBe('attention');
    expect(cat({ baseline: 94.9 })).toBe('normal');
  });

  it('requires attention: C < 40', () => {
    expect(cat({ composite: 39.9, baseline: 45, expected: 40 })).toBe('attention');
    expect(cat({ composite: 40, baseline: 45, expected: 40 })).toBe('normal');
  });

  it('slower than expected: C < E − 10', () => {
    expect(cat({ expected: 90.1 })).toBe('slower');
    expect(cat({ expected: 90 })).toBe('normal');
  });

  it('slower than expected: slope < 0.5/day while below target and before the expected recovery day', () => {
    expect(cat({ slope: 0.4 })).toBe('slower');
    expect(cat({ slope: 0.5 })).toBe('normal');
    expect(cat({ slope: 0.4, composite: 85, baseline: 85 })).toBe('normal');
    expect(cat({ slope: 0.4, day: 42 })).toBe('normal');
    expect(cat({ slope: null })).toBe('normal');
  });

  it('slower than expected: a medium-severity alert (a low one changes nothing)', () => {
    expect(cat({ alertSeverities: ['medium'] })).toBe('slower');
    expect(cat({ alertSeverities: ['low'] })).toBe('normal');
  });

  it('the first matching rule wins: attention beats slower', () => {
    expect(cat({ alertSeverities: ['high', 'medium'], slope: 0 })).toBe('attention');
  });
});

describe('scoreObservation', () => {
  const ctx = { expectedRecoveryDays: 42 };

  it('limited-history mode with fewer than min_history (3) earlier observations', () => {
    const r = assess([withComposite(70, 1), withComposite(80, 2)], withComposite(50, 3), painOnly, ctx);
    expect(r.limited_history).toBe(true);
    expect(r.category).toBe('slower'); // 50 is in the 40-60 band; the drop and the pain alert are not used yet
    expect(r.baseline).toBeCloseTo(75, 10);
  });

  it('no baseline without history', () => {
    const r = assess([], withComposite(90, 0), painOnly, ctx);
    expect(r).toMatchObject({ baseline: null, slope: null, limited_history: true, category: 'normal' });
  });

  it('baseline is the mean of the previous k (5) composites only', () => {
    const history = [10, 90, 60, 70, 80, 90, 100].map((c, i) => withComposite(c, i + 1));
    const r = scoreObservation(history, withComposite(85, 8), painOnly, ctx);
    expect(r.baseline).toBeCloseTo((60 + 70 + 80 + 90 + 100) / 5, 10);
    expect(r.limited_history).toBe(false);
  });

  it('slope covers the last k observations including the current one', () => {
    const history = [100, 0, 50, 52, 54, 56].map((c, i) => withComposite(c, i + 1));
    const r = scoreObservation(history, withComposite(58, 7), painOnly, ctx);
    expect(r.slope).toBeCloseTo(2, 10); // days 3-7: 50, 52, 54, 56, 58
  });

  it('a steady drop from a good baseline requires attention once history is long enough', () => {
    const history = [80, 82, 84].map((c, i) => withComposite(c, i + 10));
    const r = assess(history, withComposite(60, 13), painOnly, ctx);
    expect(r.limited_history).toBe(false);
    expect(r.category).toBe('attention'); // baseline 82 − 60 = 22 ≥ 15
  });

  it('records E(day) for the current day', () => {
    expect(scoreObservation([], withComposite(90, 21), painOnly, ctx).expected).toBeCloseTo(62.5, 10);
  });
});

describe('src/engine is pure', () => {
  it('imports only other engine modules (no database, HTTP or config loading)', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = new URL('../../src/engine/', import.meta.url);
    for (const file of readdirSync(dir)) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
      expect(
        imports.filter((p) => !p.startsWith('./')),
        file,
      ).toEqual([]);
    }
  });
});
