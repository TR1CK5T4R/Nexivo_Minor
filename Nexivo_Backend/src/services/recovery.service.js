// Nexivo recovery profile, milestones and the active scoring config.
// Plain functions: no req/res, no SQL.
//
// `actor.patientId` is the logged-in patient (or null for a clinician request:
// clinicians have no login yet, so those requests are open like POST /doctor_info).
// A patient may only touch their own rows.

import { withTransaction } from '../db/tx.js';
import {
  findActiveConfig,
  findAlertForUpdate,
  findLatestScore,
  findMilestone,
  findProfile,
  findProfileForUpdate,
  hasMilestones,
  hasObservations,
  insertActiveConfig,
  insertMilestones,
  listAlerts as listAlertRows,
  listMilestones as listMilestoneRows,
  listOverview,
  listScoreHistory,
  lockPatient,
  setAlertStatus,
  setMilestoneCompleted,
  upsertProfile,
} from '../repositories/recovery.repository.js';
import { findPatientById } from '../repositories/patient.repository.js';
import { AppError } from '../utils/httpErrors.js';

export const notFound = (what) => new AppError(404, { error: `${what} not found` });
export const FORBIDDEN = () => new AppError(403, { error: 'Forbidden' });

/** 404 unless the patient exists. */
export async function assertPatient(patientId, client) {
  if (!(await findPatientById(patientId, client))) throw notFound('Patient');
}

/** 403 when a logged-in patient reaches another patient's row. */
export function assertOwner(actor, patientId) {
  if (actor.patientId !== null && actor.patientId !== patientId) throw FORBIDDEN();
}

export async function getActiveConfig() {
  return findActiveConfig();
}

const UNIQUE_VIOLATION = '23505';

/**
 * Save a new config version (already validated by configBody) and activate it.
 * Existing scores are not touched; run `npm run db:recompute` to score with it.
 */
export async function createConfig(body) {
  try {
    return await withTransaction((client) => insertActiveConfig(body, client));
  } catch (err) {
    if (err.code !== UNIQUE_VIOLATION) throw err;
    throw new AppError(409, {
      error:
        err.constraint === 'scoring_configs_version_key'
          ? 'A config with this version already exists'
          : 'Another config was activated at the same time; try again',
    });
  }
}

export async function getProfile(patientId) {
  await assertPatient(patientId);
  const profile = await findProfile(patientId);
  if (!profile) throw notFound('Recovery profile');
  return profile;
}

/**
 * Create or replace the surgery details (PUT semantics: omitted optional fields
 * are reset). The first save also creates the milestone plan from the config's
 * templates, by surgery type, else the generic set.
 *
 * @returns {Promise<{ profile: object, created: boolean }>}
 */
export async function saveProfile(patientId, body) {
  return withTransaction(async (client) => {
    // Serialises saves for one patient, so the milestone plan is created once.
    if (!(await lockPatient(patientId, client))) throw notFound('Patient');
    const { params } = await findActiveConfig(client);
    const existing = await findProfileForUpdate(patientId, client);
    if (existing && existing.surgery_date !== body.surgery_date && (await hasObservations(patientId, client))) {
      // Stored observations carry day_post_op computed from the old date.
      throw new AppError(409, { error: 'surgery_date cannot change after check-ins exist' });
    }
    const surgeryType = body.surgery_type ?? null;
    const result = await upsertProfile(
      {
        patientId,
        surgeryType,
        surgeryDate: body.surgery_date,
        expectedRecoveryDays: body.expected_recovery_days ?? params.default_expected_recovery_days,
        notes: body.notes ?? null,
      },
      client,
    );
    if (!(await hasMilestones(patientId, client))) {
      const templates = params.milestone_templates ?? {};
      const key = surgeryType?.toLowerCase();
      const plan = Object.hasOwn(templates, key) ? templates[key] : (templates.generic ?? []);
      await insertMilestones(patientId, plan, client);
    }
    return result;
  });
}

export async function listMilestones(patientId) {
  await assertPatient(patientId);
  return listMilestoneRows(patientId);
}

export async function addMilestone(patientId, { name, target_day }) {
  await assertPatient(patientId);
  const [milestone] = await insertMilestones(patientId, [{ name, target_day }]);
  return milestone;
}

export async function setMilestoneDone(milestoneId, completed, actor) {
  const milestone = await findMilestone(milestoneId);
  if (!milestone) throw notFound('Milestone');
  assertOwner(actor, milestone.patient_id);
  return setMilestoneCompleted(milestoneId, completed);
}

export async function listAlerts(patientId, status = null) {
  await assertPatient(patientId);
  return listAlertRows(patientId, status);
}

// Alerts only move forward.
const NEXT_STATUS = { open: ['acknowledged', 'resolved'], acknowledged: ['resolved'], resolved: [] };

export async function updateAlertStatus(alertId, status, actor) {
  return withTransaction(async (client) => {
    const alert = await findAlertForUpdate(alertId, client);
    if (!alert) throw notFound('Alert');
    assertOwner(actor, alert.patient_id);
    if (!NEXT_STATUS[alert.status].includes(status))
      throw new AppError(409, { error: `Alert is ${alert.status}; it cannot become ${status}` });
    return setAlertStatus(alertId, status, actor.patientId, client);
  });
}

/** The current score with its factors, explanation and recommendation. */
export async function getLatestScore(patientId) {
  await assertPatient(patientId);
  const score = await findLatestScore(patientId);
  if (!score) throw notFound('Score');
  return score;
}

/** Score history (one per check-in, oldest first) for the trend charts. */
export async function listScores(patientId, range) {
  await assertPatient(patientId);
  return listScoreHistory(patientId, range);
}

/** Clinician overview: every patient with a recovery profile, most urgent first. */
export async function getOverview() {
  return listOverview();
}
