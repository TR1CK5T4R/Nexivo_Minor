// HTTP side of E07 POST /login/ and E09 /patient/logout/ (Django's exact responses),
// and of the doctor login under /api/doctor/ (new, JSON).

import { sessionDoctorId } from '../middleware/auth.js';
import { authenticateDoctor, findGuest, findLoginPatient, normalizeLoginEmail } from '../services/auth.service.js';
import { sendJson, sendRedirect } from '../utils/djangoResponses.js';
import { LOGIN_SUCCESS_LOCATION } from '../middleware/rateLimit.js';

// express-session uses callbacks; these wrap them for async/await.
const regenerateSession = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
const destroySession = (req) =>
  new Promise((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));

/**
 * @param {{ sessionCookieName: string, guestLogin: boolean }} deps
 */
export function createAuthController({ sessionCookieName, guestLogin }) {
  return {
    /** Django parity: Patients/views.py:login (POST branch) */
    async login(req, res) {
      const email = normalizeLoginEmail(req.body?.email);
      const patient = await findLoginPatient(email);
      if (!patient) {
        // Not found: the existing session (if any) is left untouched, as in Django.
        req.log.info('login failed: unknown email');
        return sendRedirect(res, '/');
      }
      // Intentional difference (fixes): a new session id and no
      // leftover data (e.g. another patient's chat_history). Django reused the session.
      await regenerateSession(req);
      req.session.patient_id = patient.id;
      req.session.patient_email = patient.email;
      req.session.patient_name = patient.name;
      req.log.info({ patientId: patient.id }, 'patient logged in');
      // Django's SessionMiddleware adds Vary: Cookie whenever the session was accessed.
      res.vary('Cookie');
      sendRedirect(res, LOGIN_SUCCESS_LOCATION);
    },

    /** Django parity: Patients/views.py:patient_logout (session.flush(), any method) */
    async logout(req, res) {
      const patientId = req.session.patient_id;
      const hadCookie = req.cookies[sessionCookieName] !== undefined;
      await destroySession(req);
      res.vary('Cookie'); // flush() accesses the session (Django SessionMiddleware)
      // Django's SessionMiddleware deletes the cookie when the request carried
      // one and the session is now empty.
      if (hadCookie) res.clearCookie(sessionCookieName, { path: '/', sameSite: 'lax' });
      req.log.info({ patientId }, 'patient logged out');
      sendRedirect(res, '/');
    },

    async doctorLogin(req, res) {
      const doctor = await authenticateDoctor(req.validated.body.email, req.validated.body.password);
      if (!doctor) {
        req.log.info('doctor login failed');
        return sendJson(res, 401, { error: 'Invalid email or password' });
      }
      // A new session id, and any patient login in this browser ends here.
      await regenerateSession(req);
      req.session.doctor_id = doctor.id;
      req.session.doctor_email = doctor.email;
      req.session.doctor_name = doctor.name;
      req.log.info({ doctorId: doctor.id }, 'doctor logged in');
      sendJson(res, 200, { doctor });
    },

    async doctorLogout(req, res) {
      const doctorId = sessionDoctorId(req);
      const hadCookie = req.cookies[sessionCookieName] !== undefined;
      await destroySession(req);
      if (hadCookie) res.clearCookie(sessionCookieName, { path: '/', sameSite: 'lax' });
      req.log.info({ doctorId }, 'doctor logged out');
      sendJson(res, 200, { success: true });
    },

    /** "Continue as guest": a session for the guest doctor or guest patient, without a password. */
    async guestLogin(req, res) {
      const { role } = req.validated.body;
      const guest = guestLogin ? await findGuest(role) : null;
      if (!guest) return sendJson(res, 404, { error: 'Guest access is not available' });
      // Same session as a real login of that role, so every route treats the guest the same way.
      await regenerateSession(req);
      req.session[`${role}_id`] = guest.id;
      req.session[`${role}_email`] = guest.email;
      req.session[`${role}_name`] = guest.name;
      req.log.info({ role, id: guest.id }, 'guest logged in');
      sendJson(res, 200, { [role]: guest });
    },

    /** Who is logged in, for the frontend's route guard: 200 either way, so it logs no failed request. */
    doctorMe(req, res) {
      res.vary('Cookie');
      const id = sessionDoctorId(req);
      sendJson(res, 200, {
        doctor: id === null ? null : { id, name: req.session.doctor_name, email: req.session.doctor_email },
      });
    },
  };
}
