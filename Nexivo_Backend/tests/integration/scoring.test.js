// Nexivo M2 (Phase 3): scores computed with each check-in, config versions, rescoring.
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { recomputeAllScores } from '../../src/services/score.service.js';
import { makeApp } from '../helpers/app.js';
import { createPatient, truncateAll } from '../helpers/db.js';
import { apiClient, daysAgoDate, hoursAgo } from '../helpers/nexivo.js';

let app;
let c; // a clinician client (no login)
let asha;
let ravi;
beforeEach(async () => {
  await truncateAll();
  ({ app } = makeApp());
  asha = await createPatient({ email: 'asha@example.test' });
  ravi = await createPatient({ email: 'ravi@example.test' });
  c = await apiClient(app);
  for (const p of [asha, ravi]) {
    await c.put(`/api/patients/${p.id}/recovery-profile`, { surgery_date: daysAgoDate(10) });
  }
});

const reading = (overrides = {}) => ({ pain: 3, mobility: 6, fatigue: 3, ...overrides });
const checkIn = async (patient, hours, overrides) => {
  const res = await c.post(`/api/patients/${patient.id}/observations`, {
    ...reading(overrides),
    observed_at: hoursAgo(hours),
  });
  expect(res.status).toBe(201);
  return res.body;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

async function activeConfigId() {
  return (await c.get('/api/config/scoring')).body.id;
}

describe('score on every check-in', () => {
  it('leaves limited-history mode at the 4th check-in; baseline = mean of the earlier composites; config recorded', async () => {
    const first = [];
    for (const [h, pain] of [
      [72, 4],
      [48, 3],
      [24, 2],
    ])
      first.push((await checkIn(asha, h, { pain })).score);
    expect(first.every((s) => s.limited_history)).toBe(true);

    const { observation, score } = await checkIn(asha, 0, { pain: 1 });
    expect(score).toMatchObject({ observation_id: observation.id, patient_id: asha.id, limited_history: false });
    expect(score.baseline).toBeCloseTo(mean(first.map((s) => s.composite)), 9);
    expect(score.slope).toBeGreaterThan(0); // pain falling every day
    expect(score.config_id).toBe(await activeConfigId());

    const { rows } = await query('SELECT count(*)::int AS n FROM recovery_scores WHERE patient_id = $1', [asha.id]);
    expect(rows[0].n).toBe(4);
  });

  it('is personal: pain 7 needs attention for a patient whose usual pain is 1, not for one who is always at 7', async () => {
    for (const h of [72, 48, 24]) {
      await checkIn(asha, h, { pain: 1 });
      await checkIn(ravi, h, { pain: 7 });
    }
    const ashaScore = (await checkIn(asha, 0, { pain: 7 })).score;
    const raviScore = (await checkIn(ravi, 0, { pain: 7 })).score;
    expect(ashaScore.composite).toBeCloseTo(raviScore.composite, 9); // the same reading…
    expect(ashaScore.category).toBe('attention'); // …15 points below Asha's own baseline
    expect(raviScore.category).not.toBe('attention');
  });
});

describe('no look-ahead', () => {
  it('a back-dated check-in is scored only against check-ins before it', async () => {
    const day9 = (await checkIn(asha, 24, { pain: 2 })).score;
    const day7 = (await checkIn(asha, 72, { pain: 6 })).score;
    // Saved after day 9, but day 9 is later in time, so it is not history for day 7.
    expect(day7).toMatchObject({ baseline: null, limited_history: true });

    const day10 = (await checkIn(asha, 0)).score;
    expect(day10.baseline).toBeCloseTo(mean([day7.composite, day9.composite]), 9);
  });

  it('a correction is scored against the history before it, without the version it replaces', async () => {
    const day7 = await checkIn(asha, 72, { pain: 1 });
    const day8 = await checkIn(asha, 48, { pain: 9 });
    await checkIn(asha, 24, { pain: 9 });
    const res = await c.post(`/api/observations/${day8.observation.id}/corrections`, { pain: 2 });
    expect(res.status).toBe(201);
    expect(res.body.score.observation_id).toBe(res.body.observation.id);
    expect(res.body.score.baseline).toBeCloseTo(day7.score.composite, 9);
    expect(res.body.score.composite).toBeGreaterThan(day8.score.composite);
  });
});

describe('POST /api/config/scoring', () => {
  const current = async () => (await c.get('/api/config/scoring')).body.params;

  it('rejects weights that do not sum to 1.0 and unknown settings (400)', async () => {
    const params = await current();
    const badWeights = await c.post('/api/config/scoring', {
      version: 'nexivo-1.1',
      params: { ...params, weights: { ...params.weights, pain: 0.5 } },
    });
    expect(badWeights.status).toBe(400);
    expect(badWeights.body.fields['params.weights']).toMatch(/sum to 1\.0/);
    expect(
      (await c.post('/api/config/scoring', { version: 'nexivo-1.1', params: { ...params, typo: 1 } })).status,
    ).toBe(400);
  });

  it('409 for an existing version', async () => {
    expect((await c.post('/api/config/scoring', { version: 'nexivo-1.0', params: await current() })).status).toBe(409);
  });

  it('activates the new version; later scores record it', async () => {
    const params = await current();
    const res = await c.post('/api/config/scoring', {
      version: 'nexivo-1.1',
      params: { ...params, weights: { ...params.weights, pain: 0.35, milestones: 0 } },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ version: 'nexivo-1.1', active: true });
    expect((await c.get('/api/config/scoring')).body.version).toBe('nexivo-1.1');
    expect((await checkIn(asha, 1)).score.config_id).toBe(res.body.id);
    const { rows } = await query('SELECT count(*)::int AS n FROM scoring_configs WHERE active');
    expect(rows[0].n).toBe(1);
  });
});

describe('recomputeAllScores (npm run db:recompute)', () => {
  it('adds scores for the newly active config, keeps the old ones, and is safe to run again', async () => {
    for (const h of [72, 48, 24]) await checkIn(asha, h, { pain: 5 });
    const params = await current();
    await c.post('/api/config/scoring', {
      version: 'nexivo-1.1',
      params: { ...params, weights: { ...params.weights, pain: 0.35, milestones: 0 } },
    });

    expect(await recomputeAllScores()).toEqual({ configVersion: 'nexivo-1.1', patients: 2, inserted: 3, skipped: 0 });
    const { rows } = await query(
      `SELECT c.version, count(*)::int AS n FROM recovery_scores s JOIN scoring_configs c ON c.id = s.config_id
        GROUP BY c.version ORDER BY c.version`,
    );
    expect(rows).toEqual([
      { version: 'nexivo-1.0', n: 3 },
      { version: 'nexivo-1.1', n: 3 },
    ]);
    expect(await recomputeAllScores()).toMatchObject({ inserted: 0, skipped: 3 });
  });

  async function current() {
    return (await c.get('/api/config/scoring')).body.params;
  }
});
