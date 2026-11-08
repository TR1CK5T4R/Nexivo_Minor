// Nexivo M6: the static-rule baseline. ReviveCare's rule evaluator
// (services/riskEngine.js evaluateParameter, unchanged) applied to fixed
// thresholds that are the same for every patient and ignore history.
//
// ReviveCare's own rule judges the LLM's seriousness score for a chat message,
// which a check-in doesn't have, so the thresholds are the spec's default static
// baseline (config.baseline_rules: pain ≥ 7, mobility ≤ 3, adherence < 80%,
// any severe symptom), written in the same rule shape as config/riskRules.js.
// Pure: the evaluator has no database or HTTP code.

import { evaluateParameter } from '../services/riskEngine.js';

const rule = (id, operator, threshold, description) => ({ id, operator, threshold, flag: 'alert_doctor', description });

/** config.baseline_rules → a rule set evaluateParameter understands (riskRules.js shape). */
export function baselineRuleSet(baselineRules) {
  return {
    parameters: {
      pain: {
        whenMissing: 0,
        clamp: { min: 0, max: 10 },
        rules: [rule('B-PAIN', 'gte', baselineRules.pain_gte, 'Pain at or above the fixed threshold')],
      },
      mobility: {
        whenMissing: 10,
        clamp: { min: 0, max: 10 },
        rules: [rule('B-MOBILITY', 'lte', baselineRules.mobility_lte, 'Mobility at or below the fixed threshold')],
      },
      // Nothing prescribed counts as full adherence.
      adherence: {
        whenMissing: 1,
        clamp: { min: 0, max: 1 },
        rules: [rule('B-ADHERENCE', 'lt', baselineRules.adherence_lt, 'Adherence below the fixed threshold')],
      },
      max_symptom_severity: {
        whenMissing: 0,
        clamp: { min: 0, max: 3 },
        rules: [rule('B-SYMPTOM', 'gte', baselineRules.any_symptom_severity_gte, 'A symptom at or above the severity')],
      },
    },
  };
}

/**
 * The common engine interface. `history` is accepted and ignored on purpose:
 * the baseline judges each reading on its own.
 *
 * @param {object[]} _history
 * @param {object} current one observation (engine input shape)
 * @param {object} params the scoring config
 * @returns {{ category: 'normal' | 'attention', flagged: boolean, reasons: string[] }}
 */
export function evaluateBaseline(_history, current, params) {
  const rules = baselineRuleSet(params.baseline_rules);
  const values = {
    pain: current.pain,
    mobility: current.mobility,
    adherence: current.doses_prescribed > 0 ? current.doses_taken / current.doses_prescribed : undefined,
    max_symptom_severity: Math.max(0, ...params.symptoms.map((s) => current.symptoms[s] ?? 0)),
  };
  const results = Object.entries(values).map(([name, value]) => evaluateParameter(name, value, rules));
  const flagged = results.some((r) => r.flags.includes('alert_doctor'));
  return { category: flagged ? 'attention' : 'normal', flagged, reasons: results.flatMap((r) => r.reasons) };
}
