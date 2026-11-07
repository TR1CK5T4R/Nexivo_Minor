// Nexivo M3 engine (Phase 4): one block per alert rule, plus how alerts feed the category.
import { describe, expect, it } from 'vitest';
import { detectAnomalies } from '../../src/engine/anomalies.js';
import { assess } from '../../src/engine/index.js';
import { seedParams as params } from '../helpers/scoringParams.js';

const obs = (o = {}) => ({
  day_post_op: 10,
  observed_at: '2026-11-01T09:00:00Z',
  pain: 2,
  // Best mobility and fatigue, so the trend rules only see the parameter a test varies.
  mobility: 10,
  fatigue: 0,
  symptoms: {},
  doses_prescribed: 0,
  doses_taken: 0,
  milestones_due: 0,
  milestones_completed: 0,
  ...o,
});
// Earlier check-ins on consecutive days ending the day before `day`.
const series = (values, key = 'pain', day = 10) =>
  values.map((v, i) => obs({ [key]: v, day_post_op: day - values.length + i }));
const ctx = (o = {}) => ({ expectedRecoveryDays: 42, baseline: null, composite: 90, milestones: [], ...o });
const detect = (history, current, c) => detectAnomalies(history, current, params, ctx(c));
const ofType = (alerts, type) => alerts.filter((a) => a.type === type);

describe('SUDDEN_DETERIORATION (high)', () => {
  it('pain or fatigue up by ≥ 3, or mobility down by ≥ 3, since the previous check-in', () => {
    const pain = ofType(detect([obs({ pain: 2 })], obs({ pain: 5 })), 'SUDDEN_DETERIORATION');
    expect(pain).toMatchObject([
      { parameter: 'pain', severity: 'high', details: { previous: 2, current: 5, change: 3 } },
    ]);
    expect(pain[0].message).toBe('Pain rose from 2/10 to 5/10 since the previous check-in.');
    expect(ofType(detect([obs({ mobility: 7 })], obs({ mobility: 4 })), 'SUDDEN_DETERIORATION')[0]).toMatchObject({
      parameter: 'mobility',
      message: 'Mobility fell from 7/10 to 4/10 since the previous check-in.',
    });
    expect(ofType(detect([obs({ fatigue: 1 })], obs({ fatigue: 4 })), 'SUDDEN_DETERIORATION')[0].parameter).toBe(
      'fatigue',
    );
  });

  it('nothing for a change of 2, or for an improvement, or without a previous check-in', () => {
    expect(ofType(detect([obs({ pain: 2 })], obs({ pain: 4 })), 'SUDDEN_DETERIORATION')).toEqual([]);
    expect(ofType(detect([obs({ pain: 8 })], obs({ pain: 2 })), 'SUDDEN_DETERIORATION')).toEqual([]);
    expect(ofType(detect([], obs({ pain: 9 })), 'SUDDEN_DETERIORATION')).toEqual([]);
  });

  it('a symptom rising to severe (3); not one that was already severe', () => {
    const rose = ofType(
      detect([obs({ symptoms: { fever: 1 } })], obs({ symptoms: { fever: 3 } })),
      'SUDDEN_DETERIORATION',
    );
    expect(rose).toMatchObject([
      { parameter: 'symptoms.fever', severity: 'high', message: 'Fever reported as severe.' },
    ]);
    expect(detect([], obs({ symptoms: { wound_redness: 3 } }))[0].message).toBe('Wound redness reported as severe.');
    const still = detect([obs({ symptoms: { fever: 3 } })], obs({ symptoms: { fever: 3 } }));
    expect(ofType(still, 'SUDDEN_DETERIORATION')).toEqual([]);
  });
});

describe('SCORE_DROP (high)', () => {
  it('baseline − composite ≥ 15', () => {
    expect(ofType(detect([], obs(), { baseline: 80, composite: 65 }), 'SCORE_DROP')).toMatchObject([
      { parameter: null, severity: 'high', details: { drop: 15, threshold: 15 } },
    ]);
    expect(ofType(detect([], obs(), { baseline: 80, composite: 65.1 }), 'SCORE_DROP')).toEqual([]);
    expect(ofType(detect([], obs(), { baseline: null, composite: 10 }), 'SCORE_DROP')).toEqual([]);
  });
});

