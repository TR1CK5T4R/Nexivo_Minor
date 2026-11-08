// HTTP side of the Nexivo recovery endpoints (/api/...). Errors follow the E23
// contract: 400 {"error": "Invalid request", "fields": {...}}, 403/404/409 {"error": "..."}.

import { sessionPatientId } from '../middleware/auth.js';
import { correctObservation, createObservation, listObservations } from '../services/observation.service.js';
import {
  addMilestone,
  createConfig,
  getActiveConfig,
  getLatestScore,
  getOverview,
  getProfile,
  listAlerts,
  listMilestones,
  listScores,
  saveProfile,
  setMilestoneDone,
  updateAlertStatus,
} from '../services/recovery.service.js';
import { getTimeline } from '../services/timeline.service.js';
import { sendJson } from '../utils/djangoResponses.js';
import { fieldErrors } from '../validators/exercise.validators.js';

// The logged-in patient, or null for a clinician request (no clinician login yet).
const actor = (req) => ({ patientId: sessionPatientId(req) });

export function createRecoveryController() {
  return {
    /** validate()'s onInvalid, and the handler for a body that isn't JSON. */
    invalid(error, req, res) {
      sendJson(res, 400, {
        error: 'Invalid request',
        fields: error ? fieldErrors(error) : { body: 'must be a JSON object' },
      });
    },

    async getConfig(req, res) {
      sendJson(res, 200, await getActiveConfig());
    },

    async createConfig(req, res) {
      const config = await createConfig(req.validated.body);
      req.log.info({ configId: config.id, version: config.version }, 'scoring config activated');
      sendJson(res, 201, config);
    },

    async getProfile(req, res) {
      sendJson(res, 200, await getProfile(req.validated.params.id));
    },

    async putProfile(req, res) {
      const { profile, created } = await saveProfile(req.validated.params.id, req.validated.body);
      req.log.info({ patientId: profile.patient_id, created }, 'recovery profile saved');
      sendJson(res, created ? 201 : 200, profile);
    },

    async listObservations(req, res) {
      sendJson(res, 200, await listObservations(req.validated.params.id, req.validated.query));
    },

    async createObservation(req, res) {
      const result = await createObservation(req.validated.params.id, req.validated.body, actor(req));
      req.log.info(
        { patientId: result.observation.patient_id, observationId: result.observation.id },
        'observation saved',
      );
      sendJson(res, 201, result);
    },

    async correctObservation(req, res) {
      const result = await correctObservation(req.validated.params.id, req.validated.body, actor(req));
      req.log.info(
        {
          patientId: result.observation.patient_id,
          observationId: result.observation.id,
          corrects: req.validated.params.id,
        },
        'observation corrected',
      );
      sendJson(res, 201, result);
    },

    async listMilestones(req, res) {
      sendJson(res, 200, await listMilestones(req.validated.params.id));
    },

    async addMilestone(req, res) {
      sendJson(res, 201, await addMilestone(req.validated.params.id, req.validated.body));
    },

    async latestScore(req, res) {
      sendJson(res, 200, await getLatestScore(req.validated.params.id));
    },

    async listScores(req, res) {
      sendJson(res, 200, await listScores(req.validated.params.id, req.validated.query));
    },

    async timeline(req, res) {
      sendJson(res, 200, await getTimeline(req.validated.params.id, req.validated.query));
    },

    async overview(req, res) {
      sendJson(res, 200, await getOverview());
    },

    async listAlerts(req, res) {
      sendJson(res, 200, await listAlerts(req.validated.params.id, req.validated.query.status));
    },

    async patchAlert(req, res) {
      const alert = await updateAlertStatus(req.validated.params.id, req.validated.body.status, actor(req));
      req.log.info({ patientId: alert.patient_id, alertId: alert.id, status: alert.status }, 'alert status changed');
      sendJson(res, 200, alert);
    },

    async patchMilestone(req, res) {
      sendJson(res, 200, await setMilestoneDone(req.validated.params.id, req.validated.body.completed, actor(req)));
    },
  };
}
