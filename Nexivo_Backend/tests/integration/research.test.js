// Nexivo M6 (Phase 7): research datasets and evaluation runs through the API.
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { makeApp } from '../helpers/app.js';
import { createPatient, truncateAll } from '../helpers/db.js';
import { apiClient } from '../helpers/nexivo.js';

let app;
let c; // doctor client
beforeEach(async () => {
  await truncateAll();
  ({ app } = makeApp());
  c = await apiClient(app);
});

const synthetic = async (seed = 42, patients = 30) => {
  const res = await c.post('/api/research/datasets', {
    name: `synthetic ${seed}`,
    source: 'synthetic',
    seed,
    patients,
  });
  expect(res.status).toBe(201);
  return res.body;
};
const run = async (datasetId, seed) => {
  const res = await c.post('/api/research/evaluations', { dataset_id: datasetId, seed });
  expect(res.status).toBe(201);
  return res.body;
};

describe('datasets', () => {
  it('generates a seeded synthetic dataset; the same seed stores identical rows', async () => {
    const a = await synthetic(42);
    expect(a).toMatchObject({ source: 'synthetic', seed: 42, patient_count: 30 });
    expect(a.observation_count).toBeGreaterThan(500);
    const b = await synthetic(42);
    const rows = async (id) =>
      (
        await query(
          `SELECT patient_key, day_post_op, pain, mobility, fatigue, symptoms, doses_prescribed, doses_taken,
                  milestones_completed, milestones_due, label
             FROM research_observations WHERE dataset_id = $1 ORDER BY seq`,
          [id],
        )
      ).rows;
    expect(await rows(b.id)).toEqual(await rows(a.id));
    expect((await c.get('/api/research/datasets')).body.map((d) => d.id)).toEqual([b.id, a.id]);
  });

  it('imports a CSV; a bad one is rejected with the line and nothing is stored', async () => {
    const csv = [
      'patient_id,day_post_op,pain,mobility,fatigue,fever,doses_prescribed,doses_taken,milestones_completed,milestones_due,label',
      'A,1,6,3,5,0,3,3,0,0,normal',
      'A,2,5,4,4,0,3,3,0,0,normal',
      'B,1,8,2,6,3,3,1,0,0,attention',
    ].join('\n');
    const ok = await c.post('/api/research/datasets', { name: 'tiny', source: 'csv', csv });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ source: 'csv', seed: null, patient_count: 2, observation_count: 3 });

    const bad = await c.post('/api/research/datasets', { name: 'bad', source: 'csv', csv: `${csv}\nC,1,6,3` });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.csv).toBe('line 5: expected 11 fields, got 4');
    expect((await c.get('/api/research/datasets')).body).toHaveLength(1);
  });

  it('400 for a bad body', async () => {
    expect((await c.post('/api/research/datasets', { name: 'x', source: 'excel' })).status).toBe(400);
    expect((await c.post('/api/research/datasets', { name: 'x', source: 'synthetic', seed: -1 })).status).toBe(400);
  });
});

describe('evaluation runs', () => {
  it('replays both engines and stores metrics, confusion, seed and split; the same seed gives identical metrics', async () => {
    const dataset = await synthetic(42);
    const first = await run(dataset.id, 7);
    expect(first).toMatchObject({
      dataset_id: dataset.id,
      dataset_name: 'synthetic 42',
      config_version: 'nexivo-1.1',
      seed: 7,
    });
    expect(first.split.tuning).toHaveLength(9);
    expect(first.split.test).toHaveLength(21);
    for (const engine of ['baseline', 'nexivo']) {
      expect(Object.keys(first.metrics[engine])).toEqual(
        expect.arrayContaining([
          'accuracy',
          'precision',
          'recall',
          'f1',
          'false_positive_rate',
          'false_positives_per_patient',
        ]),
      );
      const { tp, fp, tn, fn } = first.confusion[engine];
      expect(tp + fp + tn + fn).toBe(first.metrics[engine].observations);
    }
    expect(first.metrics.nexivo.three_class).toHaveProperty('macro_f1');
    expect(first.metrics.tuning.baseline.patients).toBe(9);

    const again = await run(dataset.id, 7);
    expect(again.id).not.toBe(first.id);
    expect(again.metrics).toEqual(first.metrics);
    expect(again.confusion).toEqual(first.confusion);
    expect(again.split).toEqual(first.split);
    expect((await run(dataset.id, 8)).split).not.toEqual(first.split);
  });

  it('lists runs with headline F1s and returns one run; 404s', async () => {
    const dataset = await synthetic(5, 10);
    const r = await run(dataset.id, 1);
    const list = (await c.get('/api/research/evaluations')).body;
    expect(list[0]).toMatchObject({
      id: r.id,
      seed: 1,
      baseline_f1: r.metrics.baseline.f1,
      nexivo_f1: r.metrics.nexivo.f1,
    });
    expect((await c.get(`/api/research/evaluations/${r.id}`)).body.metrics).toEqual(r.metrics);
    expect((await c.get('/api/research/evaluations/999999')).status).toBe(404);
    expect((await c.post('/api/research/evaluations', { dataset_id: 999999, seed: 1 })).status).toBe(404);
  });

  it('never touches clinical tables, and is not available to a logged-in patient', async () => {
    const dataset = await synthetic(3, 10);
    await run(dataset.id, 1);
    const { rows } = await query(
      `SELECT (SELECT count(*) FROM recovery_observations)::int AS observations,
              (SELECT count(*) FROM recovery_scores)::int AS scores,
              (SELECT count(*) FROM recovery_alerts)::int AS alerts`,
    );
    expect(rows[0]).toEqual({ observations: 0, scores: 0, alerts: 0 });

    await createPatient({ email: 'asha@example.test' });
    const patient = await apiClient(app, 'asha@example.test');
    expect((await patient.get('/api/research/datasets')).status).toBe(403);
    expect((await patient.post('/api/research/evaluations', { dataset_id: dataset.id, seed: 1 })).status).toBe(403);
  });
});
