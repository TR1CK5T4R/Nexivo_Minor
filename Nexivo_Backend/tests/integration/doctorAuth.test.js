// Doctor login, and which routes it opens: every route that used to treat "no patient
// session" as a clinician now answers 401 without a login.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { makeApp } from '../helpers/app.js';
import { setCookies } from '../helpers/cookies.js';
import { createDoctor, createPatient, TEST_DOCTOR, truncateAll } from '../helpers/db.js';
import { apiClient, daysAgoDate } from '../helpers/nexivo.js';

let app;
let asha;
beforeEach(async () => {
  await truncateAll();
  ({ app } = makeApp());
  await createDoctor();
  asha = await createPatient({ email: 'asha@example.test' });
});

const credentials = { email: TEST_DOCTOR.email, password: TEST_DOCTOR.password };

describe('POST /api/doctor/login', () => {
  it('logs in with a new session, whatever the email case; /me and logout follow', async () => {
    const c = await apiClient(app, null);
    expect((await c.get('/api/doctor/me')).body).toEqual({ doctor: null });

    const res = await c.post('/api/doctor/login', { ...credentials, email: ' DOCTOR@Example.test ' });
    expect(res.status).toBe(200);
    expect(res.body.doctor).toMatchObject({ name: TEST_DOCTOR.name, email: TEST_DOCTOR.email });
    expect(res.body.doctor.password).toBeUndefined();
    expect(setCookies(res).sessionid.attributes.httponly).toBe(true);
    expect((await c.get('/api/doctor/me')).body.doctor.email).toBe(TEST_DOCTOR.email);
    expect((await c.get('/api/clinician/overview')).status).toBe(200);

    expect((await c.post('/api/doctor/logout')).body).toEqual({ success: true });
    expect((await c.get('/api/doctor/me')).body).toEqual({ doctor: null });
    expect((await c.get('/api/clinician/overview')).status).toBe(401);
  });

  it.each([
    ['a wrong password', { ...credentials, password: 'wrong' }],
    ['an unknown email', { ...credentials, email: 'nobody@example.test' }],
    ["a patient's email", { ...credentials, email: 'asha@example.test' }],
  ])('401 with the same answer for %s, and no session', async (_, body) => {
    const c = await apiClient(app, null);
    const res = await c.post('/api/doctor/login', body);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
    expect((await query('SELECT count(*) AS n FROM sessions')).rows[0].n).toBe(0);
  });

  it('401 for a deactivated doctor with the right password', async () => {
    await query('UPDATE users SET is_active = false WHERE email = $1', [TEST_DOCTOR.email]);
    expect((await (await apiClient(app, null)).post('/api/doctor/login', credentials)).status).toBe(401);
  });

  it('400 for a missing password; 403 without the CSRF token', async () => {
    const c = await apiClient(app, null);
    expect((await c.post('/api/doctor/login', { email: TEST_DOCTOR.email })).status).toBe(400);
    expect((await request(app).post('/api/doctor/login').send(credentials)).status).toBe(403);
  });

  it('counts failed attempts per client and answers 429 in JSON; a success does not count', async () => {
    ({ app } = makeApp({ LOGIN_RATE_LIMIT_MAX: '2' }));
    const c = await apiClient(app, null);
    expect((await c.post('/api/doctor/login', credentials)).status).toBe(200);
    await c.post('/api/doctor/login', { ...credentials, password: 'x' });
    await c.post('/api/doctor/login', { ...credentials, password: 'x' });
    const blocked = await c.post('/api/doctor/login', credentials);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many login attempts/);
  });

  it('a patient login replaces a doctor session, and the other way round', async () => {
    const c = await apiClient(app, null);
    await c.post('/api/doctor/login', credentials);
    await c.post('/login/').type('form').send({ email: 'asha@example.test' });
    expect((await c.get('/api/doctor/me')).body).toEqual({ doctor: null });
    expect((await c.get('/api/clinician/overview')).status).toBe(403);

    await c.post('/api/doctor/login', credentials);
    expect((await c.get('/patient/dashboard/')).status).toBe(401);
    expect((await c.get('/api/clinician/overview')).status).toBe(200);
  });

  it('a doctor session stays alive after a request to a patient-only route', async () => {
    const c = await apiClient(app);
    const res = await c.get('/patient/dashboard/');
    expect(res.status).toBe(401);
    expect(setCookies(res).sessionid).toBeUndefined();
    expect((await c.get('/api/clinician/overview')).status).toBe(200);
  });
});

