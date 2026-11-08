// Nexivo M6 (Phase 7): baseline engine, CSV import, synthetic generator, replay, metrics.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { baselineRuleSet, evaluateBaseline } from '../../src/engine/baselineRules.js';
import { engines } from '../../src/engine/index.js';
import { CsvError, parseResearchCsv } from '../../src/research/csv.js';
import { generateDataset } from '../../src/research/generator.js';
import { binaryMetrics, evaluatePredictions, splitPatients, threeClassMetrics } from '../../src/research/metrics.js';
import { replay } from '../../src/research/replay.js';
import { evaluateParameter } from '../../src/services/riskEngine.js';
import { seedParams as params } from '../helpers/scoringParams.js';

const obs = (o = {}) => ({
  day_post_op: 10,
  pain: 2,
  mobility: 8,
  fatigue: 2,
  symptoms: {},
  doses_prescribed: 0,
  doses_taken: 0,
  milestones_due: 0,
  milestones_completed: 0,
  ...o,
});
const flagged = (o, history = []) => evaluateBaseline(history, obs(o), params).flagged;

describe('baseline engine: the fixed thresholds, through ReviveCare’s rule evaluator', () => {
  it('pain ≥ 7, mobility ≤ 3, adherence < 80%, any severe symptom', () => {
    expect([flagged({ pain: 7 }), flagged({ pain: 6 })]).toEqual([true, false]);
    expect([flagged({ mobility: 3 }), flagged({ mobility: 4 })]).toEqual([true, false]);
    expect([
      flagged({ doses_prescribed: 100, doses_taken: 79 }),
      flagged({ doses_prescribed: 5, doses_taken: 4 }),
    ]).toEqual([true, false]);
    expect(flagged({ doses_prescribed: 0, doses_taken: 0 })).toBe(false); // nothing prescribed = adherent
    expect([flagged({ symptoms: { fever: 3 } }), flagged({ symptoms: { fever: 2, nausea: 2 } })]).toEqual([
      true,
      false,
    ]);
  });

  it('is the same for everyone and ignores history; two classes only', () => {
    const alarming = [obs({ pain: 1 }), obs({ pain: 1 }), obs({ pain: 1 })];
    expect(evaluateBaseline(alarming, obs({ pain: 6 }), params)).toMatchObject({ category: 'normal', flagged: false });
    expect(evaluateBaseline([], obs({ pain: 7 }), params)).toMatchObject({ category: 'attention', flagged: true });
    expect(evaluateBaseline([], obs({ pain: 7 }), params).reasons).toEqual(['B-PAIN: pain 7 gte 7']);
  });

  it("calls ReviveCare's evaluateParameter itself, with a rule set in riskRules.js shape", () => {
    const source = readFileSync(new URL('../../src/engine/baselineRules.js', import.meta.url), 'utf8');
    expect(source).toContain("import { evaluateParameter } from '../services/riskEngine.js';");
    const rules = baselineRuleSet(params.baseline_rules);
    expect(evaluateParameter('pain', 7, rules).flags).toEqual(['alert_doctor']);
    expect(evaluateParameter('adherence', undefined, rules).value).toBe(1); // whenMissing
  });

  it('the common interface returns {category, flagged} for both engines', () => {
    expect(Object.keys(engines.baseline([], obs(), params)).sort()).toEqual(['category', 'flagged']);
    expect(
      engines.nexivo(
        [],
        obs({
          pain: 9,
          mobility: 1,
          fatigue: 9,
          symptoms: Object.fromEntries(params.symptoms.map((x) => [x, 3])) /* score 31 < 40 */,
        }),
        params,
      ),
    ).toEqual({
      category: 'attention',
      flagged: true,
    });
  });
});

