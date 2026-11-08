// Creates (or refreshes) the demo accounts listed in README.md, so anyone trying the
// app can log in without real data. Safe to run again: patients go through the same
// upsert as POST /doctor_info. Works on any database, production included.
//
// The demo doctor can read and change every patient and its password is published,
// so in production it is only created with DEMO_DOCTOR_PASSWORD set.
//
// Each demo patient also gets a Nexivo recovery history (surgery profile, milestones,
// check-ins) saved through the real services, so scores, alerts and explanations are
// computed exactly as for live check-ins. The histories end in each recovery
// category: Knee → Requires attention, Hip → Slower than expected, Shoulder → Normal,
// Appendix → limited history. A patient who already has check-ins is left alone.
//
//   npm run db:demo

import 'dotenv/config';
import { closePool, initPool, query } from '../src/db/pool.js';
import { upsertDoctor } from '../src/repositories/doctor.repository.js';
import { hasObservations } from '../src/repositories/recovery.repository.js';
import { upsertPatient } from '../src/services/doctor.service.js';
import { createObservation } from '../src/services/observation.service.js';
import { saveProfile } from '../src/services/recovery.service.js';
import { makePassword } from '../src/utils/djangoPassword.js';
import { resolveDatabase } from './lib/target.js';

// Check-in rows: [day after surgery, pain, mobility, fatigue, symptoms, doses taken, doses prescribed].
// Made-up people on the reserved .test domain. Keep this list in sync with both READMEs.
const DEMO_PATIENTS = [
  {
    name: 'Demo Patient (Knee)',
    email: 'demo.knee@revivecare.test',
    info: 'Demo account with made-up data. Left knee ACL reconstruction 10 days ago. Mild swelling, walking with crutches, paracetamol 500 mg as needed. Physiotherapy: straight-leg raises and side lateral raises daily.',
    // Improves for a week, then pain, swelling and wound redness come back.
    recovery: {
      surgeryType: 'Knee ACL reconstruction',
      surgeryDaysAgo: 10,
      milestonesDone: [7],
      checkIns: [
        [1, 7, 3, 6, { swelling: 1 }, 3, 3],
        [2, 6, 4, 6, { swelling: 1 }, 3, 3],
        [3, 5, 4, 5, {}, 3, 3],
        [4, 5, 5, 5, {}, 3, 3],
        [5, 4, 5, 4, {}, 3, 3],
        [6, 3, 6, 4, {}, 3, 3],
        [7, 3, 6, 3, {}, 3, 3],
        [8, 5, 5, 5, { swelling: 2, wound_redness: 1 }, 3, 3],
        [9, 7, 4, 6, { fever: 2, wound_redness: 3, swelling: 2 }, 2, 3],
      ],
    },
  },
  {
    name: 'Demo Patient (Hip)',
    email: 'demo.hip@revivecare.test',
    info: 'Demo account with made-up data. Total right hip replacement 3 weeks ago. Walks with a walker, on blood thinners for 4 more weeks. Watch for calf pain or swelling.',
    // Stuck: pain 5 and mobility 4 for two weeks; the day-14 milestone isn't done.
    recovery: {
      surgeryType: 'Total hip replacement',
      surgeryDaysAgo: 21,
      milestonesDone: [7],
      checkIns: [
        [2, 6, 3, 6, {}, 6, 6],
        [4, 6, 3, 5, {}, 6, 6],
        [6, 5, 4, 5, {}, 6, 6],
        [8, 5, 4, 5, {}, 6, 6],
        [10, 5, 4, 5, {}, 6, 6],
        [12, 5, 4, 5, {}, 6, 6],
        [14, 5, 4, 5, {}, 5, 6],
        [16, 5, 4, 5, {}, 6, 6],
        [18, 5, 4, 5, {}, 6, 6],
        [20, 5, 4, 5, {}, 6, 6],
      ],
    },
  },
  {
    name: 'Demo Patient (Shoulder)',
    email: 'demo.shoulder@revivecare.test',
    info: 'Demo account with made-up data. Arthroscopic rotator cuff repair on the left shoulder 6 weeks ago. Sling removed last week; gentle range-of-motion exercises, no lifting above 2 kg.',
    // Steady recovery, every milestone on time.
    recovery: {
      surgeryType: 'Rotator cuff repair',
      surgeryDaysAgo: 42,
      milestonesDone: [7, 14, 28],
      checkIns: [
        [1, 6, 4, 5, { swelling: 1 }, 3, 3],
        [4, 6, 4, 5, { swelling: 1 }, 9, 9],
        [7, 5, 5, 4, { swelling: 1 }, 9, 9],
        [10, 5, 5, 4, {}, 9, 9],
        [13, 4, 6, 3, {}, 9, 9],
        [16, 4, 6, 3, {}, 9, 9],
        [19, 3, 7, 2, {}, 9, 9],
        [22, 3, 7, 2, {}, 9, 9],
        [25, 2, 8, 1, {}, 9, 9],
        [28, 2, 8, 1, {}, 9, 9],
        [31, 1, 9, 1, {}, 9, 9],
        [34, 1, 9, 0, {}, 9, 9],
        [37, 0, 10, 0, {}, 9, 9],
        [40, 0, 10, 0, {}, 9, 9],
      ],
    },
  },
  {
    name: 'Demo Patient (Appendix)',
    email: 'demo.appendix@revivecare.test',
    info: 'Demo account with made-up data. Laparoscopic appendectomy 4 days ago. Mild abdominal soreness, light walking encouraged, no heavy lifting for 2 weeks.',
    // Only two check-ins so far: the limited-history bands decide the category.
    recovery: {
      surgeryType: 'Laparoscopic appendectomy',
      surgeryDaysAgo: 4,
      milestonesDone: [],
      checkIns: [
        [1, 5, 6, 5, {}, 0, 0],
        [3, 3, 7, 4, {}, 0, 0],
      ],
    },
  },
];

