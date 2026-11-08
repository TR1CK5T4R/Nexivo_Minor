// Nexivo M5 (Phase 6): score history, timeline and the clinician overview.
import { beforeEach, describe, expect, it } from 'vitest';
import { makeApp } from '../helpers/app.js';
import { createPatient, truncateAll } from '../helpers/db.js';
import { apiClient, daysAgoDate, hoursAgo } from '../helpers/nexivo.js';

let app;
let c; // doctor client
let asha;
beforeEach(async () => {
  await truncateAll();
  ({ app } = makeApp());
  c = await apiClient(app);
  asha = await patientWithProfile('asha@example.test', 'Asha');
});

async function patientWithProfile(email, name) {
  const p = await createPatient({ email, name });
  await c.put(`/api/patients/${p.id}/recovery-profile`, { surgery_date: daysAgoDate(10), surgery_type: 'Knee' });
  return p;
}
// Days 5-9 after surgery (10 days ago).
const DAY = { 5: 120, 6: 96, 7: 72, 8: 48, 9: 24 };
const checkIn = async (patient, day, overrides = {}) => {
  const res = await c.post(`/api/patients/${patient.id}/observations`, {
    pain: 2,
    mobility: 8,
    fatigue: 2,
    ...overrides,
    observed_at: hoursAgo(DAY[day]),
  });
  expect(res.status).toBe(201);
  return res.body;
};

describe('GET /api/patients/:id/scores', () => {
  it('one score per current check-in, oldest first, with the expected curve and factors', async () => {
    await checkIn(asha, 7);
    const day5 = await checkIn(asha, 5); // back-dated
    const day9 = await checkIn(asha, 9, { pain: 4 });
    await c.post(`/api/observations/${day9.observation.id}/corrections`, { pain: 3 });

    const scores = (await c.get(`/api/patients/${asha.id}/scores`)).body;
    expect(scores.map((s) => s.day_post_op)).toEqual([5, 7, 9]);
    expect(scores[0].observation_id).toBe(day5.observation.id);
    expect(scores[2].contributions.find((f) => f.parameter === 'pain').raw_value).toBe(3); // the corrected value
    expect(scores[1].expected).toBeCloseTo(40 + (45 * 7) / 42, 9);

    const from = encodeURIComponent(scores[1].observed_at);
    expect((await c.get(`/api/patients/${asha.id}/scores?from=${from}`)).body).toHaveLength(2);
  });
});

describe('GET /api/patients/:id/timeline', () => {
  it('merges check-ins (with scores), alerts and milestone events in time order', async () => {
    await checkIn(asha, 6);
    // Pain +4 and the day-7 milestone newly due: a pain alert and a 20-point score drop.
    await checkIn(asha, 8, { pain: 6 });
    const milestone = (await c.get(`/api/patients/${asha.id}/milestones`)).body[0]; // day 7
    await c.patch(`/api/milestones/${milestone.id}`, { completed: true });

    const events = (await c.get(`/api/patients/${asha.id}/timeline`)).body;
    expect(events.map((e) => e.kind)).toEqual([
      'check_in',
      'milestone_due',
      'check_in',
      'alert',
      'alert',
      'milestone_completed',
    ]);
    const times = events.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(events[0].score).toMatchObject({ observation_id: events[0].observation.id, category: expect.any(String) });
    expect(events[1].milestone).toMatchObject({ target_day: 7 });
    expect(events[1].at).toBe(`${daysAgoDate(3)}T00:00:00.000Z`);
    expect(
      events
        .slice(3, 5)
        .map((e) => e.alert.type)
        .sort(),
    ).toEqual(['SCORE_DROP', 'SUDDEN_DETERIORATION']);

    const from = encodeURIComponent(events[2].at);
    expect((await c.get(`/api/patients/${asha.id}/timeline?from=${from}`)).body.map((e) => e.kind)).toEqual([
      'check_in',
      'alert',
      'alert',
      'milestone_completed',
    ]);
  });
});

describe('GET /api/clinician/overview', () => {
  it('lists patients with a recovery profile, most urgent first', async () => {
    const ravi = await patientWithProfile('ravi@example.test', 'Ravi');
    const meera = await patientWithProfile('meera@example.test', 'Meera'); // no check-ins yet
    const noor = await patientWithProfile('noor@example.test', 'Noor');
    await createPatient({ email: 'jo@example.test', name: 'Jo (no profile)' });

    // Noor: two good check-ins → Normal.
    for (const day of [5, 6]) await checkIn(noor, day, { pain: 0, mobility: 10, fatigue: 0 });
    // Ravi: pain stuck at 3 for five check-ins → no improvement (medium) → Slower than expected.
    for (const day of [5, 6, 7, 8, 9]) await checkIn(ravi, day, { pain: 3 });
    // Asha: pain 1 then 8 → sudden deterioration and a score drop → Requires attention.
    for (const day of [5, 6, 7]) await checkIn(asha, day, { pain: 1 });
    await checkIn(asha, 8, { pain: 8 });

    const rows = (await c.get('/api/clinician/overview')).body;
    expect(rows.map((r) => [r.name, r.category])).toEqual([
      ['Asha', 'attention'],
      ['Ravi', 'slower'],
      ['Noor', 'normal'],
      ['Meera', null],
    ]);
    expect(rows[0]).toMatchObject({ patient_id: asha.id, surgery_type: 'Knee', day_post_op: 8, open_alerts: 2 });
    expect(rows[0].slope).toBeLessThan(0);
    expect(Date.parse(rows[0].last_check_in)).not.toBeNaN();
    expect(rows[3]).toMatchObject({ patient_id: meera.id, composite: null, last_check_in: null, open_alerts: 0 });
  });

  it('is not available to a logged-in patient (it lists everyone)', async () => {
    const patient = await apiClient(app, 'asha@example.test');
    expect((await patient.get('/api/clinician/overview')).status).toBe(403);
    expect((await patient.post('/api/config/scoring', { version: 'x', params: {} })).status).toBe(403);
  });
});