describe('parseResearchCsv (strict)', () => {
  const header =
    'patient_id,day_post_op,pain,mobility,fatigue,fever,doses_prescribed,doses_taken,milestones_completed,milestones_due,label';
  const parse = (text) => parseResearchCsv(text, params.symptoms);
  const error = (text) => {
    try {
      parse(text);
    } catch (err) {
      expect(err).toBeInstanceOf(CsvError);
      return err.message;
    }
    throw new Error('expected a CsvError');
  };

  it('parses rows; symptom columns optional and in any order; BOM, CRLF and blank lines are fine', () => {
    const rows = parse(`\uFEFF${header}\r\nP1,1,6,3,5,0,3,3,0,0,normal\r\n\r\nP1, 2 ,5,4,5,2,3,2,0,0,attention\r\n`);
    expect(rows).toEqual([
      {
        patient_key: 'P1',
        day_post_op: 1,
        pain: 6,
        mobility: 3,
        fatigue: 5,
        doses_prescribed: 3,
        doses_taken: 3,
        milestones_completed: 0,
        milestones_due: 0,
        symptoms: { fever: 0 },
        label: 'normal',
      },
      expect.objectContaining({ day_post_op: 2, symptoms: { fever: 2 }, label: 'attention' }),
    ]);
  });

  it.each([
    ['a missing column', 'patient_id,day_post_op\nP1,1', 'line 1: missing column "pain"'],
    ['an unknown column', `${header},mood\nP1,1,6,3,5,0,3,3,0,0,normal,2`, 'line 1: unknown column "mood"'],
    ['a repeated column', `${header},fever\nP1,1,6,3,5,0,3,3,0,0,normal,1`, 'line 1: column "fever" appears twice'],
    ['a quoted field', `${header}\n"P1",1,6,3,5,0,3,3,0,0,normal`, 'line 2: quoted fields are not supported'],
    ['a short row', `${header}\nP1,1,6`, 'line 2: expected 11 fields, got 3'],
    [
      'pain out of range',
      `${header}\nP1,1,11,3,5,0,3,3,0,0,normal`,
      'line 2: pain must be a whole number from 0 to 10 (got "11")',
    ],
    ['a decimal', `${header}\nP1,1,6,3.5,5,0,3,3,0,0,normal`, 'line 2: mobility must be a whole number'],
    [
      'a severity above 3',
      `${header}\nP1,1,6,3,5,4,3,3,0,0,normal`,
      'line 2: fever must be a whole number from 0 to 3',
    ],
    [
      'an unknown label',
      `${header}\nP1,1,6,3,5,0,3,3,0,0,bad`,
      'line 2: label must be one of normal, slower, attention',
    ],
    ['more doses taken than prescribed', `${header}\nP1,1,6,3,5,0,3,4,0,0,normal`, 'line 2: doses_taken is more than'],
    [
      'more milestones done than due',
      `${header}\nP1,1,6,3,5,0,3,3,2,1,normal`,
      'line 2: milestones_completed is more than',
    ],
    ['no data rows', `${header}\n\n`, 'no data rows'],
  ])('rejects %s', (_case, text, message) => {
    expect(error(text)).toContain(message);
  });
});

describe('generateDataset (seeded)', () => {
  const rows = generateDataset(42, {}, params.symptoms);

  it('the same seed gives identical rows; another seed gives different ones', () => {
    expect(generateDataset(42, {}, params.symptoms)).toEqual(rows);
    expect(generateDataset(43, {}, params.symptoms)).not.toEqual(rows);
  });

  it('every row is valid input (round-trips through the strict CSV parser)', () => {
    const columns = [
      'patient_id',
      'day_post_op',
      'pain',
      'mobility',
      'fatigue',
      ...params.symptoms,
      'doses_prescribed',
      'doses_taken',
      'milestones_completed',
      'milestones_due',
      'label',
    ];
    const csv = [
      columns.join(','),
      ...rows.map((r) => columns.map((c) => (c === 'patient_id' ? r.patient_key : (r.symptoms[c] ?? r[c]))).join(',')),
    ].join('\n');
    expect(parseResearchCsv(csv, params.symptoms)).toEqual(rows);
  });

  it('has all three classes, missed check-ins, and attention only after a deterioration starts', () => {
    expect(new Set(rows.map((r) => r.label))).toEqual(new Set(['normal', 'slower', 'attention']));
    expect(new Set(rows.map((r) => r.patient_key)).size).toBe(60);
    expect(rows.length).toBeLessThan(60 * 42); // some days skipped
    const byPatient = Object.groupBy(rows, (r) => r.patient_key);
    for (const list of Object.values(byPatient)) {
      const first = list.findIndex((r) => r.label === 'attention');
      if (first >= 0) expect(list.slice(first).every((r) => r.label === 'attention')).toBe(true);
    }
  });
});

