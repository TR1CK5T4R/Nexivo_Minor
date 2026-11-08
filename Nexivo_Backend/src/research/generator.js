// Seeded synthetic recovery data for the M6 evaluation. Pure: the same seed and
// options always give the same rows.
//
// Trajectory classes (ground truth from the generator):
//   normal        recovers at the expected pace                → label normal
//   slow          recovers at about half the pace              → label slower
//   deteriorating recovers normally, then worsens from a random
//                 onset day (pain/fatigue up, mobility down,
//                 wound symptoms, missed doses, milestones stop) → normal before onset, attention after
// Some patients have a chronically higher pain and lower mobility baseline:
// exactly where one fixed threshold for everyone over-alerts. Values get noise,
// and some daily check-ins are skipped.

import { gaussian, mulberry32 } from './random.js';

export const GENERATOR_DEFAULTS = Object.freeze({
  patients: 60,
  days: 42,
  expected_recovery_days: 42,
  checkin_probability: 0.85,
  mix: { normal: 0.5, slow: 0.3, deteriorating: 0.2 },
  chronic_fraction: 0.3,
  noise_sd: 0.7,
  doses_per_day: 3,
  milestone_days: [7, 14, 28, 42],
});

const WOUND_SYMPTOMS = ['fever', 'wound_redness', 'swelling'];
const clamp = (x, min, max) => Math.min(max, Math.max(min, x));

/**
 * @param {number} seed
 * @param {Partial<typeof GENERATOR_DEFAULTS>} options
 * @param {string[]} symptomNames the scoring config's symptom list
 * @returns {object[]} rows in patient, then day order (same shape as parseResearchCsv)
 */
export function generateDataset(seed, options, symptomNames) {
  const o = { ...GENERATOR_DEFAULTS, ...options };
  const random = mulberry32(seed);
  const noise = gaussian(random);
  const scale10 = (x) => clamp(Math.round(x + o.noise_sd * noise()), 0, 10);
  const rows = [];

  for (let p = 1; p <= o.patients; p += 1) {
    const pick = random();
    const kind = pick < o.mix.normal ? 'normal' : pick < o.mix.normal + o.mix.slow ? 'slow' : 'deteriorating';
    const chronic = random() < o.chronic_fraction;
    const painOffset = chronic ? 2 + random() * 1.5 : random() * 0.8;
    const mobilityOffset = chronic ? 1.5 + random() * 1.5 : random() * 0.8;
    const pace = kind === 'slow' ? 0.4 + random() * 0.2 : 0.9 + random() * 0.3;
    const onset = kind === 'deteriorating' ? 8 + Math.floor(random() * 20) : null; // day 8-27
    const patientKey = `S${String(p).padStart(3, '0')}`;
    let lastDay = 0;

    for (let day = 1; day <= o.days; day += 1) {
      if (random() > o.checkin_probability) continue; // missed check-in
      const progress = Math.min(1, (pace * day) / o.expected_recovery_days);
      // 0 before onset, rising to 1 over the five days after it.
      const decline = onset !== null && day > onset ? Math.min(1, (day - onset) / 5) : 0;

      const symptoms = Object.fromEntries(
        symptomNames.map((s) => {
          const background = random() < 0.06 ? 1 : 0;
          const wound = WOUND_SYMPTOMS.includes(s) ? Math.round(decline * 3 + 0.4 * noise()) : 0;
          return [s, clamp(Math.max(background, wound), 0, 3)];
        }),
      );
      const prescribed = o.doses_per_day * (day - lastDay);
      const missed = (random() < 0.08 ? 1 : 0) + (decline > 0.5 && random() < 0.4 ? Math.ceil(prescribed / 2) : 0);
      const due = o.milestone_days.filter((d) => d <= day);
      // Milestones done on time (normal), a week late (slow), or not after onset (deteriorating).
      const done = due.filter((d) => (kind === 'slow' ? d + 7 <= day : onset === null || d < onset));

      rows.push({
        patient_key: patientKey,
        day_post_op: day,
        pain: scale10(7.5 - 6 * progress + painOffset + 5 * decline),
        mobility: scale10(2 + 7 * progress - mobilityOffset - 4 * decline),
        fatigue: scale10(7 - 5 * progress + 3 * decline),
        symptoms,
        doses_prescribed: prescribed,
        doses_taken: clamp(prescribed - missed, 0, prescribed),
        milestones_completed: done.length,
        milestones_due: due.length,
        label: kind === 'slow' ? 'slower' : decline > 0 ? 'attention' : 'normal',
      });
      lastDay = day;
    }
  }
  return rows;
}
