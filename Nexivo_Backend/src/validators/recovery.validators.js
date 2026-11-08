// Request rules for the Nexivo recovery endpoints (/api/...). New endpoints, so
// the rules come from the spec (M1), not from Django. Ranges are also enforced by
// CHECK constraints in the database (db/migrations/0008-0010).
// Symptom names depend on the active scoring config, and a correction's doses are
// only known after merging, so both are checked in services/observation.service.js.

import { z } from 'zod';

// Clocks differ a little between the browser and the server (same allowance as E23).
const CLOCK_SKEW_MS = 60_000;

const timestamp = z.iso.datetime({ offset: true });
const scale10 = z.number().int().min(0).max(10);
const doses = z.number().int().min(0).max(1000);
const notes = z.string().max(2000).nullable();

export const idParams = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d{0,14}$/, 'must be a positive integer')
    .transform(Number),
});

export const rangeQuery = z.object({ from: timestamp.optional(), to: timestamp.optional() });

export const profileBody = z.object({
  surgery_type: z.string().trim().min(1).max(100).nullable().optional(),
  surgery_date: z.iso.date(),
  expected_recovery_days: z.number().int().min(1).max(365).optional(),
  notes: notes.optional(),
});

const observationFields = {
  observed_at: timestamp,
  pain: scale10,
  mobility: scale10,
  fatigue: scale10,
  symptoms: z.record(z.string(), z.number().int().min(0).max(3)),
  doses_prescribed: doses,
  doses_taken: doses,
  notes,
};

const notInFuture = (now) => (o, ctx) => {
  if (o.observed_at !== undefined && Date.parse(o.observed_at) > now() + CLOCK_SKEW_MS)
    ctx.addIssue({ code: 'custom', path: ['observed_at'], message: 'is in the future' });
};

/**
 * A new check-in. observed_at defaults to now (in the service); symptoms and doses default to none.
 *
 * @param {() => number} [now] milliseconds since the epoch (injectable for tests)
 */
export function observationBody(now = Date.now) {
  const f = observationFields;
  return z
    .object({
      ...f,
      observed_at: f.observed_at.optional(),
      symptoms: f.symptoms.default({}),
      doses_prescribed: f.doses_prescribed.default(0),
      doses_taken: f.doses_taken.default(0),
      notes: f.notes.default(null),
    })
    .superRefine(notInFuture(now));
}

/**
 * A correction: any subset of the fields, merged over the version it corrects.
 *
 * @param {() => number} [now]
 */
export function correctionBody(now = Date.now) {
  return z
    .object(observationFields)
    .partial()
    .superRefine(notInFuture(now))
    .refine((o) => Object.keys(o).length > 0, { message: 'must change at least one field' });
}

export const milestoneBody = z.object({
  name: z.string().trim().min(1).max(200),
  target_day: z.number().int().min(0).max(365),
});

export const milestonePatch = z.object({ completed: z.boolean() });

export const alertsQuery = z.object({ status: z.enum(['open', 'acknowledged', 'resolved']).optional() });

export const alertPatch = z.object({ status: z.enum(['acknowledged', 'resolved']) });

// ── Research (M6) ──

const seed = z.number().int().min(0).max(2_147_483_647);

export const datasetBody = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('csv'),
    name: z.string().trim().min(1).max(100),
    csv: z.string().min(1).max(8_000_000),
  }),
  z.object({
    source: z.literal('synthetic'),
    name: z.string().trim().min(1).max(100),
    seed,
    patients: z.number().int().min(10).max(500).default(60),
  }),
]);

export const evaluationBody = z.object({
  dataset_id: z.number().int().positive(),
  seed,
  config_id: z.number().int().positive().optional(),
});