describe('who reaches what', () => {
  // Every doctor-only route, then every patient route, in the three login states.
  const doctorOnly = [
    ['get', '/api/clinician/overview'],
    ['post', '/api/config/scoring', { version: 'x', params: {} }],
    ['get', '/api/research/datasets'],
    ['post', '/api/research/datasets', { name: 'x', source: 'synthetic', seed: 1, patients: 1 }],
    ['get', '/api/research/evaluations'],
    ['post', '/api/research/evaluations', { dataset_id: 1, seed: 1 }],
    ['get', '/api/research/evaluations/1'],
  ];
  const patientRoutes = (id) => [
    ['get', `/api/patients/${id}/recovery-profile`],
    ['put', `/api/patients/${id}/recovery-profile`, { surgery_date: daysAgoDate(3) }],
    ['get', `/api/patients/${id}/observations`],
    ['post', `/api/patients/${id}/observations`, { pain: 1, mobility: 1, fatigue: 1, symptoms: {} }],
    ['get', `/api/patients/${id}/milestones`],
    ['post', `/api/patients/${id}/milestones`, { name: 'x', target_day: 1 }],
    ['get', `/api/patients/${id}/scores/latest`],
    ['get', `/api/patients/${id}/scores`],
    ['get', `/api/patients/${id}/timeline`],
    ['get', `/api/patients/${id}/alerts`],
  ];
  const byRowId = [
    ['post', '/api/observations/1/corrections', { pain: 1 }],
    ['patch', '/api/alerts/1', { status: 'resolved' }],
    ['patch', '/api/milestones/1', { completed: true }],
  ];
  const call = (c, [method, url, body]) => c[method](url, body);

  it('without a login: 401 everywhere, nothing written', async () => {
    const c = await apiClient(app, null);
    for (const route of [...doctorOnly, ...patientRoutes(asha.id), ...byRowId]) {
      expect((await call(c, route)).status, route[1]).toBe(401);
    }
    expect((await query('SELECT count(*) AS n FROM recovery_profiles')).rows[0].n).toBe(0);
    expect((await query('SELECT count(*) AS n FROM research_datasets')).rows[0].n).toBe(0);
  });

  it('a patient: 403 on doctor-only routes and on another patient, through on their own', async () => {
    const ravi = await createPatient({ email: 'ravi@example.test' });
    const c = await apiClient(app, 'asha@example.test');
    for (const route of doctorOnly) expect((await call(c, route)).status, route[1]).toBe(403);
    for (const route of patientRoutes(ravi.id)) expect((await call(c, route)).status, route[1]).toBe(403);
    for (const route of patientRoutes(asha.id).filter(([m]) => m === 'get')) {
      expect((await call(c, route)).status, route[1]).not.toBe(401);
      expect((await call(c, route)).status, route[1]).not.toBe(403);
    }
  });

  it('a doctor: through on doctor-only routes and on any patient', async () => {
    const c = await apiClient(app);
    for (const route of [...doctorOnly, ...patientRoutes(asha.id), ...byRowId]) {
      const { status } = await call(c, route);
      expect(status, route[1]).not.toBe(401);
      expect(status, route[1]).not.toBe(403);
    }
  });

  it('the public config read and the health check still need no login', async () => {
    expect((await request(app).get('/api/config/scoring')).status).toBe(200);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});
