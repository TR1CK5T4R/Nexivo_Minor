// SQL for the Nexivo research module (M6). Separate tables from clinical data.

import { query } from '../db/pool.js';

const DATASET_COLUMNS = `id, name, source, seed, generator_options, patient_count, observation_count,
  to_json(created_at) AS created_at`;

/**
 * Insert a dataset and all its rows. Call inside a transaction.
 * @param {{ name: string, source: string, seed: number | null, generatorOptions: object | null }} d
 * @param {object[]} rows parseResearchCsv / generateDataset rows
 */
export async function insertDataset(d, rows, client) {
  const patients = new Set(rows.map((r) => r.patient_key)).size;
  const { rows: inserted } = await query(
    `INSERT INTO research_datasets (name, source, seed, generator_options, patient_count, observation_count)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${DATASET_COLUMNS}`,
    [d.name, d.source, d.seed, d.generatorOptions && JSON.stringify(d.generatorOptions), patients, rows.length],
    client,
  );
  const dataset = inserted[0];
  await query(
    `INSERT INTO research_observations
       (dataset_id, seq, patient_key, day_post_op, pain, mobility, fatigue, symptoms, doses_prescribed, doses_taken,
        milestones_completed, milestones_due, label)
     SELECT $1, r.seq, r.patient_key, r.day_post_op, r.pain, r.mobility, r.fatigue, r.symptoms, r.doses_prescribed,
            r.doses_taken, r.milestones_completed, r.milestones_due, r.label
       FROM jsonb_to_recordset($2::jsonb) AS r(seq INTEGER, patient_key TEXT, day_post_op INTEGER, pain SMALLINT,
            mobility SMALLINT, fatigue SMALLINT, symptoms JSONB, doses_prescribed INTEGER, doses_taken INTEGER,
            milestones_completed INTEGER, milestones_due INTEGER, label TEXT)`,
    [dataset.id, JSON.stringify(rows.map((r, seq) => ({ ...r, seq })))],
    client,
  );
  return dataset;
}

export async function listDatasets(client) {
  const { rows } = await query(`SELECT ${DATASET_COLUMNS} FROM research_datasets ORDER BY id DESC`, [], client);
  return rows;
}

export async function findDataset(id, client) {
  const { rows } = await query(`SELECT ${DATASET_COLUMNS} FROM research_datasets WHERE id = $1`, [id], client);
  return rows[0] ?? null;
}

/** A dataset's rows in file order. */
export async function listDatasetRows(datasetId, client) {
  const { rows } = await query(
    `SELECT patient_key, day_post_op, pain, mobility, fatigue, symptoms, doses_prescribed, doses_taken,
            milestones_completed, milestones_due, label
       FROM research_observations WHERE dataset_id = $1 ORDER BY seq`,
    [datasetId],
    client,
  );
  return rows;
}

export async function findConfig(id, client) {
  const { rows } = await query('SELECT id, version, params FROM scoring_configs WHERE id = $1', [id], client);
  return rows[0] ?? null;
}

const RUN_SUMMARY = `r.id, r.dataset_id, d.name AS dataset_name, r.config_id, c.version AS config_version, r.seed,
  to_json(r.created_at) AS created_at`;

export async function insertRun(run, client) {
  const { rows } = await query(
    `INSERT INTO evaluation_runs (dataset_id, config_id, seed, split, metrics, confusion)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      run.datasetId,
      run.configId,
      run.seed,
      JSON.stringify(run.split),
      JSON.stringify(run.metrics),
      JSON.stringify(run.confusion),
    ],
    client,
  );
  return rows[0].id;
}

/** Newest first, with the headline numbers (test set) for the list. */
export async function listRuns(client) {
  const { rows } = await query(
    `SELECT ${RUN_SUMMARY},
            r.metrics -> 'baseline' -> 'f1' AS baseline_f1, r.metrics -> 'nexivo' -> 'f1' AS nexivo_f1
       FROM evaluation_runs r
       JOIN research_datasets d ON d.id = r.dataset_id
       JOIN scoring_configs c ON c.id = r.config_id
      ORDER BY r.id DESC`,
    [],
    client,
  );
  return rows;
}

export async function findRun(id, client) {
  const { rows } = await query(
    `SELECT ${RUN_SUMMARY}, r.split, r.metrics, r.confusion
       FROM evaluation_runs r
       JOIN research_datasets d ON d.id = r.dataset_id
       JOIN scoring_configs c ON c.id = r.config_id
      WHERE r.id = $1`,
    [id],
    client,
  );
  return rows[0] ?? null;
}
