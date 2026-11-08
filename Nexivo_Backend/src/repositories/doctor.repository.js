// SQL for doctor accounts. A doctor is a `doctors` row joined to its `users` row;
// the name, email and password hash live on users.

import { query } from '../db/pool.js';

/**
 * @param {string} email
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<{ id: number, name: string, email: string, password: string, is_active: boolean } | null>}
 */
export async function findDoctorByEmail(email, client) {
  const { rows } = await query(
    `SELECT d.id, u.name, u.email, u.password, u.is_active
       FROM users u
       JOIN doctors d ON d.user_id = u.id
      WHERE u.email = $1 AND u.role = 'doctor'`,
    [email],
    client,
  );
  return rows[0] ?? null;
}

/**
 * Create a doctor, or reset the name and password of an existing one.
 *
 * @param {{ name: string, email: string, passwordHash: string, specialty: string, licenseNumber: string }} d
 * @param {import('pg').PoolClient} [client]
 */
export async function upsertDoctor({ name, email, passwordHash, specialty, licenseNumber }, client) {
  await query(
    `WITH account AS (
       INSERT INTO users (role, name, email, password)
       VALUES ('doctor', $1, $2, $3)
       ON CONFLICT (email, role) DO UPDATE
         SET name = EXCLUDED.name, password = EXCLUDED.password, is_active = true, updated_at = now()
       RETURNING id
     )
     INSERT INTO doctors (user_id, specialty, license_number)
     SELECT id, $4, $5 FROM account
     ON CONFLICT (user_id) DO NOTHING`,
    [name, email, passwordHash, specialty, licenseNumber],
    client,
  );
}
