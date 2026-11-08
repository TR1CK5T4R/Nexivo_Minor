// Nexivo M6: research datasets and evaluation runs. Datasets never touch the
// clinical tables. Plain functions: no req/res, no SQL.

import { withTransaction } from '../db/tx.js';
import { CsvError, parseResearchCsv } from '../research/csv.js';
import { GENERATOR_DEFAULTS, generateDataset } from '../research/generator.js';
import { evaluatePredictions } from '../research/metrics.js';
import { replay } from '../research/replay.js';
import { findActiveConfig } from '../repositories/recovery.repository.js';
import {
  findConfig,
  findDataset,
  findRun,
  insertDataset,
  insertRun,
  listDatasetRows,
  listDatasets as listDatasetRowsSummary,
  listRuns as listRunRows,
} from '../repositories/research.repository.js';
import { AppError } from '../utils/httpErrors.js';
import { notFound } from './recovery.service.js';

/**
 * Import a CSV or generate a seeded synthetic dataset. Symptom columns follow
 * the active scoring config's symptom list.
 *
 * @param {{ name: string, source: 'csv', csv: string } | { name: string, source: 'synthetic', seed: number, patients: number }} body
 */
export async function createDataset(body) {
  const { params } = await findActiveConfig();
  let rows;
  let generatorOptions = null;
  if (body.source === 'csv') {
    try {
      rows = parseResearchCsv(body.csv, params.symptoms);
    } catch (err) {
      if (err instanceof CsvError) throw new AppError(400, { error: 'Invalid request', fields: { csv: err.message } });
      throw err;
    }
  } else {
    generatorOptions = { ...GENERATOR_DEFAULTS, patients: body.patients };
    rows = generateDataset(body.seed, generatorOptions, params.symptoms);
  }
  return withTransaction((client) =>
    insertDataset(
      { name: body.name, source: body.source, seed: body.source === 'synthetic' ? body.seed : null, generatorOptions },
      rows,
      client,
    ),
  );
}

export async function listDatasets() {
  return listDatasetRowsSummary();
}

/**
 * Replay a dataset through both engines (no look-ahead), split patients 30/70
 * with the seed, store and return the run. Deterministic: the same dataset,
 * config and seed give identical metrics.
 *
 * @param {{ dataset_id: number, seed: number, config_id?: number }} body
 */
export async function runEvaluation({ dataset_id: datasetId, seed, config_id: configId }) {
  const dataset = await findDataset(datasetId);
  if (!dataset) throw notFound('Dataset');
  const config = configId === undefined ? await findActiveConfig() : await findConfig(configId);
  if (!config) throw notFound('Scoring config');
  const rows = await listDatasetRows(datasetId);
  const { split, metrics, confusion } = evaluatePredictions(replay(rows, config.params), seed);
  const id = await insertRun({ datasetId, configId: config.id, seed, split, metrics, confusion });
  return findRun(id);
}

export async function listRuns() {
  return listRunRows();
}

export async function getRun(id) {
  const run = await findRun(id);
  if (!run) throw notFound('Evaluation run');
  return run;
}