describe('UNUSUAL_CHANGE (medium)', () => {
  it('|z| ≥ 2 in the worsening direction against the previous 5 check-ins (sd floor 0.5 points)', () => {
    // Pain 3,3,3,3,3 → 7 points each, sd 0 → floor 0.5; pain 4 → 6 points: z = −2.
    const alerts = ofType(detect(series([3, 3, 3, 3, 3]), obs({ pain: 4 })), 'UNUSUAL_CHANGE');
    expect(alerts).toMatchObject([{ parameter: 'pain', severity: 'medium' }]);
    expect(alerts[0].details.z).toBeCloseTo(-2, 10);
  });

  it('needs 5 earlier check-ins', () => {
    expect(ofType(detect(series([3, 3, 3, 3]), obs({ pain: 6 })), 'UNUSUAL_CHANGE')).toEqual([]);
  });

  it('nothing in the improving direction, or within the usual spread', () => {
    expect(ofType(detect(series([3, 3, 3, 3, 3]), obs({ pain: 1 })), 'UNUSUAL_CHANGE')).toEqual([]);
    // Pain 1,5,1,5,3 → mean 7, sd ≈ 1.79; pain 4 → z ≈ −0.56.
    expect(ofType(detect(series([1, 5, 1, 5, 3]), obs({ pain: 4 })), 'UNUSUAL_CHANGE')).toEqual([]);
  });

  it('watches the symptom score and adherence too', () => {
    const history = series([4, 4, 4, 4, 4], 'doses_prescribed').map((o) => ({ ...o, doses_taken: 4 }));
    const alerts = detect(history, obs({ doses_prescribed: 4, doses_taken: 3 }));
    expect(ofType(alerts, 'UNUSUAL_CHANGE').map((a) => a.parameter)).toEqual(['adherence']);
  });
});

describe('NO_IMPROVEMENT (medium)', () => {
  it('slope ≤ 0 over the last 5 check-ins before the expected recovery day', () => {
    const alerts = ofType(detect(series([4, 4, 4, 4]), obs({ pain: 4 })), 'NO_IMPROVEMENT');
    expect(alerts).toMatchObject([{ parameter: 'pain', severity: 'medium', details: { slope_per_day: 0, window: 5 } }]);
  });

  it('nothing while improving, after the expected recovery day, or with fewer than 5 check-ins', () => {
    expect(ofType(detect(series([6, 5, 4, 3]), obs({ pain: 2 })), 'NO_IMPROVEMENT')).toEqual([]);
    expect(
      ofType(detect(series([4, 4, 4, 4], 'pain', 42), obs({ pain: 4, day_post_op: 42 })), 'NO_IMPROVEMENT'),
    ).toEqual([]);
    expect(ofType(detect(series([4, 4, 4]), obs({ pain: 4 })), 'NO_IMPROVEMENT')).toEqual([]);
  });

  it('nothing for a parameter already at its best (no pain, no symptoms, full adherence)', () => {
    const steady = series([0, 0, 0, 0]).map((o) => ({ ...o, mobility: 10, fatigue: 0 }));
    expect(ofType(detect(steady, obs({ pain: 0, mobility: 10, fatigue: 0 })), 'NO_IMPROVEMENT')).toEqual([]);
  });
});

describe('ADHERENCE_DROP (medium / high)', () => {
  const adherence = (taken, prescribed) =>
    ofType(detect([], obs({ doses_taken: taken, doses_prescribed: prescribed })), 'ADHERENCE_DROP');

  it('medium below 80%, high below 50%', () => {
    expect(adherence(3, 4)).toMatchObject([{ severity: 'medium', message: '3 of 4 prescribed doses taken (75%).' }]);
    expect(adherence(2, 4)).toMatchObject([{ severity: 'medium' }]);
    expect(adherence(1, 4)).toMatchObject([{ severity: 'high' }]);
  });

  it('nothing at 80% or above, or when nothing was prescribed', () => {
    expect(adherence(4, 5)).toEqual([]);
    expect(adherence(0, 0)).toEqual([]);
  });
});

describe('MILESTONE_OVERDUE (low)', () => {
  const milestone = (completed_at = null) => ({
    id: 7,
    name: 'Walk 10 minutes without help',
    target_day: 7,
    completed_at,
  });
  const overdue = (day, m) => ofType(detect([], obs({ day_post_op: day }), { milestones: [m] }), 'MILESTONE_OVERDUE');

  it('not completed 3 or more days after its target day', () => {
    expect(overdue(10, milestone())).toMatchObject([
      {
        parameter: 'milestones.7',
        severity: 'low',
        message: 'Milestone "Walk 10 minutes without help" was due on day 7 and is not marked complete.',
      },
    ]);
    expect(overdue(9, milestone())).toEqual([]);
  });

  it('completed before the check-in: nothing; completed after it: still overdue for that check-in', () => {
    expect(overdue(10, milestone('2026-10-30T09:00:00Z'))).toEqual([]);
    expect(overdue(10, milestone('2026-11-02T09:00:00Z'))).toHaveLength(1);
  });
});

describe('assess: alerts feed the category', () => {
  const stable = series([2, 2, 2]);
  const run = (current) => assess(stable, current, params, { expectedRecoveryDays: 42 });

  it('a high alert requires attention even when the score itself looks fine', () => {
    const r = run(obs({ symptoms: { breathlessness: 3 } }));
    expect(r.composite).toBeGreaterThan(80);
    expect(r.alerts.map((a) => a.severity)).toEqual(['high']);
    expect(r.category).toBe('attention');
  });

  it('a medium alert means slower than expected', () => {
    const r = run(obs({ doses_prescribed: 4, doses_taken: 3 }));
    expect(r.alerts.map((a) => [a.type, a.severity])).toEqual([['ADHERENCE_DROP', 'medium']]);
    expect(r.category).toBe('slower');
  });

  it('no alerts, good score: normal', () => {
    expect(run(obs({ pain: 1 }))).toMatchObject({ alerts: [], category: 'normal' });
  });
});
