// Nexivo engine entry point: score an observation, detect its alerts, pick the
// category with those alerts (M2 step 4 needs the M3 severities), then explain
// it (M4). Pure.

import { detectAnomalies } from './anomalies.js';
import { contributions, explain } from './explain.js';
import { recommend } from './recommend.js';
import { categorize, scoreObservation } from './score.js';

/**
 * @param {object[]} history earlier observations, oldest first (only those before `current`)
 * @param {object} current the observation to assess
 * @param {object} params the scoring config
 * @param {{ expectedRecoveryDays: number, milestones?: object[] }} ctx milestones only for the overdue rule
 * @returns {ReturnType<typeof scoreObservation> & { category: string, alerts: ReturnType<typeof detectAnomalies>,
 *   contributions: ReturnType<typeof contributions>, explanation: string, recommendation: string }}
 */
export function assess(history, current, params, { expectedRecoveryDays, milestones = [] }) {
  const score = scoreObservation(history, current, params, { expectedRecoveryDays });
  const alerts = detectAnomalies(history, current, params, {
    expectedRecoveryDays,
    milestones,
    baseline: score.baseline,
    composite: score.composite,
  });
  const category = categorize(
    {
      composite: score.composite,
      baseline: score.baseline,
      slope: score.slope,
      expected: score.expected,
      day: current.day_post_op,
      expectedRecoveryDays,
      limitedHistory: score.limited_history,
      alertSeverities: alerts.map((a) => a.severity),
    },
    params,
  );
  const factors = contributions(score, current, params);
  return {
    ...score,
    category,
    alerts,
    contributions: factors,
    explanation: explain(factors, params),
    recommendation: recommend(category, factors, alerts, params),
  };
}
