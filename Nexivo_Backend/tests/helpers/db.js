// Database helpers for integration tests: wipe tables, create rows.

import { query } from '../../src/db/pool.js';
import { withTransaction } from '../../src/db/tx.js';
import { upsertDoctor } from '../../src/repositories/doctor.repository.js';
import { makePassword } from '../../src/utils/djangoPassword.js';

export async function truncateAll() {
  await query(
    'TRUNCATE users, doctors, patients, exercise_sessions, chat_messages, patient_reports, sessions, research_datasets RESTART IDENTITY CASCADE',
  );
  // Back to the seeded scoring configs only (their scores were truncated with the patients above),
  // with nexivo-1.1 (0014: 1.0 plus the explanation templates) active.
  await query("DELETE FROM scoring_configs WHERE version NOT IN ('nexivo-1.0', 'nexivo-1.1')");
  await query("UPDATE scoring_configs SET active = false WHERE active AND version <> 'nexivo-1.1'");
  await query("UPDATE scoring_configs SET active = true WHERE version = 'nexivo-1.1'");
}

let counter = 0;

/**
 * Insert a patient (users + patients rows), like Django's doctor_info would.
 *
 * @returns {Promise<{ id: number, userId: number, name: string, email: string, info: string }>}
 */
export async function createPatient({ name, email, info = 'Knee replacement. Test data.' } = {}) {
  counter += 1;
  const values = { name: name ?? `Test Patient ${counter}`, email: email ?? `patient${counter}@example.test`, info };
  return withTransaction(async (client) => {
    const { rows: users } = await client.query(
      `INSERT INTO users (role, name, email) VALUES ('patient', $1, $2) RETURNING id`,
      [values.name, values.email],
    );
    const { rows: patients } = await client.query('INSERT INTO patients (user_id, info) VALUES ($1, $2) RETURNING id', [
      users[0].id,
      values.info,
    ]);
    return { id: patients[0].id, userId: users[0].id, ...values };
  });
}

export const TEST_DOCTOR = { name: 'Dr Test', email: 'doctor@example.test', password: 'correct-horse' };
// Few iterations: most integration tests log in, and this isn't the hash under test.
const testDoctorHash = makePassword(TEST_DOCTOR.password, { iterations: 1000 });

/** The test doctor's account, created once per truncate. */
export async function createDoctor() {
  await upsertDoctor({
    name: TEST_DOCTOR.name,
    email: TEST_DOCTOR.email,
    passwordHash: await testDoctorHash,
    specialty: 'Orthopaedics',
    licenseNumber: 'TEST-0001',
  });
}

/** The stored session data for an express-session id, or null. */
export async function sessionData(sid) {
  const { rows } = await query('SELECT sess FROM sessions WHERE sid = $1', [sid]);
  return rows[0]?.sess ?? null;
}
