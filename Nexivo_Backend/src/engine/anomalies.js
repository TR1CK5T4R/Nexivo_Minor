// Nexivo M3: trend and anomaly alerts for one observation, from this patient's
// own history. Pure: no database, no HTTP, no clock. Returns candidate alerts;
// de-duplication against stored alerts happens in the service.
//
// "Worsening" means pain or fatigue going up, or mobility, adherence or the
// symptom score going down. The statistical rules work on each parameter's
// normalized value / 10: a 0-10 scale where higher is better, so pain 3 → 7,
// mobility 6 → 6, and sd_floor is in those points.

import { normalize } from './normalize.js';
import { slope } from './score.js';

const LABELS = {
  pain: 'Pain',
  mobility: 'Mobility',
  fatigue: 'Fatigue',
  symptoms: 'Symptom score',
  adherence: 'Medication adherence',
};
// The parameters the statistical rules watch (milestones have their own rule).
const TREND_PARAMETERS = Object.keys(LABELS);
const humanize = (name) => name.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
const round1 = (x) => Math.round(x * 10) / 10;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * @param {object[]} history earlier observations, oldest first (engine input shape)
 * @param {object} current the observation being assessed
 * @param {object} params the scoring config
 * @param {{ expectedRecoveryDays: number, baseline: number | null, composite: number,
 *   milestones?: { id: number, name: string, target_day: number, completed_at: string | null }[] }} ctx
 * @returns {{ type: string, parameter: string | null, severity: 'low' | 'medium' | 'high',
 *   message: string, details: object }[]}
 */
export function detectAnomalies(
  history,
  current,
  params,
  { expectedRecoveryDays, baseline, composite, milestones = [] },
) {
  const alerts = [];
  const add = (type, parameter, severity, message, details) =>
    alerts.push({ type, parameter, severity, message, details });
  const previous = history.at(-1);

  // SUDDEN_DETERIORATION: a 0-10 parameter worsens by ≥ sudden_change_points since the previous
  // check-in, or a symptom rises to severe (3).
  if (previous) {
    for (const p of ['pain', 'mobility', 'fatigue']) {
      const worsening = p === 'mobility' ? previous[p] - current[p] : current[p] - previous[p];
      if (worsening >= params.sudden_change_points) {
        add(
          'SUDDEN_DETERIORATION',
          p,
          'high',
          `${LABELS[p]} ${p === 'mobility' ? 'fell' : 'rose'} from ${previous[p]}/10 to ${current[p]}/10 since the previous check-in.`,
          { previous: previous[p], current: current[p], change: worsening, threshold: params.sudden_change_points },
        );
      }
    }
  }
  for (const s of params.symptoms) {
    const before = previous?.symptoms[s] ?? 0;
    if ((current.symptoms[s] ?? 0) >= 3 && before < 3) {
      add('SUDDEN_DETERIORATION', `symptoms.${s}`, 'high', `${humanize(s)} reported as severe.`, {
        previous: before,
        current: 3,
      });
    }
  }

  // SCORE_DROP: B − C ≥ drop_threshold.
  if (baseline !== null && baseline - composite >= params.drop_threshold) {
    add(
      'SCORE_DROP',
      null,
      'high',
      `Recovery score ${round1(composite)} is ${round1(baseline - composite)} points below this patient's recent average of ${round1(baseline)}.`,
      { composite, baseline, drop: baseline - composite, threshold: params.drop_threshold },
    );
  }

  const now = normalize(current, params);
  // A parameter that just had a sudden deterioration gets no extra UNUSUAL_CHANGE / NO_IMPROVEMENT
  // alert for the same check-in: they would repeat the same event at a lower severity.
  // A severe symptom counts for the symptom score.
  const sudden = new Set(alerts.filter((a) => a.type === 'SUDDEN_DETERIORATION').map((a) => a.parameter.split('.')[0]));

  // UNUSUAL_CHANGE: z ≤ −z_threshold against the previous window_k observations (needs all of them).
  if (history.length >= params.window_k) {
    const window = history.slice(-params.window_k).map((o) => normalize(o, params));
    for (const p of TREND_PARAMETERS) {
      if (sudden.has(p)) continue;
      const values = window.map((n) => n[p] / 10);
      const m = mean(values);
      const sd = Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
      const z = (now[p] / 10 - m) / Math.max(sd, params.sd_floor);
      if (z <= -params.z_threshold) {
        add('UNUSUAL_CHANGE', p, 'medium', `${LABELS[p]} is unusually worse than this patient's recent check-ins.`, {
          value: now[p] / 10,
          mean: m,
          sd,
          z,
          threshold: params.z_threshold,
        });
      }
    }
  }

  // NO_IMPROVEMENT: slope ≤ 0 over the last no_improvement_window observations, before the
  // expected recovery day. A parameter already at its best has nothing left to improve.
  const w = params.no_improvement_window;
  if (history.length >= w - 1 && current.day_post_op < expectedRecoveryDays) {
    const recent = [...history.slice(-(w - 1)), current].map((o) => ({ day: o.day_post_op, n: normalize(o, params) }));
    for (const p of TREND_PARAMETERS) {
      if (now[p] >= 100 || sudden.has(p)) continue;
      const s = slope(recent.map((r) => ({ x: r.day, y: r.n[p] / 10 })));
      if (s !== null && s <= 0) {
        add('NO_IMPROVEMENT', p, 'medium', `${LABELS[p]} has not improved over the last ${w} check-ins.`, {
          slope_per_day: s,
          window: w,
        });
      }
    }
  }

  // ADHERENCE_DROP: taken / prescribed below adherence_medium (high below adherence_high).
  if (current.doses_prescribed > 0) {
    const ratio = current.doses_taken / current.doses_prescribed;
    const severity = ratio < params.adherence_high ? 'high' : ratio < params.adherence_medium ? 'medium' : null;
    if (severity) {
      add(
        'ADHERENCE_DROP',
        null,
        severity,
        `${current.doses_taken} of ${current.doses_prescribed} prescribed doses taken (${Math.round(ratio * 100)}%).`,
        { ratio, medium_below: params.adherence_medium, high_below: params.adherence_high },
      );
    }
  }

  // MILESTONE_OVERDUE: not completed milestone_grace_days or more after its target day.
  const observedAt = Date.parse(current.observed_at);
  for (const m of milestones) {
    const done = m.completed_at !== null && Date.parse(m.completed_at) <= observedAt;
    const overdueBy = current.day_post_op - m.target_day;
    if (!done && overdueBy >= params.milestone_grace_days) {
      add(
        'MILESTONE_OVERDUE',
        `milestones.${m.id}`,
        'low',
        `Milestone "${m.name}" was due on day ${m.target_day} and is not marked complete.`,
        {
          milestone_id: m.id,
          target_day: m.target_day,
          day_post_op: current.day_post_op,
          grace_days: params.milestone_grace_days,
        },
      );
    }
  }

  return alerts;
}
