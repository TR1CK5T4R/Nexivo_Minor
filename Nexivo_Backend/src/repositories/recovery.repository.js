// SQL for Nexivo recovery data: profiles, observations, milestones and the
// active scoring config. recovery_observations is append-only: there is no
// UPDATE or DELETE for it here, on purpose.
// Timestamps are selected through to_json() so the API gets ISO 8601 strings.

import { query } from '../db/pool.js';

const PROFILE_COLUMNS = `id, patient_id, surgery_type, surgery_date, expected_recovery_days, notes,
  to_json(created_at) AS created_at, to_json(updated_at) AS updated_at`;

const OBSERVATION_COLUMNS = `id, patient_id, to_json(observed_at) AS observed_at, day_post_op, pain, mobility,
  fatigue, symptoms, doses_prescribed, doses_taken, notes, entered_by, source, corrects_observation_id,
  to_json(created_at) AS created_at`;

const MILESTONE_COLUMNS = `id, patient_id, name, target_day, to_json(completed_at) AS completed_at,
  to_json(created_at) AS created_at`;

/**
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<{ id: number, version: string, params: object }>}
 */
export async function findActiveConfig(client) {
  const { rows } = await query('SELECT id, version, params FROM scoring_configs WHERE active', [], client);
  if (!rows[0]) throw new Error('No active scoring config (scoring_configs has no active row)');
  return rows[0];
}

/** Lock the patient row until the transaction ends. False when the patient doesn't exist. */
export async function lockPatient(patientId, client) {
  const { rows } = await query('SELECT 1 FROM patients WHERE id = $1 FOR UPDATE', [patientId], client);
  return rows.length > 0;
}

// ── Profiles ──

export async function findProfile(patientId, client) {
  const { rows } = await query(
    `SELECT ${PROFILE_COLUMNS} FROM recovery_profiles WHERE patient_id = $1`,
    [patientId],
    client,
  );
  return rows[0] ?? null;
}

/** Same as findProfile, but locks the row until the transaction ends. */
export async function findProfileForUpdate(patientId, client) {
  const { rows } = await query(
    `SELECT ${PROFILE_COLUMNS} FROM recovery_profiles WHERE patient_id = $1 FOR UPDATE`,
    [patientId],
    client,
  );
  return rows[0] ?? null;
}

/**
 * @returns {Promise<{ profile: object, created: boolean }>}
 */
export async function upsertProfile({ patientId, surgeryType, surgeryDate, expectedRecoveryDays, notes }, client) {
  const { rows } = await query(
    `INSERT INTO recovery_profiles (patient_id, surgery_type, surgery_date, expected_recovery_days, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (patient_id) DO UPDATE
       SET surgery_type = EXCLUDED.surgery_type, surgery_date = EXCLUDED.surgery_date,
           expected_recovery_days = EXCLUDED.expected_recovery_days, notes = EXCLUDED.notes, updated_at = now()
     RETURNING ${PROFILE_COLUMNS}, (xmax = 0) AS created`,
    [patientId, surgeryType, surgeryDate, expectedRecoveryDays, notes],
    client,
  );
  const { created, ...profile } = rows[0];
  return { profile, created };
}

// ── Observations ──

export async function hasObservations(patientId, client) {
  const { rows } = await query(
    'SELECT 1 FROM recovery_observations WHERE patient_id = $1 LIMIT 1',
    [patientId],
    client,
  );
  return rows.length > 0;
}

/**
 * @param {{ patientId: number, observedAt: string, dayPostOp: number, pain: number, mobility: number,
 *   fatigue: number, symptoms: Record<string, number>, dosesPrescribed: number, dosesTaken: number,
 *   notes: string | null, source: string, correctsObservationId: number | null }} o
 * @param {import('pg').PoolClient} [client]
 */
export async function insertObservation(o, client) {
  const { rows } = await query(
    `INSERT INTO recovery_observations
       (patient_id, observed_at, day_post_op, pain, mobility, fatigue, symptoms, doses_prescribed, doses_taken,
        notes, entered_by, source, corrects_observation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             -- a patient entry records that patient's login; clinicians have none yet
             CASE WHEN $11::varchar = 'patient' THEN (SELECT user_id FROM patients WHERE id = $1) END,
             $11::varchar, $12)
     RETURNING ${OBSERVATION_COLUMNS}`,
    [
      o.patientId,
      o.observedAt,
      o.dayPostOp,
      o.pain,
      o.mobility,
      o.fatigue,
      JSON.stringify(o.symptoms),
      o.dosesPrescribed,
      o.dosesTaken,
      o.notes,
      o.source,
      o.correctsObservationId,
    ],
    client,
  );
  return rows[0];
}

/** One observation (any version), with `corrected`: whether a newer version replaces it. */
export async function findObservation(id, client) {
  const { rows } = await query(
    `SELECT ${OBSERVATION_COLUMNS},
            EXISTS (SELECT 1 FROM recovery_observations c WHERE c.corrects_observation_id = o.id) AS corrected
       FROM recovery_observations o WHERE id = $1`,
    [id],
    client,
  );
  return rows[0] ?? null;
}

