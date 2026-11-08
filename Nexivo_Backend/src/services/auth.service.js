// Login rules. Plain functions: no req/res, no SQL.

import { findDoctorByEmail } from '../repositories/doctor.repository.js';
import { findPatientByEmail } from '../repositories/patient.repository.js';
import { verifyPassword } from '../utils/djangoPassword.js';
import { pyLower, pyStrip } from '../utils/pythonCompat.js';

/**
 * The email exactly as Django's login view reads it:
 * `request.POST.get('email', '').strip().lower()`.
 * QueryDict.get returns the *last* value of a repeated field.
 *
 * Django parity: Patients/views.py:login
 *
 * @param {string | string[] | undefined} formValue req.body.email from express.urlencoded
 * @returns {string}
 */
export function normalizeLoginEmail(formValue) {
  const value = Array.isArray(formValue) ? formValue[formValue.length - 1] : formValue;
  return pyLower(pyStrip(typeof value === 'string' ? value : ''));
}

/**
 * The patient this email logs in as, or null. The password is not checked:
 * Django's patient login is email-only (preserved).
 *
 * @param {string} email already normalised
 * @returns {Promise<{ id: number, name: string, email: string } | null>}
 */
export async function findLoginPatient(email) {
  return findPatientByEmail(email);
}

/**
 * The doctor these credentials log in as, or null. verifyPassword spends a real
 * hash's time even without an account, so timing doesn't reveal which emails exist.
 *
 * @param {string} email already normalised
 * @param {string} password
 * @returns {Promise<{ id: number, name: string, email: string } | null>}
 */
export async function authenticateDoctor(email, password) {
  const doctor = await findDoctorByEmail(email);
  const valid = await verifyPassword(password, doctor?.password);
  if (!valid || !doctor.is_active) return null;
  return { id: doctor.id, name: doctor.name, email: doctor.email };
}
