// "Continue as guest": GUEST_LOGIN turns it on, and a guest session behaves like a real login of that role.
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { upsertDoctor } from '../../src/repositories/doctor.repository.js';
import { GUEST_ACCOUNTS } from '../../src/services/auth.service.js';
import { makeApp } from '../helpers/app.js';
import { createPatient, truncateAll } from '../helpers/db.js';
import { apiClient } from '../helpers/nexivo.js';

let guestPatient;
beforeEach(async () => {
  await truncateAll();
  guestPatient = await createPatient({ name: 'Guest Patient', email: GUEST_ACCOUNTS.patient });
  await createPatient({ email: 'asha@example.test' });
  await upsertDoctor({
    name: 'Guest Doctor',
    email: GUEST_ACCOUNTS.doctor,
    passwordHash: '!unusable',
    specialty: 'Orthopaedics',
    licenseNumber: 'GUEST-0001',
  });
});

const guestApp = () => makeApp({ GUEST_LOGIN: 'true' }).app;

describe('POST /api/guest/login', () => {
  it('is off unless GUEST_LOGIN=true: 404, no session', async () => {
    const c = await apiClient(makeApp().app, null);
    const res = await c.post('/api/guest/login', { role: 'doctor' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Guest access is not available' });
    expect((await query('SELECT count(*)::int AS n FROM sessions')).rows[0].n).toBe(0);
  });

  it('a guest doctor reaches the doctor routes', async () => {
    const c = await apiClient(guestApp(), null);
    const res = await c.post('/api/guest/login', { role: 'doctor' });
    expect(res.status).toBe(200);
    expect(res.body.doctor).toMatchObject({ name: 'Guest Doctor', email: GUEST_ACCOUNTS.doctor });
    expect((await c.get('/api/doctor/me')).body.doctor.email).toBe(GUEST_ACCOUNTS.doctor);
    expect((await c.get('/api/clinician/overview')).status).toBe(200);
  });

  it('a guest patient is the guest patient only: own data yes, others and doctor routes no', async () => {
    const c = await apiClient(guestApp(), null);
    expect((await c.post('/api/guest/login', { role: 'patient' })).status).toBe(200);
    expect((await c.get('/patient/dashboard/')).body.patient.email).toBe(GUEST_ACCOUNTS.patient);
    expect((await c.get(`/api/patients/${guestPatient.id}/alerts`)).status).toBe(200);
    expect((await c.get(`/api/patients/${guestPatient.id + 1}/alerts`)).status).toBe(403);
    expect((await c.get('/api/clinician/overview')).status).toBe(403);
  });

  it('switching role replaces the session', async () => {
    const c = await apiClient(guestApp(), null);
    await c.post('/api/guest/login', { role: 'doctor' });
    await c.post('/api/guest/login', { role: 'patient' });
    expect((await c.get('/api/doctor/me')).body).toEqual({ doctor: null });
    expect((await c.get('/api/clinician/overview')).status).toBe(403);
  });

  it('404 when the guest account is missing or deactivated', async () => {
    await query("UPDATE users SET is_active = false WHERE email = $1 AND role = 'doctor'", [GUEST_ACCOUNTS.doctor]);
    const c = await apiClient(guestApp(), null);
    expect((await c.post('/api/guest/login', { role: 'doctor' })).status).toBe(404);
  });

  it('400 for an unknown role; the guest doctor has no password that works', async () => {
    const c = await apiClient(guestApp(), null);
    expect((await c.post('/api/guest/login', { role: 'admin' })).status).toBe(400);
    const login = await c.post('/api/doctor/login', { email: GUEST_ACCOUNTS.doctor, password: '!unusable' });
    expect(login.status).toBe(401);
  });
});
