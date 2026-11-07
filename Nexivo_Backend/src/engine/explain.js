// Nexivo M4: which parameters moved the score, and the explanation text.
// Pure: no database, no HTTP, no clock. All wording comes from
// params.explanation_templates; only number formatting lives here.

/** Smallest contribution (in points) worth a sentence: smaller ones would read "by 0 points". */
export const MIN_POINTS = 0.05;

const round1 = (x) => Math.round(x * 10) / 10;
const points = (x) => String(round1(Math.abs(x)));

// A normalized value (0-100, 100 = best) shown on the parameter's own scale.
const DISPLAY = {
  pain: (n) => `${round1(10 - n / 10)}/10`,
  mobility: (n) => `${round1(n / 10)}/10`,
  fatigue: (n) => `${round1(10 - n / 10)}/10`,
  symptoms: (n) => `${round1(n)}/100`,
  adherence: (n) => `${Math.round(n)}%`,
  milestones: (n) => `${Math.round(n)}%`,
};

/** "{label} rose" + { label: 'Pain' } → "Pain rose". Unknown placeholders stay as they are. */
export function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(values, key) ? values[key] : match));
}

function rawValue(parameter, o, params) {
  switch (parameter) {
    case 'symptoms':
      return params.symptoms.reduce((total, s) => total + (o.symptoms[s] ?? 0), 0); // total severity
    case 'adherence':
      return o.doses_prescribed > 0 ? o.doses_taken / o.doses_prescribed : null;
    case 'milestones':
      return o.milestones_due > 0 ? o.milestones_completed / o.milestones_due : null;
    default:
      return o[parameter]; // pain, mobility, fatigue on their 0-10 scales
  }
}

/**
 * contribᵢ = wᵢ × (nᵢ − bᵢ): negative means the parameter pulled the score below
 * this patient's own baseline. In limited-history mode (or without a baseline)
 * the reference is the ideal 100 instead. The contributions add up to C − B
 * (or C − 100), because the weights sum to 1.
 *
 * @param {{ normalized: object, parameter_baselines: object | null, limited_history: boolean }} score
 * @param {object} current the observation (engine input shape)
 * @param {object} params the scoring config
 * @returns {{ parameter: string, raw_value: number | null, normalized: number, baseline: number | null,
 *   contribution: number }[]} most negative first
 */
export function contributions(score, current, params) {
  const fromIdeal = score.limited_history || score.parameter_baselines === null;
  return Object.keys(params.weights)
    .map((p) => {
      const baseline = fromIdeal ? null : score.parameter_baselines[p];
      return {
        parameter: p,
        raw_value: rawValue(p, current, params),
        normalized: score.normalized[p],
        baseline,
        contribution: params.weights[p] * (score.normalized[p] - (baseline ?? 100)),
      };
    })
    .sort((a, b) => a.contribution - b.contribution);
}

/**
 * One sentence per factor: the top 3 negative ones, then up to 2 positive ones.
 *
 * @param {ReturnType<typeof contributions>} factors
 * @param {object} params the scoring config
 * @returns {string}
 */
export function explain(factors, params) {
  const t = params.explanation_templates;
  const sentence = (f, template) =>
    fill(template, {
      ...t.parameters[f.parameter],
      value: DISPLAY[f.parameter](f.normalized),
      usual: f.baseline === null ? '' : DISPLAY[f.parameter](f.baseline),
      points: points(f.contribution),
    });
  const negatives = factors.filter((f) => f.contribution <= -MIN_POINTS).slice(0, 3);
  const positives = factors
    .filter((f) => f.contribution >= MIN_POINTS)
    .reverse()
    .slice(0, 2);
  const parts = [
    ...negatives.map((f) => sentence(f, f.baseline === null ? t.below_ideal : t.below_baseline)),
    ...positives.map((f) => sentence(f, t.above_baseline)),
  ];
  if (parts.length > 0) return parts.join(' ');
  return factors.every((f) => f.baseline === null) ? t.at_best : t.steady;
}