describe('replay: no look-ahead', () => {
  it('changing later observations never changes earlier predictions', () => {
    const rows = generateDataset(7, { patients: 12 }, params.symptoms);
    const original = replay(rows, params);
    // Make every patient's last check-in extreme; only those predictions may change.
    const lastIndex = new Map(rows.map((r, i) => [r.patient_key, i]));
    const mutated = rows.map((r, i) =>
      lastIndex.get(r.patient_key) === i ? { ...r, pain: 10, mobility: 0, fatigue: 10 } : r,
    );
    const changed = replay(mutated, params);
    const isLast = (p, i, list) => i === list.length - 1 || list[i + 1].patient_key !== p.patient_key;
    original.forEach((p, i) => {
      if (!isLast(p, i, original)) expect(changed[i]).toEqual(p);
    });
  });

  it('orders each patient by day whatever the file order', () => {
    const rows = [obs({ day_post_op: 3, label: 'normal' }), obs({ day_post_op: 1, label: 'normal' })].map((r) => ({
      ...r,
      patient_key: 'A',
    }));
    expect(replay(rows, params).map((p) => p.day_post_op)).toEqual([1, 3]);
  });
});

describe('metrics (positive class: attention)', () => {
  const pred = (label, baseline, nexivo) => ({
    patient_key: label === 'attention' ? 'P1' : 'P2',
    label,
    baseline: { flagged: baseline === 'attention', category: baseline },
    nexivo: { flagged: nexivo === 'attention', category: nexivo },
  });
  const predictions = [
    pred('attention', 'attention', 'attention'), // tp / tp
    pred('attention', 'normal', 'slower'), // fn / fn
    pred('normal', 'attention', 'normal'), // fp / tn
    pred('normal', 'attention', 'normal'), // fp / tn
    pred('slower', 'normal', 'slower'), // tn / tn
  ];

  it('accuracy, precision, recall, F1, false-positive rate, false positives per patient', () => {
    const { metrics, confusion } = binaryMetrics(predictions, 'baseline');
    expect(confusion).toEqual({ tp: 1, fp: 2, tn: 1, fn: 1 });
    expect(metrics).toMatchObject({
      observations: 5,
      patients: 2,
      accuracy: 0.4,
      false_positives: 2,
      false_positives_per_patient: 1,
    });
    expect(metrics.precision).toBeCloseTo(1 / 3, 12);
    expect(metrics.recall).toBe(0.5);
    expect(metrics.f1).toBeCloseTo(0.4, 12); // 2·1 / (2·1 + 2 + 1)
    expect(metrics.false_positive_rate).toBeCloseTo(2 / 3, 12);
    expect(binaryMetrics(predictions, 'nexivo').metrics).toMatchObject({
      precision: 1,
      recall: 0.5,
      false_positives: 0,
    });
  });

  it('undefined ratios are null, not 0', () => {
    expect(binaryMetrics([pred('normal', 'normal', 'normal')], 'baseline').metrics).toMatchObject({
      precision: null,
      recall: null,
      f1: null,
    });
  });

  it('3-class accuracy and macro-F1 for Nexivo', () => {
    const { metrics, confusion } = threeClassMetrics(predictions);
    expect(confusion.attention).toEqual({ normal: 0, slower: 1, attention: 1 });
    expect(metrics.accuracy).toBe(0.8);
    // F1: normal 1, slower 2/3, attention 2/3 → macro 7/9.
    expect(metrics.macro_f1).toBeCloseTo(7 / 9, 12);
  });

  it('splits patients 30/70 by seed: reproducible, disjoint, complete', () => {
    const keys = Array.from({ length: 20 }, (_, i) => `P${i}`);
    const split = splitPatients(keys, 5);
    expect(split.tuning).toHaveLength(6);
    expect(split.test).toHaveLength(14);
    expect(new Set([...split.tuning, ...split.test]).size).toBe(20);
    expect(splitPatients([...keys].reverse(), 5)).toEqual(split);
    expect(splitPatients(keys, 6)).not.toEqual(split);
  });

  it('the same seed gives identical metrics', () => {
    const predictionsFor = replay(generateDataset(11, { patients: 20 }, params.symptoms), params);
    expect(evaluatePredictions(predictionsFor, 3)).toEqual(evaluatePredictions(predictionsFor, 3));
    expect(evaluatePredictions(predictionsFor, 3).split.test).toHaveLength(14);
  });
});
