// The shape of a Nexivo scoring config (spec Section 8, stored in
// scoring_configs.params). Checked with zod before a new version is saved, so
// the engine can trust every value. Same idea as config/riskRules.js.

import { z } from 'zod';

/** The six scored parameters, in the order the spec lists them. */
export const PARAMETERS = ['pain', 'mobility', 'fatigue', 'symptoms', 'adherence', 'milestones'];

const WEIGHT_TOLERANCE = 1e-9;

const score100 = z.number().finite().min(0).max(100);
const fraction = z.number().finite().min(0).max(1);
const scale10 = z.number().int().min(0).max(10);
const count = (min, max) => z.number().int().min(min).max(max);

const paramsSchema = z
  .strictObject({
    weights: z.strictObject(Object.fromEntries(PARAMETERS.map((p) => [p, z.number().finite().min(0).max(1)]))),
    window_k: count(1, 50),
    min_history: count(0, 50),
    drop_threshold: score100,
    critical_floor: score100,
    expected_start: score100,
    target: score100,
    tolerance: score100,
    min_slope_per_day: z.number().finite(),
    sudden_change_points: count(1, 10),
    z_threshold: z.number().finite().positive(),
    sd_floor: z.number().finite().positive(),
    no_improvement_window: count(2, 50),
    adherence_medium: fraction,
    adherence_high: fraction,
    milestone_grace_days: count(0, 365),
    default_expected_recovery_days: count(1, 365),
    limited_history_bands: z.strictObject({ attention_below: score100, slower_below: score100 }),
    symptoms: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, 'must be snake_case'))
      .min(1)
      .refine((s) => new Set(s).size === s.length, 'must not repeat'),
    baseline_rules: z.strictObject({
      pain_gte: scale10,
      mobility_lte: scale10,
      adherence_lt: fraction,
      any_symptom_severity_gte: count(0, 3),
    }),
    milestone_templates: z
      .record(
        z.string(),
        z.array(z.strictObject({ name: z.string().trim().min(1).max(200), target_day: count(0, 365) })),
      )
      .optional(),
  })
  .superRefine((p, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
    const sum = PARAMETERS.reduce((total, name) => total + p.weights[name], 0);
    if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) issue(['weights'], `must sum to 1.0 (got ${sum})`);
    if (p.adherence_high > p.adherence_medium) issue(['adherence_high'], 'must not be above adherence_medium');
    if (p.limited_history_bands.attention_below > p.limited_history_bands.slower_below)
      issue(['limited_history_bands'], 'attention_below must not be above slower_below');
    if (p.expected_start > p.target) issue(['expected_start'], 'must not be above target');
  });

/** POST /api/config/scoring body: a new version, activated on save. */
export const configBody = z.strictObject({
  version: z.string().regex(/^[A-Za-z0-9._-]{1,50}$/, 'letters, digits, . _ - (max 50)'),
  params: paramsSchema,
});

export { paramsSchema as scoringParamsSchema };
