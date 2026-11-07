// Nexivo M2 steps 2-4: composite score, personal context and category.
// Pure: no database, no HTTP, no clock. Everything comes from the arguments and
// the scoring config; nothing here looks at observations after the current one.

import { normalize } from './normalize.js';

export const CATEGORIES = ['normal', 'slower', 'attention'];

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

/** C = Σ wᵢ × nᵢ */
export function composite(normalized, weights) {
  return Object.keys(weights).reduce((sum, p) => sum + weights[p] * normalized[p], 0);
}

/** E(day): linear from expected_start at day 0 to target at expectedRecoveryDays, then flat. */
export function expectedScore(day, params, expectedRecoveryDays) {
  if (day >= expectedRecoveryDays) return params.target;
  return params.expected_start + ((params.target - params.expected_start) * day) / expectedRecoveryDays;
}

/**
 * Least-squares slope of y against x. null with fewer than two points or when
 * every x is the same (e.g. all check-ins on one day): there is no trend to measure.
 *
 * @param {{ x: number, y: number }[]} points
 */
export function slope(points) {
  if (points.length < 2) return null;
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  return points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
}

/**
 * Step 4: the first matching rule wins.
 *
 * @param {{ composite: number, baseline: number | null, slope: number | null, expected: number,
 *   day: number, expectedRecoveryDays: number, limitedHistory: boolean, alertSeverities?: string[] }} s
 *   alertSeverities: severities of the M3 alerts raised by this observation ('high', 'medium', 'low')
 * @param {object} params the scoring config
 * @returns {'normal' | 'slower' | 'attention'}
 */
export function categorize(s, params) {
  const c = s.composite;
  if (s.limitedHistory) {
    if (c < params.limited_history_bands.attention_below) return 'attention';
    if (c < params.limited_history_bands.slower_below) return 'slower';
    return 'normal';
  }
  const severities = s.alertSeverities ?? [];
  if (
    severities.includes('high') ||
    (s.baseline !== null && s.baseline - c >= params.drop_threshold) ||
    c < params.critical_floor
  )
    return 'attention';
  if (
    c < s.expected - params.tolerance ||
    (s.slope !== null && s.slope < params.min_slope_per_day && c < params.target && s.day < s.expectedRecoveryDays) ||
    severities.includes('medium')
  )
    return 'slower';
  return 'normal';
}

/**
 * Score one observation against this patient's earlier ones.
 *
 * @param {object[]} history the patient's earlier observations, oldest first (only those before `current`)
 * @param {object} current the observation to score (same shape as normalize's input, plus day_post_op)
 * @param {object} params the scoring config
 * @param {{ expectedRecoveryDays: number, alertSeverities?: string[] }} context
 * @returns {{ normalized: object, composite: number, baseline: number | null, slope: number | null,
 *   expected: number, category: string, limited_history: boolean }}
 */
export function scoreObservation(history, current, params, { expectedRecoveryDays, alertSeverities = [] }) {
  const k = params.window_k;
  const scoreOf = (o) => composite(normalize(o, params), params.weights);
  const normalized = normalize(current, params);
  const c = composite(normalized, params.weights);
  const prior = history.slice(-k).map(scoreOf);
  const baseline = prior.length > 0 ? mean(prior) : null;
  // The last k observations including the current one (k = 1 has no trend; slice(-0) would take everything).
  const earlier = k > 1 ? history.slice(-(k - 1)) : [];
  const s = slope([...earlier.map((o) => ({ x: o.day_post_op, y: scoreOf(o) })), { x: current.day_post_op, y: c }]);
  const expected = expectedScore(current.day_post_op, params, expectedRecoveryDays);
  const limitedHistory = history.length < params.min_history;
  const category = categorize(
    {
      composite: c,
      baseline,
      slope: s,
      expected,
      day: current.day_post_op,
      expectedRecoveryDays,
      limitedHistory,
      alertSeverities,
    },
    params,
  );
  return { normalized, composite: c, baseline, slope: s, expected, category, limited_history: limitedHistory };
}
