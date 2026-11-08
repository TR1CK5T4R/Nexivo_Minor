// M6 replay: feed each patient's observations in time order; at every step both
// engines see only that patient's observations up to that point (no look-ahead).
// Pure.

import { engines } from '../engine/index.js';

/**
 * @param {object[]} rows dataset rows (parseResearchCsv / generateDataset shape), any order
 * @param {object} params the scoring config
 * @returns {{ patient_key: string, day_post_op: number, label: string,
 *   baseline: { category: string, flagged: boolean }, nexivo: { category: string, flagged: boolean } }[]}
 */
export function replay(rows, params) {
  const byPatient = new Map();
  for (const row of rows) {
    if (!byPatient.has(row.patient_key)) byPatient.set(row.patient_key, []);
    byPatient.get(row.patient_key).push(row);
  }
  const predictions = [];
  for (const [patientKey, observations] of byPatient) {
    observations.sort((a, b) => a.day_post_op - b.day_post_op); // stable: file order breaks ties
    observations.forEach((current, i) => {
      const history = observations.slice(0, i);
      predictions.push({
        patient_key: patientKey,
        day_post_op: current.day_post_op,
        label: current.label,
        baseline: engines.baseline(history, current, params),
        nexivo: engines.nexivo(history, current, params),
      });
    });
  }
  return predictions;
}
