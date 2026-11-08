// Nexivo M3 (Phase 4): alerts stored with check-ins, de-duplicated, acknowledged and resolved.
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { makeApp } from '../helpers/app.js';
import { createPatient, truncateAll } from '../helpers/db.js';
import { apiClient, daysAgoDate, hoursAgo } from '../helpers/nexivo.js';

let app;
let c; // doctor client
let asha;
let ravi;
beforeEach(async () => {
  await truncateAll();
  ({ app } = makeApp());
  asha = await createPatient({ email: 'asha@example.test' });
  ravi = await createPatient({ email: 'ravi@example.test' });
  c = await apiClient(app);
  for (const p of [asha, ravi])
    await c.put(`/api/patients/${p.id}/recovery-profile`, { surgery_date: daysAgoDate(10) });
});

// Check-ins on days 5-9: the day-7 template milestone is not yet 3 days overdue.
const DAY = { 5: 120, 6: 96, 7: 72, 8: 48, 9: 24 };
const checkIn = async (patient, day, overrides = {}, client = c) => {
  const res = await client.post(`/api/patients/${patient.id}/observations`, {
    pain: 2,
    mobility: 8,
    fatigue: 2,
    ...overrides,
    observed_at: hoursAgo(DAY[day]),
  });
  expect(res.status).toBe(201);
  return res.body;
};
const painAlerts = async (patientId) =>
  (
    await query(
      `SELECT id, observation_id, status, details, created_at < last_seen_at AS seen_again
         FROM recovery_alerts WHERE patient_id = $1 AND type = 'SUDDEN_DETERIORATION' AND parameter = 'pain'
        ORDER BY id`,
      [patientId],
    )
  ).rows;

describe('alerts raised by check-ins', () => {
  it('a deteriorating sequence raises one high alert, not duplicates', async () => {
    for (const day of [5, 6, 7]) expect((await checkIn(asha, day)).alerts).toEqual([]);

    const day8 = await checkIn(asha, 8, { pain: 6 }); // +4 since day 7
    const sudden8 = day8.alerts.find((a) => a.type === 'SUDDEN_DETERIORATION');
    expect(sudden8).toMatchObject({ parameter: 'pain', severity: 'high', status: 'open' });
    expect(day8.score.category).toBe('attention');

    const day9 = await checkIn(asha, 9, { pain: 9 }); // +3 again: same condition, same alert
    const sudden9 = day9.alerts.find((a) => a.type === 'SUDDEN_DETERIORATION');
    expect(sudden9.id).toBe(sudden8.id);
    expect(sudden9.details).toMatchObject({ previous: 6, current: 9 });

    const rows = await painAlerts(asha.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ observation_id: day8.observation.id, seen_again: true, details: { current: 9 } });
    const { rows: dupes } = await query(
      `SELECT type, parameter FROM recovery_alerts WHERE patient_id = $1 AND status <> 'resolved'
        GROUP BY type, parameter HAVING count(*) > 1`,
      [asha.id],
    );
    expect(dupes).toEqual([]);
  });

  it("alerts are per patient: another patient's deterioration is a separate alert", async () => {
    await checkIn(asha, 7);
    await checkIn(ravi, 7);
    await checkIn(asha, 8, { pain: 6 });
    await checkIn(ravi, 8, { pain: 6 });
    expect(await painAlerts(asha.id)).toHaveLength(1);
    expect(await painAlerts(ravi.id)).toHaveLength(1);
  });

  it('GET /api/patients/:id/alerts lists them, filtered by status', async () => {
    await checkIn(asha, 7);
    await checkIn(asha, 8, { pain: 6, doses_prescribed: 4, doses_taken: 1 });
    const all = (await c.get(`/api/patients/${asha.id}/alerts`)).body;
    // Pain +4 and adherence 25% also pull the score ~21 points below the baseline (SCORE_DROP).
    expect(all.map((a) => a.type).sort()).toEqual(['ADHERENCE_DROP', 'SCORE_DROP', 'SUDDEN_DETERIORATION']);
    expect((await c.get(`/api/patients/${asha.id}/alerts?status=resolved`)).body).toEqual([]);
    expect((await c.get(`/api/patients/${asha.id}/alerts?status=closed`)).status).toBe(400);
    expect((await c.get('/api/patients/999999/alerts')).status).toBe(404);
  });
});

describe('PATCH /api/alerts/:id', () => {
  async function raisePainAlert(day = 8) {
    const r = await checkIn(asha, day, { pain: day === 8 ? 6 : 9 });
    return r.alerts.find((a) => a.type === 'SUDDEN_DETERIORATION');
  }

  it('acknowledge, then resolve; an acknowledged alert keeps absorbing repeats', async () => {
    await checkIn(asha, 7);
    const alert = await raisePainAlert(8);

    const ack = await c.patch(`/api/alerts/${alert.id}`, { status: 'acknowledged' });
    expect(ack.status).toBe(200);
    expect(ack.body).toMatchObject({ status: 'acknowledged', acknowledged_by: null, resolved_at: null });
    expect(Date.parse(ack.body.acknowledged_at)).not.toBeNaN();

    await raisePainAlert(9); // same condition while acknowledged: updates, no new alert
    expect((await painAlerts(asha.id)).map((a) => a.status)).toEqual(['acknowledged']);

    const resolved = await c.patch(`/api/alerts/${alert.id}`, { status: 'resolved' });
    expect(resolved.body.status).toBe('resolved');
    expect(Date.parse(resolved.body.resolved_at)).not.toBeNaN();
  });

  it('after an alert is resolved, the same condition opens a new one', async () => {
    await checkIn(asha, 6);
    await checkIn(asha, 7, { pain: 5 });
    const first = (await painAlerts(asha.id))[0];
    await c.patch(`/api/alerts/${first.id}`, { status: 'resolved' });
    await checkIn(asha, 8, { pain: 8 });
    expect((await painAlerts(asha.id)).map((a) => a.status)).toEqual(['resolved', 'open']);
  });

  it('only moves forward (409), validates the body (400), 404 for an unknown alert', async () => {
    await checkIn(asha, 7);
    const alert = await raisePainAlert(8);
    await c.patch(`/api/alerts/${alert.id}`, { status: 'resolved' });
    expect((await c.patch(`/api/alerts/${alert.id}`, { status: 'acknowledged' })).status).toBe(409);
    expect((await c.patch(`/api/alerts/${alert.id}`, { status: 'resolved' })).status).toBe(409);
    expect((await c.patch(`/api/alerts/${alert.id}`, { status: 'open' })).status).toBe(400);
    expect((await c.patch('/api/alerts/999999', { status: 'resolved' })).status).toBe(404);
  });

  it("a patient can acknowledge their own alert (recorded as them), not another patient's", async () => {
    await checkIn(ravi, 7);
    await checkIn(ravi, 8, { pain: 6 });
    const raviAlert = (await painAlerts(ravi.id))[0];
    await checkIn(asha, 7);
    const ashaAlert = await raisePainAlert(8);

    const patient = await apiClient(app, 'asha@example.test');
    expect((await patient.patch(`/api/alerts/${raviAlert.id}`, { status: 'acknowledged' })).status).toBe(403);
    expect((await patient.get(`/api/patients/${ravi.id}/alerts`)).status).toBe(403);
    const own = await patient.patch(`/api/alerts/${ashaAlert.id}`, { status: 'acknowledged' });
    expect(own.status).toBe(200);
    expect(own.body.acknowledged_by).toBe(asha.userId);
  });
});
