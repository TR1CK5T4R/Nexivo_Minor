// M6 metrics. Positive class = Requires attention ("attention"). Undefined
// ratios (e.g. precision with no positive predictions) are null, not 0. Pure.

import { mulberry32 } from './random.js';

const CLASSES = ['normal', 'slower', 'attention'];
const ratio = (a, b) => (b === 0 ? null : a / b);

/**
 * Patients into a tuning set (thresholds may be adjusted on it) and a test set
 * (results are reported on it), shuffled with the seed.
 */
export function splitPatients(patientKeys, seed, tuningFraction = 0.3) {
  const keys = [...new Set(patientKeys)].sort();
  const random = mulberry32(seed);
  for (let i = keys.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const n = Math.round(keys.length * tuningFraction);
  return { tuning_fraction: tuningFraction, tuning: keys.slice(0, n).sort(), test: keys.slice(n).sort() };
}

/** Binary metrics for one engine ('baseline' or 'nexivo'). */
export function binaryMetrics(predictions, engine) {
  const c = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const p of predictions) {
    const actual = p.label === 'attention';
    const flagged = p[engine].flagged;
    c[flagged ? (actual ? 'tp' : 'fp') : actual ? 'fn' : 'tn'] += 1;
  }
  const patients = new Set(predictions.map((p) => p.patient_key)).size;
  return {
    metrics: {
      observations: predictions.length,
      patients,
      accuracy: ratio(c.tp + c.tn, predictions.length),
      precision: ratio(c.tp, c.tp + c.fp),
      recall: ratio(c.tp, c.tp + c.fn),
      f1: ratio(2 * c.tp, 2 * c.tp + c.fp + c.fn),
      false_positive_rate: ratio(c.fp, c.fp + c.tn),
      false_positives: c.fp,
      false_positives_per_patient: ratio(c.fp, patients),
    },
    confusion: c,
  };
}

/** 3-class accuracy and macro-F1 for Nexivo (the baseline only has two classes). */
export function threeClassMetrics(predictions) {
  const matrix = Object.fromEntries(CLASSES.map((a) => [a, Object.fromEntries(CLASSES.map((p) => [p, 0]))]));
  for (const p of predictions) matrix[p.label][p.nexivo.category] += 1;
  const perClass = Object.fromEntries(
    CLASSES.map((k) => {
      const tp = matrix[k][k];
      const fp = CLASSES.reduce((s, a) => s + (a === k ? 0 : matrix[a][k]), 0);
      const fn = CLASSES.reduce((s, q) => s + (q === k ? 0 : matrix[k][q]), 0);
      return [k, { precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn) }];
    }),
  );
  const f1s = Object.values(perClass)
    .map((m) => m.f1)
    .filter((f) => f !== null);
  return {
    metrics: {
      accuracy: ratio(
        CLASSES.reduce((s, k) => s + matrix[k][k], 0),
        predictions.length,
      ),
      macro_f1: f1s.length > 0 ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
      per_class: perClass,
    },
    confusion: matrix,
  };
}

function summarize(predictions) {
  const baseline = binaryMetrics(predictions, 'baseline');
  const nexivo = binaryMetrics(predictions, 'nexivo');
  const three = threeClassMetrics(predictions);
  return {
    metrics: { baseline: baseline.metrics, nexivo: { ...nexivo.metrics, three_class: three.metrics } },
    confusion: { baseline: baseline.confusion, nexivo: nexivo.confusion, nexivo_three_class: three.confusion },
  };
}

/**
 * Split by patient, then measure both engines. The test set is the reported
 * result; the tuning set's numbers are kept separately (under "tuning").
 *
 * @param {ReturnType<import('./replay.js').replay>} predictions
 * @param {number} seed
 */
export function evaluatePredictions(predictions, seed) {
  const split = splitPatients(
    predictions.map((p) => p.patient_key),
    seed,
  );
  const tuningKeys = new Set(split.tuning);
  const test = summarize(predictions.filter((p) => !tuningKeys.has(p.patient_key)));
  const tuning = summarize(predictions.filter((p) => tuningKeys.has(p.patient_key)));
  return {
    split,
    metrics: { ...test.metrics, tuning: tuning.metrics },
    confusion: { ...test.confusion, tuning: tuning.confusion },
  };
}