/**
 * Latest versions only, oldest first. from/to are inclusive ISO timestamps or null.
 * ORDER BY is qualified with `o.`: the bare name would be the to_json() alias.
 */
export async function listLatestObservations(patientId, { from = null, to = null } = {}, client) {
  const { rows } = await query(
    `SELECT ${OBSERVATION_COLUMNS}
       FROM recovery_observations o
      WHERE patient_id = $1
        AND NOT EXISTS (SELECT 1 FROM recovery_observations c WHERE c.corrects_observation_id = o.id)
        AND ($2::timestamptz IS NULL OR observed_at >= $2)
        AND ($3::timestamptz IS NULL OR observed_at <= $3)
      ORDER BY o.observed_at, o.id`,
    [patientId, from, to],
    client,
  );
  return rows;
}

// ── Milestones ──

export async function listMilestones(patientId, client) {
  const { rows } = await query(
    `SELECT ${MILESTONE_COLUMNS} FROM recovery_milestones WHERE patient_id = $1 ORDER BY target_day, id`,
    [patientId],
    client,
  );
  return rows;
}

export async function hasMilestones(patientId, client) {
  const { rows } = await query('SELECT 1 FROM recovery_milestones WHERE patient_id = $1 LIMIT 1', [patientId], client);
  return rows.length > 0;
}

/**
 * @param {number} patientId
 * @param {{ name: string, target_day: number }[]} milestones
 * @param {import('pg').PoolClient} [client]
 */
export async function insertMilestones(patientId, milestones, client) {
  if (milestones.length === 0) return [];
  const { rows } = await query(
    `INSERT INTO recovery_milestones (patient_id, name, target_day)
     SELECT $1, m.name, m.target_day FROM jsonb_to_recordset($2::jsonb) AS m(name TEXT, target_day INTEGER)
     RETURNING ${MILESTONE_COLUMNS}`,
    [patientId, JSON.stringify(milestones)],
    client,
  );
  return rows;
}

export async function findMilestone(id, client) {
  const { rows } = await query(`SELECT ${MILESTONE_COLUMNS} FROM recovery_milestones WHERE id = $1`, [id], client);
  return rows[0] ?? null;
}

/** completed true → completed_at = now() (kept if already set); false → NULL. */
export async function setMilestoneCompleted(id, completed, client) {
  const { rows } = await query(
    `UPDATE recovery_milestones
        SET completed_at = CASE WHEN $2 THEN COALESCE(completed_at, now()) END
      WHERE id = $1
      RETURNING ${MILESTONE_COLUMNS}`,
    [id, completed],
    client,
  );
  return rows[0] ?? null;
}

/**
 * The latest versions observed before `current` (by observed_at, then id), at
 * most `limit` of them, oldest first. This is all the history a score may see.
 */
export async function listPriorObservations(patientId, current, limit, client) {
  const { rows } = await query(
    `SELECT ${OBSERVATION_COLUMNS}
       FROM recovery_observations o
      WHERE patient_id = $1
        AND NOT EXISTS (SELECT 1 FROM recovery_observations c WHERE c.corrects_observation_id = o.id)
        AND (o.observed_at, o.id) < ($2::timestamptz, $3::bigint)
      ORDER BY o.observed_at DESC, o.id DESC
      LIMIT $4`,
    [patientId, current.observed_at, current.id, limit],
    client,
  );
  return rows.reverse();
}

// ── Scores ──

const SCORE_COLUMNS = `id, observation_id, patient_id, config_id, composite, baseline, slope, expected, category,
  limited_history, to_json(computed_at) AS computed_at`;

/**
 * Insert a score; with `skipExisting`, a row that already exists for this
 * observation and config is left alone and null is returned.
 */
export async function insertScore(s, client, { skipExisting = false } = {}) {
  const { rows } = await query(
    `INSERT INTO recovery_scores
       (observation_id, patient_id, config_id, composite, baseline, slope, expected, category, limited_history)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ${skipExisting ? 'ON CONFLICT (observation_id, config_id) DO NOTHING' : ''}
     RETURNING ${SCORE_COLUMNS}`,
    [
      s.observationId,
      s.patientId,
      s.configId,
      s.composite,
      s.baseline,
      s.slope,
      s.expected,
      s.category,
      s.limitedHistory,
    ],
    client,
  );
  return rows[0] ?? null;
}

// ── Scoring configs ──

/**
 * Save a new config version and make it the only active one.
 * @param {import('pg').PoolClient} client inside a transaction
 */
export async function insertActiveConfig({ version, params }, client) {
  await query('UPDATE scoring_configs SET active = false WHERE active', [], client);
  const { rows } = await query(
    `INSERT INTO scoring_configs (version, params, active) VALUES ($1, $2, true)
     RETURNING id, version, params, active, to_json(created_at) AS created_at`,
    [version, JSON.stringify(params)],
    client,
  );
  return rows[0];
}

/** Every patient with a recovery profile (for rescoring). */
export async function listProfiles(client) {
  const { rows } = await query(`SELECT ${PROFILE_COLUMNS} FROM recovery_profiles ORDER BY patient_id`, [], client);
  return rows;
}
