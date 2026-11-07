// Nexivo M4: the recommendation, a template looked up by category and top
// factor (params.recommendation_templates). Pure. Decision support wording only.

import { fill, MIN_POINTS } from './explain.js';

const SEVERITY_ORDER = { high: 0, medium: 1 };

/**
 * The parameter driving the status: the most negative contribution; if nothing
 * pulled the score down, the parameter of the most severe high/medium alert
 * ('symptoms.fever' → 'symptoms'); else null.
 */
export function topFactor(factors, alerts, params) {
  if (factors[0] && factors[0].contribution <= -MIN_POINTS) return factors[0].parameter;
  const alert = alerts
    .filter((a) => a.severity in SEVERITY_ORDER)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])[0];
  const parameter = alert?.parameter?.split('.')[0];
  return parameter && Object.hasOwn(params.weights, parameter) ? parameter : null;
}

/**
 * @param {'normal' | 'slower' | 'attention'} category
 * @param {object[]} factors contributions, most negative first
 * @param {object[]} alerts this observation's alerts
 * @param {object} params the scoring config
 * @returns {string}
 */
export function recommend(category, factors, alerts, params) {
  const t = params.recommendation_templates;
  if (category === 'normal') return t.normal;
  const driver = topFactor(factors, alerts, params);
  return fill(category === 'attention' ? t.attention : t.slower, {
    factor: driver ? params.explanation_templates.parameters[driver].label : t.fallback_factor,
    area: driver ? t.areas[driver] : t.fallback_area,
  });
}