const DEMO_DOCTOR = {
  name: 'Demo Doctor',
  email: 'demo.doctor@revivecare.test',
  specialty: 'Orthopaedics',
  licenseNumber: 'DEMO-0001',
};

const DAY_MS = 86_400_000;
const addDays = (date, days) => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);

async function seedDoctor() {
  const password = process.env.DEMO_DOCTOR_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'demo1234');
  if (!password) return console.log(`skipped  ${DEMO_DOCTOR.email}: production needs DEMO_DOCTOR_PASSWORD`);
  await upsertDoctor({ ...DEMO_DOCTOR, passwordHash: await makePassword(password) });
  console.log(`updated  ${DEMO_DOCTOR.email}: doctor login`);
}

async function seedRecovery(patientId, recovery) {
  if (await hasObservations(patientId)) return 'recovery history already there';
  const surgeryDate = addDays(new Date().toISOString().slice(0, 10), -recovery.surgeryDaysAgo);
  await saveProfile(patientId, { surgery_date: surgeryDate, surgery_type: recovery.surgeryType });
  // Milestones finished on time, as if ticked off at 18:00 on the target day.
  await query(
    `UPDATE recovery_milestones
        SET completed_at = (($2::date + target_day) + time '18:00') AT TIME ZONE 'UTC'
      WHERE patient_id = $1 AND target_day = ANY($3::int[])`,
    [patientId, surgeryDate, recovery.milestonesDone],
  );
  let result;
  for (const [day, pain, mobility, fatigue, symptoms, taken, prescribed] of recovery.checkIns) {
    result = await createObservation(
      patientId,
      {
        observed_at: `${addDays(surgeryDate, day)}T09:00:00Z`,
        pain,
        mobility,
        fatigue,
        symptoms,
        doses_prescribed: prescribed,
        doses_taken: taken,
        notes: null,
      },
      { patientId },
    );
  }
  return `${recovery.checkIns.length} check-ins, latest: ${result.score.category} (score ${Math.round(result.score.composite)})`;
}

const target = resolveDatabase('DATABASE_URL');
initPool({ connectionString: target.url, applicationName: 'revivecare-demo-accounts' });
try {
  await seedDoctor();
  for (const { recovery, ...patient } of DEMO_PATIENTS) {
    const { created, patientId } = await upsertPatient(patient);
    console.log(`${created ? 'created ' : 'updated '} ${patient.email}: ${await seedRecovery(patientId, recovery)}`);
  }
} finally {
  await closePool();
}
