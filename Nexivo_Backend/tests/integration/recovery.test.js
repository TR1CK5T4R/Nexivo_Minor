// Nexivo M1 (Phase 2): recovery profile, append-only observations, corrections,
// milestones and the seeded scoring config, under /api/.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { dayPostOp } from '../../src/services/observation.service.js';
import { makeApp } from '../helpers/app.js';
import { createPatient, truncateAll } from '../helpers/db.js';
import { apiClient, daysAgoDate, hoursAgo } from '../helpers/nexivo.js';

let app;
let asha;
let ravi;
beforeEach(async () => {
  await truncateAll();
  ({ app } = makeApp());
  asha = await createPatient({ email: 'asha@example.test' });
  ravi = await createPatient({ email: 'ravi@example.test' });
});

const client = (email) => apiClient(app, email);

const checkIn = (overrides = {}) => ({ pain: 4, mobility: 6, fatigue: 3, symptoms: { swelling: 1 }, ...overrides });

async function withProfile(c, patient, body = { surgery_date: daysAgoDate(10), surgery_type: 'Knee replacement' }) {
  const res = await c.put(`/api/patients/${patient.id}/recovery-profile`, body);
  expect(res.status).toBe(201);
  return res.body;
}

describe('dayPostOp', () => {
  it('counts whole UTC calendar days from the surgery date', () => {
    expect(dayPostOp('2026-11-01T00:00:00Z', '2026-11-01')).toBe(0);
    expect(dayPostOp('2026-11-01T23:59:59Z', '2026-11-01')).toBe(0);
    expect(dayPostOp('2026-11-11T08:00:00+05:30', '2026-11-01')).toBe(10);
    expect(dayPostOp('2026-10-31T23:00:00Z', '2026-11-01')).toBe(-1);
  });
});

