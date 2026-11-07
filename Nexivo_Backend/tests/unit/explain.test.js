// Nexivo M4 engine (Phase 5): contributions, explanation text, recommendation.
import { describe, expect, it } from 'vitest';
import { assess } from '../../src/engine/index.js';
import { recommend, topFactor } from '../../src/engine/recommend.js';
import { seedParams as params } from '../helpers/scoringParams.js';

const best = (o = {}) => ({
  day_post_op: 10,
  observed_at: '2026-11-01T09:00:00Z',
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
const history = (n, o) => Array.from({ length: n }, (_, i) => best({ ...o, day_post_op: 10 - n + i }));
const run = (h, current, p = params) => assess(h, current, p, { expectedRecoveryDays: 42 });
const sum = (factors) => factors.reduce((t, f) => t + f.contribution, 0);

// Small seeded PRNG (mulberry32) so the property test is reproducible.
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('contributions: Σ contribᵢ = C − B (the explanation matches the score)', () => {
  it('holds within 0.01 for 300 random patient histories, and C − 100 in limited-history mode', () => {
    const random = rng(42);
    const int = (max) => Math.floor(random() * (max + 1));
    const randomObs = (day) => {
      const prescribed = int(4);
      const due = int(3);
      return best({
        day_post_op: day,
        pain: int(10),
        mobility: int(10),
        fatigue: int(10),
        symptoms: Object.fromEntries(params.symptoms.map((s) => [s, int(3)])),
        doses_prescribed: prescribed,
        doses_taken: int(prescribed),
        milestones_due: due,
        milestones_completed: int(due),
      });
    };
    let checkedFull = 0;
    for (let i = 0; i < 300; i += 1) {
      const length = int(10);
      const h = Array.from({ length }, (_, d) => randomObs(d));
      const r = run(h, randomObs(length));
      if (r.limited_history) {
        expect(Math.abs(sum(r.contributions) - (r.composite - 100))).toBeLessThan(0.01);
      } else {
        expect(Math.abs(sum(r.contributions) - (r.composite - r.baseline))).toBeLessThan(0.01);
        checkedFull += 1;
      }
    }
    expect(checkedFull).toBeGreaterThan(100); // most histories were long enough to have a baseline
  });

  it('stores {parameter, raw_value, normalized, baseline, contribution}, most negative first', () => {
    const r = run(
      history(4, { pain: 3, doses_prescribed: 4, doses_taken: 4 }),
      best({ pain: 7, symptoms: { fever: 2, nausea: 1 }, doses_prescribed: 4, doses_taken: 2 }),
    );
    expect(r.contributions.map((f) => f.parameter)).toEqual([
      'pain', // 0.25 × (30 − 70) = −10
      'adherence', // 0.15 × (50 − 100) = −7.5
      'symptoms', // 0.15 × (80 − 100) = −3
      'mobility',
      'fatigue',
      'milestones',
    ]);
    expect(r.contributions[0]).toEqual({
      parameter: 'pain',
      raw_value: 7,
      normalized: 30,
      baseline: 70,
      contribution: -10,
    });
    expect(r.contributions.find((f) => f.parameter === 'adherence').raw_value).toBe(0.5);
    expect(r.contributions.find((f) => f.parameter === 'symptoms').raw_value).toBe(3); // total severity
    expect(r.contributions.find((f) => f.parameter === 'milestones').raw_value).toBeNull(); // none due
  });
});

describe('explanation text (templates from the config)', () => {
  it("reproduces the spec's example sentence", () => {
    const r = run(history(4, { pain: 3 }), best({ pain: 7 }));
    expect(r.explanation).toBe('Pain rose to 7/10 (usual for this patient: 3/10), lowering the score by 10 points.');
  });

  it('names the top 3 negative factors, then up to 2 positive ones', () => {
    const usual = { pain: 2, mobility: 8, fatigue: 2, symptoms: { fever: 1 }, doses_prescribed: 4, doses_taken: 2 };
    const today = {
      pain: 6, // −10
      mobility: 4, // −8
      fatigue: 5, // −4.5
      symptoms: { fever: 2 }, // −1, the 4th negative: left out
      doses_prescribed: 4,
      doses_taken: 4, // +7.5
      milestones_due: 1,
      milestones_completed: 1, // +0: no sentence
    };
    const r = run(history(4, usual), best(today));
    expect(r.explanation.split('. ').length).toBe(4);
    expect(r.explanation).toBe(
      'Pain rose to 6/10 (usual for this patient: 2/10), lowering the score by 10 points. ' +
        'Mobility fell to 4/10 (usual for this patient: 8/10), lowering the score by 8 points. ' +
        'Fatigue rose to 5/10 (usual for this patient: 2/10), lowering the score by 4.5 points. ' +
        'Medication adherence improved to 100% (usual for this patient: 50%), raising the score by 7.5 points.',
    );
  });

  it('limited-history mode explains the shortfall from the best possible value', () => {
    const r = run([], best({ pain: 7 }));
    expect(r.limited_history).toBe(true);
    expect(r.contributions[0]).toMatchObject({ parameter: 'pain', baseline: null, contribution: -17.5 });
    expect(r.explanation).toBe('Pain at 7/10 is lowering the score by 17.5 points from the best possible.');
  });

  it('steady and at-best wording when no factor moves the score', () => {
    expect(run(history(4, { pain: 3 }), best({ pain: 3 })).explanation).toBe(
      "All parameters are close to this patient's usual values.",
    );
    expect(run([], best()).explanation).toBe('All parameters are at their best values.');
  });

  it('follows the config: a changed template changes the text', () => {
    const custom = {
      ...params,
      explanation_templates: {
        ...params.explanation_templates,
        below_baseline: '{label}: {value} vs {usual} (−{points}).',
      },
    };
    expect(run(history(4, { pain: 3 }), best({ pain: 7 }), custom).explanation).toBe('Pain: 7/10 vs 3/10 (−10).');
  });
});

describe('recommendation (category + top factor)', () => {
  it('requires attention: prompt follow-up naming the main driver', () => {
    const r = run(history(4, { pain: 1 }), best({ pain: 8 }));
    expect(r.category).toBe('attention');
    expect(r.recommendation).toBe('Recommend prompt professional follow-up. Main driver: Pain.');
  });

  it.each([
    ['pain', 'pain management'],
    ['mobility', 'mobility/physiotherapy plan'],
    ['fatigue', 'fatigue and rest'],
    ['symptoms', 'symptom review'],
    ['adherence', 'medication adherence'],
    ['milestones', 'recovery plan'],
  ])('slower than expected, top factor %s → reassess %s', (parameter, area) => {
    const factors = [{ parameter, contribution: -5 }];
    expect(recommend('slower', factors, [], params)).toBe(`Consider reassessment of ${area} at the next review.`);
  });

  it('slower end to end: an adherence drop (medium alert) names medication adherence', () => {
    const r = run(history(4, { doses_prescribed: 4, doses_taken: 4 }), best({ doses_prescribed: 4, doses_taken: 3 }));
    expect(r.category).toBe('slower');
    expect(r.recommendation).toBe('Consider reassessment of medication adherence at the next review.');
  });

  it('normal: routine monitoring', () => {
    // (Pain held at 1 would be "no improvement", a medium alert: slower.)
    const r = run(history(4), best());
    expect(r.category).toBe('normal');
    expect(r.recommendation).toBe(
      "Recovery is on track relative to this patient's baseline. Continue routine monitoring.",
    );
  });

  it('without a score shortfall, the most severe alert names the driver; otherwise the fallback text', () => {
    const flat = [{ parameter: 'pain', contribution: 0 }];
    expect(
      topFactor(
        flat,
        [
          { severity: 'medium', parameter: 'adherence' },
          { severity: 'high', parameter: 'symptoms.fever' },
        ],
        params,
      ),
    ).toBe('symptoms');
    expect(topFactor(flat, [{ severity: 'low', parameter: 'milestones.4' }], params)).toBeNull();
    expect(topFactor(flat, [{ severity: 'high', parameter: null }], params)).toBeNull();
    expect(recommend('attention', flat, [], params)).toBe(
      'Recommend prompt professional follow-up. Main driver: overall recovery trend.',
    );
  });
});
