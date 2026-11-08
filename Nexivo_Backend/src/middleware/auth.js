// Auth guards. The Django-era patient views each check
// `request.session.get('patient_id')` and answer in their own way (E08: 401 JSON;
// E11: 200 {"success": false, ...}), so requirePatient takes the endpoint's own
// "not logged in" response. Nexivo and doctor routes answer in one way: 401 without
// a login, 403 when the login doesn't give access. A session is either a patient's
// or a doctor's: each login regenerates it.

import { clearDeadSessionCookie } from './session.js';
import { sendJson } from '../utils/djangoResponses.js';

/**
 * The logged-in patient's id, or null. Mirrors Python truthiness of
 * `request.session.get('patient_id')` (missing, None, 0 → not logged in).
 *
 * @param {import('express').Request} req
 * @returns {number | null}
 */
export function sessionPatientId(req) {
  const id = req.session?.patient_id;
  return id ? id : null;
}

/**
 * The logged-in doctor's id, or null.
 *
 * @param {import('express').Request} req
 * @returns {number | null}
 */
export function sessionDoctorId(req) {
  return req.session?.doctor_id ?? null;
}

const notAuthenticated = (res) => sendJson(res, 401, { error: 'Not authenticated' });

/**
 * Nexivo /api/patients/:id/... routes: a doctor reaches any patient, a patient only
 * their own id. Runs after validate(), which parsed :id into req.validated.params.id.
 *
 * @type {import('express').RequestHandler}
 */
export function ownPatientOnly(req, res, next) {
  res.vary('Cookie');
  if (sessionDoctorId(req) !== null) return next();
  const own = sessionPatientId(req);
  if (own === null) return notAuthenticated(res);
  if (own !== req.validated.params.id) return sendJson(res, 403, { error: 'Forbidden' });
  next();
}

/**
 * Routes where the service checks the owner, because the patient is only known
 * from the row (corrections, alerts, milestones): a login is all that's needed here.
 *
 * @type {import('express').RequestHandler}
 */
export function requireLogin(req, res, next) {
  res.vary('Cookie');
  if (sessionDoctorId(req) === null && sessionPatientId(req) === null) return notAuthenticated(res);
  next();
}

/**
 * Doctor-only routes (adding patients, overview, new config versions, research).
 * shortcut: the session is trusted until it expires, so deactivating a doctor only takes effect at their next login; check users.is_active here if doctors can ever be deactivated in the app.
 *
 * @type {import('express').RequestHandler}
 */
export function requireDoctor(req, res, next) {
  res.vary('Cookie');
  if (sessionDoctorId(req) !== null) return next();
  if (sessionPatientId(req) !== null) return sendJson(res, 403, { error: 'Forbidden' });
  notAuthenticated(res);
}

/**
 * Let the request through only if the session has a patient_id.
 * Either way the session was read, so the response varies by cookie (Django's
 * SessionMiddleware adds `Vary: Cookie`). When there's no patient, a dead
 * session cookie is deleted first, as Django does.
 *
 * @param {import('express').RequestHandler} onUnauthenticated the endpoint's Django response
 * @param {string} sessionCookieName
 * @returns {import('express').RequestHandler}
 */
export function requirePatient(onUnauthenticated, sessionCookieName) {
  return (req, res, next) => {
    res.vary('Cookie');
    if (sessionPatientId(req) !== null) return next();
    clearDeadSessionCookie(req, res, sessionCookieName);
    onUnauthenticated(req, res, next);
  };
}
