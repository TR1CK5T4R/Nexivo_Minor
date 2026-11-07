// Nexivo M2: turn stored observations into engine input, score them, store the
// result. Shared by live check-ins (observation.service.js) and rescoring
// (scripts/recompute-scores.js), so both score exactly the same way.

import { withTransaction } from '../db/tx.js';
import { scoreObservation } from '../engine/score.js';
import {
  findActiveConfig,
  insertScore,
  listLatestObservations,
  listMilestones,
  listPriorObservations,
  listProfiles,
} from '../repositories/recovery.repository.js';

/**
 * Milestones due by this observation's day, and how many of those were
 * completed by the time it was recorded.
 *
 * @param {{ target_day: number, completed_at: string | null }[]} milestones
 * @param {{ day_post_op: number, observed_at: string }} observation
 */
export function milestoneCounts(milestones, observation) {
  const due = milestones.filter((m) => m.target_day <= observation.day_post_op);
  const observedAt = Date.parse(observation.observed_at);
  return {
    milestones_due: due.length,
    milestones_completed: due.filter((m) => m.completed_at !== null && Date.parse(m.completed_at) <= observedAt).length,
  };
}

function score(history, observation, milestones, profile, config) {
  const withCounts = (o) => ({ ...o, ...milestoneCounts(milestones, o) });
  return scoreObservation(history.map(withCounts), withCounts(observation), config.params, {
    expectedRecoveryDays: profile.expected_recovery_days,
  });
}

const toRow = (result, observation, config) => ({
  observationId: observation.id,
  patientId: observation.patient_id,
  configId: config.id,
  composite: result.composite,
  baseline: result.baseline,
  slope: result.slope,
  expected: result.expected,
  category: result.category,
  limitedHistory: result.limited_history,
});

/**
 * Score a just-saved observation using only the observations before it.
 * Call inside the transaction that saved it.
 *
 * @param {object} observation the inserted row
 * @param {object} profile the patient's recovery profile
 * @param {{ id: number, params: object }} config the active scoring config
 * @param {import('pg').PoolClient} client
 */
export async function scoreNewObservation(observation, profile, config, client) {
  const limit = Math.max(config.params.window_k, config.params.min_history);
  const history = await listPriorObservations(observation.patient_id, observation, limit, client);
  const milestones = await listMilestones(observation.patient_id, client);
  return insertScore(toRow(score(history, observation, milestones, profile, config), observation, config), client);
}

/**
 * Score every patient's current observations (latest versions) with the active
 * config, replaying each history in time order. Existing rows for that config
 * are kept as they are; older configs' rows are never touched.
 *
 * @returns {Promise<{ configVersion: string, patients: number, inserted: number, skipped: number }>}
 */
export async function recomputeAllScores() {
  const config = await findActiveConfig();
  const totals = { configVersion: config.version, patients: 0, inserted: 0, skipped: 0 };
  for (const profile of await listProfiles()) {
    await withTransaction(async (client) => {
      const observations = await listLatestObservations(profile.patient_id, {}, client);
      const milestones = await listMilestones(profile.patient_id, client);
      for (const [i, observation] of observations.entries()) {
        const result = score(observations.slice(0, i), observation, milestones, profile, config);
        const row = await insertScore(toRow(result, observation, config), client, { skipExisting: true });
        totals[row ? 'inserted' : 'skipped'] += 1;
      }
    });
    totals.patients += 1;
  }
  return totals;
}
