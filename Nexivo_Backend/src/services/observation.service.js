// Nexivo check-ins (M1): create, correct, list. Observations are append-only:
// a correction inserts a new row pointing at the version it replaces.
// Plain functions: no req/res, no SQL. See recovery.service.js for `actor`.

import { withTransaction } from '../db/tx.js';
import {
  findActiveConfig,
  findObservation,
  findProfile,
  insertObservation,
  listLatestObservations,
} from '../repositories/recovery.repository.js';
import { AppError } from '../utils/httpErrors.js';
import { assertOwner, assertPatient, notFound } from './recovery.service.js';
import { assessNewObservation } from './score.service.js';

const UNIQUE_VIOLATION = '23505';
const DAY_MS = 86_400_000;

const invalid = (fields) => new AppError(400, { error: 'Invalid request', fields });

/**
 * Whole days from the surgery date to the observation.
 * shortcut: UTC calendar dates, so a check-in at 01:00 IST counts toward the previous day;
 * add a clinic time zone setting if day boundaries start to matter.
 *
 * @param {string} observedAt ISO timestamp
 * @param {string} surgeryDate YYYY-MM-DD
 */
export function dayPostOp(observedAt, surgeryDate) {
  const observedDate = new Date(observedAt).toISOString().slice(0, 10);
  return Math.round((Date.parse(observedDate) - Date.parse(surgeryDate)) / DAY_MS);
}

/**
 * Check the values against the config and profile, and shape the row to insert.
 * Every configured symptom is stored (missing ones as 0) so the history is complete.
 */
function buildRow(values, { params }, profile, { patientId, actor, correctsObservationId = null }) {
  const unknown = Object.keys(values.newSymptoms).filter((s) => !params.symptoms.includes(s));
  if (unknown.length > 0) throw invalid({ [`symptoms.${unknown[0]}`]: 'is not a known symptom' });
  if (values.doses_taken > values.doses_prescribed)
    throw invalid({ doses_taken: 'cannot be more than doses_prescribed' });
  const day = dayPostOp(values.observed_at, profile.surgery_date);
  if (day < 0) throw invalid({ observed_at: 'is before the surgery date' });
  return {
    patientId,
    observedAt: values.observed_at,
    dayPostOp: day,
    pain: values.pain,
    mobility: values.mobility,
    fatigue: values.fatigue,
    symptoms: Object.fromEntries(params.symptoms.map((s) => [s, values.symptoms[s] ?? 0])),
    dosesPrescribed: values.doses_prescribed,
    dosesTaken: values.doses_taken,
    notes: values.notes,
    source: actor.patientId === null ? 'clinician' : 'patient',
    correctsObservationId,
  };
}

async function requireProfile(patientId, client) {
  const profile = await findProfile(patientId, client);
  if (profile) return profile;
  await assertPatient(patientId, client);
  throw invalid({ recovery_profile: 'set the surgery details before the first check-in' });
}

/**
 * @param {number} patientId
 * @param {object} body validated observationBody
 * @param {{ patientId: number | null }} actor
 * @returns {Promise<{ observation: object, score: object, alerts: object[] }>} alerts raised or updated by it
 */
export async function createObservation(patientId, body, actor) {
  return withTransaction(async (client) => {
    const profile = await requireProfile(patientId, client);
    const config = await findActiveConfig(client);
    const values = { ...body, observed_at: body.observed_at ?? new Date().toISOString(), newSymptoms: body.symptoms };
    const observation = await insertObservation(buildRow(values, config, profile, { patientId, actor }), client);
    return { observation, ...(await assessNewObservation(observation, profile, config, client)) };
  });
}

/**
 * Insert a corrected version of an observation. Only the latest version can be corrected.
 *
 * @param {number} observationId
 * @param {object} body validated correctionBody (any subset of the fields)
 * @param {{ patientId: number | null }} actor
 */
export async function correctObservation(observationId, body, actor) {
  return withTransaction(async (client) => {
    const original = await findObservation(observationId, client);
    if (!original) throw notFound('Observation');
    assertOwner(actor, original.patient_id);
    if (original.corrected)
      throw new AppError(409, { error: 'Observation already corrected; correct its latest version' });
    const patientId = original.patient_id;
    const profile = await requireProfile(patientId, client);
    const config = await findActiveConfig(client);
    const values = {
      observed_at: body.observed_at ?? original.observed_at,
      pain: body.pain ?? original.pain,
      mobility: body.mobility ?? original.mobility,
      fatigue: body.fatigue ?? original.fatigue,
      symptoms: { ...original.symptoms, ...body.symptoms },
      newSymptoms: body.symptoms ?? {},
      doses_prescribed: body.doses_prescribed ?? original.doses_prescribed,
      doses_taken: body.doses_taken ?? original.doses_taken,
      notes: body.notes !== undefined ? body.notes : original.notes,
    };
    const row = buildRow(values, config, profile, { patientId, actor, correctsObservationId: original.id });
    try {
      const observation = await insertObservation(row, client);
      return { observation, ...(await assessNewObservation(observation, profile, config, client)) };
    } catch (err) {
      // Another correction of the same version won the race.
      if (err.code === UNIQUE_VIOLATION && err.constraint === 'recovery_observations_corrects_key')
        throw new AppError(409, { error: 'Observation already corrected; correct its latest version' });
      throw err;
    }
  });
}

/** Latest versions, oldest first. */
export async function listObservations(patientId, range) {
  await assertPatient(patientId);
  return listLatestObservations(patientId, range);
}