describe('GET /api/config/scoring', () => {
  it('returns the seeded spec defaults (nexivo-1.0), weights summing to 1', async () => {
    const res = await (await client()).get('/api/config/scoring');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('nexivo-1.0');
    const sum = Object.values(res.body.params.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(res.body.params.symptoms).toEqual(['fever', 'wound_redness', 'swelling', 'nausea', 'breathlessness']);
  });
});

describe('recovery profile', () => {
  it('404 before it exists; PUT creates it (201) with the config default and the generic milestone plan', async () => {
    const c = await client();
    expect((await c.get(`/api/patients/${asha.id}/recovery-profile`)).status).toBe(404);
    const profile = await withProfile(c, asha);
    expect(profile).toMatchObject({
      patient_id: asha.id,
      surgery_type: 'Knee replacement',
      expected_recovery_days: 42,
    });
    const milestones = (await c.get(`/api/patients/${asha.id}/milestones`)).body;
    expect(milestones.map((m) => m.target_day)).toEqual([7, 14, 28, 42]);
  });

  it('a second PUT replaces the profile (200) and does not duplicate milestones', async () => {
    const c = await client();
    await withProfile(c, asha);
    const res = await c.put(`/api/patients/${asha.id}/recovery-profile`, {
      surgery_date: daysAgoDate(10),
      expected_recovery_days: 60,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ expected_recovery_days: 60, surgery_type: null });
    expect((await c.get(`/api/patients/${asha.id}/milestones`)).body).toHaveLength(4);
  });

  it('refuses to move surgery_date once check-ins exist (409)', async () => {
    const c = await client();
    await withProfile(c, asha);
    await c.post(`/api/patients/${asha.id}/observations`, checkIn());
    const res = await c.put(`/api/patients/${asha.id}/recovery-profile`, { surgery_date: daysAgoDate(5) });
    expect(res.status).toBe(409);
  });

  it('400 for a bad date, 404 for an unknown patient, 400 for a bad id', async () => {
    const c = await client();
    const bad = await c.put(`/api/patients/${asha.id}/recovery-profile`, { surgery_date: '2026-13-40' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'Invalid request', fields: { surgery_date: expect.any(String) } });
    expect((await c.put('/api/patients/999999/recovery-profile', { surgery_date: daysAgoDate(1) })).status).toBe(404);
    expect((await c.get('/api/patients/abc/recovery-profile')).status).toBe(400);
  });
});

describe('POST /api/patients/:id/observations', () => {
  it('stores a check-in: day_post_op computed, every symptom stored, clinician source without login', async () => {
    const c = await client();
    await withProfile(c, asha);
    const res = await c.post(`/api/patients/${asha.id}/observations`, checkIn());
    expect(res.status).toBe(201);
    // 0.25×60 + 0.20×60 + 0.15×70 + 0.15×93.33 (one mild of 5 symptoms) + 0.15×100 (nothing prescribed)
    // + 0.10×0 (the day-7 milestone is due, not done) = 66.5; no earlier check-ins → limited-history bands.
    expect(res.body.score).toMatchObject({ category: 'normal', limited_history: true, baseline: null });
    expect(res.body.score.composite).toBeCloseTo(66.5, 9);
    expect(res.body.alerts).toEqual([]);
    expect(res.body.observation).toMatchObject({
      patient_id: asha.id,
      day_post_op: 10,
      pain: 4,
      mobility: 6,
      fatigue: 3,
      symptoms: { fever: 0, wound_redness: 0, swelling: 1, nausea: 0, breathlessness: 0 },
      doses_prescribed: 0,
      doses_taken: 0,
      source: 'clinician',
      entered_by: null,
      corrects_observation_id: null,
    });
  });

  it('a logged-in patient records their own check-in with source patient and their user id', async () => {
    await withProfile(await client(), asha);
    const res = await (await client('asha@example.test')).post(`/api/patients/${asha.id}/observations`, checkIn());
    expect(res.status).toBe(201);
    expect(res.body.observation).toMatchObject({ source: 'patient', entered_by: asha.userId });
  });

  it('400 without a recovery profile', async () => {
    const res = await (await client()).post(`/api/patients/${asha.id}/observations`, checkIn());
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty('recovery_profile');
  });

  it.each([
    ['pain above 10', checkIn({ pain: 11 }), 'pain'],
    ['mobility not an integer', checkIn({ mobility: 5.5 }), 'mobility'],
    ['missing fatigue', { pain: 1, mobility: 1 }, 'fatigue'],
    ['symptom severity above 3', checkIn({ symptoms: { fever: 4 } }), 'symptoms.fever'],
    ['unknown symptom', checkIn({ symptoms: { hiccups: 1 } }), 'symptoms.hiccups'],
    ['more doses taken than prescribed', checkIn({ doses_prescribed: 2, doses_taken: 3 }), 'doses_taken'],
    ['observed in the future', checkIn({ observed_at: new Date(Date.now() + 3_600_000).toISOString() }), 'observed_at'],
    ['observed before the surgery', checkIn({ observed_at: hoursAgo(24 * 30) }), 'observed_at'],
  ])('400 for %s', async (_case, body, field) => {
    const c = await client();
    await withProfile(c, asha);
    const res = await c.post(`/api/patients/${asha.id}/observations`, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
    expect(res.body.fields).toHaveProperty([field]);
    const { rows } = await query('SELECT count(*)::int AS n FROM recovery_observations');
    expect(rows[0].n).toBe(0);
  });

  it('400 for a body that is not JSON', async () => {
    const c = await client();
    await withProfile(c, asha);
    const res = await c.post(`/api/patients/${asha.id}/observations`, '{not json').type('application/json');
    expect(res.status).toBe(400);
    expect(res.body.fields).toEqual({ body: 'must be a JSON object' });
  });

  it('403 without the CSRF token', async () => {
    const res = await request(app).post(`/api/patients/${asha.id}/observations`).send(checkIn());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/patients/:id/observations', () => {
  it('lists oldest first and filters by from/to (inclusive)', async () => {
    const c = await client();
    await withProfile(c, asha);
    for (const h of [72, 48, 24])
      await c.post(`/api/patients/${asha.id}/observations`, checkIn({ observed_at: hoursAgo(h) }));
    const all = (await c.get(`/api/patients/${asha.id}/observations`)).body;
    expect(all.map((o) => o.day_post_op)).toEqual([7, 8, 9]);
    const from = encodeURIComponent(all[1].observed_at);
    const some = (await c.get(`/api/patients/${asha.id}/observations?from=${from}`)).body;
    expect(some.map((o) => o.id)).toEqual([all[1].id, all[2].id]);
    expect((await c.get(`/api/patients/${asha.id}/observations?from=yesterday`)).status).toBe(400);
  });
});

describe('corrections (append-only)', () => {
  it('inserts a new version; lists show only the latest; the original row is untouched', async () => {
    const c = await client();
    await withProfile(c, asha);
    const original = (await c.post(`/api/patients/${asha.id}/observations`, checkIn())).body.observation;

    const res = await c.post(`/api/observations/${original.id}/corrections`, { pain: 2, notes: 'typo fixed' });
    expect(res.status).toBe(201);
    expect(res.body.observation).toMatchObject({
      corrects_observation_id: original.id,
      pain: 2,
      mobility: original.mobility,
      observed_at: original.observed_at,
      symptoms: original.symptoms,
      notes: 'typo fixed',
    });

    const listed = (await c.get(`/api/patients/${asha.id}/observations`)).body;
    expect(listed.map((o) => o.id)).toEqual([res.body.observation.id]);
    const { rows } = await query('SELECT id, pain, notes FROM recovery_observations ORDER BY id');
    expect(rows).toEqual([
      { id: original.id, pain: 4, notes: null },
      { id: res.body.observation.id, pain: 2, notes: 'typo fixed' },
    ]);
  });

  it('409 when correcting a version that was already corrected; the latest can be corrected again', async () => {
    const c = await client();
    await withProfile(c, asha);
    const v1 = (await c.post(`/api/patients/${asha.id}/observations`, checkIn())).body.observation;
    const v2 = (await c.post(`/api/observations/${v1.id}/corrections`, { pain: 2 })).body.observation;
    expect((await c.post(`/api/observations/${v1.id}/corrections`, { pain: 3 })).status).toBe(409);
    const v3 = await c.post(`/api/observations/${v2.id}/corrections`, { pain: 3 });
    expect(v3.status).toBe(201);
    expect((await c.get(`/api/patients/${asha.id}/observations`)).body.map((o) => o.pain)).toEqual([3]);
  });

  it('400 for an empty correction or merged doses that do not add up; 404 for an unknown id', async () => {
    const c = await client();
    await withProfile(c, asha);
    const o = (await c.post(`/api/patients/${asha.id}/observations`, checkIn({ doses_prescribed: 2, doses_taken: 2 })))
      .body.observation;
    expect((await c.post(`/api/observations/${o.id}/corrections`, {})).status).toBe(400);
    const doses = await c.post(`/api/observations/${o.id}/corrections`, { doses_prescribed: 1 });
    expect(doses.status).toBe(400);
    expect(doses.body.fields).toHaveProperty('doses_taken');
    expect((await c.post('/api/observations/999999/corrections', { pain: 1 })).status).toBe(404);
  });
});

describe('patient isolation', () => {
  it("a logged-in patient gets 403 on another patient's data", async () => {
    const clinician = await client();
    await withProfile(clinician, asha);
    await withProfile(clinician, ravi);
    const raviObs = (await clinician.post(`/api/patients/${ravi.id}/observations`, checkIn())).body.observation;
    const raviMilestone = (await clinician.get(`/api/patients/${ravi.id}/milestones`)).body[0];

    const c = await client('asha@example.test');
    expect((await c.get(`/api/patients/${ravi.id}/observations`)).status).toBe(403);
    expect((await c.get(`/api/patients/${ravi.id}/recovery-profile`)).status).toBe(403);
    expect((await c.post(`/api/patients/${ravi.id}/observations`, checkIn())).status).toBe(403);
    expect((await c.post(`/api/observations/${raviObs.id}/corrections`, { pain: 1 })).status).toBe(403);
    expect((await c.patch(`/api/milestones/${raviMilestone.id}`, { completed: true })).status).toBe(403);
    expect((await c.get(`/api/patients/${asha.id}/observations`)).status).toBe(200);
  });
});

describe('milestones', () => {
  it('adds a milestone, marks it complete and un-complete', async () => {
    const c = await client();
    const added = await c.post(`/api/patients/${asha.id}/milestones`, { name: 'Climb stairs', target_day: 21 });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ name: 'Climb stairs', target_day: 21, completed_at: null });

    const done = await c.patch(`/api/milestones/${added.body.id}`, { completed: true });
    expect(done.status).toBe(200);
    expect(Date.parse(done.body.completed_at)).not.toBeNaN();
    expect((await c.patch(`/api/milestones/${added.body.id}`, { completed: false })).body.completed_at).toBeNull();
  });

  it('400 for bad input, 404 for an unknown milestone or patient', async () => {
    const c = await client();
    expect((await c.post(`/api/patients/${asha.id}/milestones`, { name: '', target_day: 5 })).status).toBe(400);
    expect((await c.patch('/api/milestones/999999', { completed: true })).status).toBe(404);
    expect((await c.patch('/api/milestones/1', { completed: 'yes' })).status).toBe(400);
    expect((await c.get('/api/patients/999999/milestones')).status).toBe(404);
  });
});
