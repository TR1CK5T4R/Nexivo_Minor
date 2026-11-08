// HTTP side of the Nexivo research endpoints (/api/research/...). Same error
// shapes as the recovery endpoints.

import { createDataset, getRun, listDatasets, listRuns, runEvaluation } from '../services/research.service.js';
import { sendJson } from '../utils/djangoResponses.js';

export function createResearchController() {
  return {
    async listDatasets(req, res) {
      sendJson(res, 200, await listDatasets());
    },

    async createDataset(req, res) {
      const dataset = await createDataset(req.validated.body);
      req.log.info(
        { datasetId: dataset.id, source: dataset.source, rows: dataset.observation_count },
        'research dataset created',
      );
      sendJson(res, 201, dataset);
    },

    async listRuns(req, res) {
      sendJson(res, 200, await listRuns());
    },

    async createRun(req, res) {
      const run = await runEvaluation(req.validated.body);
      req.log.info({ runId: run.id, datasetId: run.dataset_id, seed: run.seed }, 'evaluation run finished');
      sendJson(res, 201, run);
    },

    async getRun(req, res) {
      sendJson(res, 200, await getRun(req.validated.params.id));
    },
  };
}
