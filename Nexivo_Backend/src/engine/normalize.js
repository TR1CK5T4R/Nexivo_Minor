// Nexivo M2 step 1: each parameter on a 0-100 scale, 100 = best.
// Pure: no database, no HTTP, no clock. The same code scores live check-ins
// and research replays.

const clamp = (value) => Math.min(100, Math.max(0, value));

/**
 * @param {{ pain: number, mobility: number, fatigue: number, symptoms: Record<string, number>,
 *   doses_prescribed: number, doses_taken: number, milestones_due: number, milestones_completed: number }} o
 *   one observation; milestone counts are as of that observation
 * @param {{ symptoms: string[] }} params the scoring config (its symptom list)
 * @returns {Record<'pain'|'mobility'|'fatigue'|'symptoms'|'adherence'|'milestones', number>}
 */
export function normalize(o, params) {
  // Symptoms the observation doesn't mention count as 0 (none).
  const severities = params.symptoms.map((s) => o.symptoms[s] ?? 0);
  const totalSeverity = severities.reduce((a, b) => a + b, 0);
  return {
    pain: clamp((10 - o.pain) * 10),
    mobility: clamp(o.mobility * 10),
    fatigue: clamp((10 - o.fatigue) * 10),
    symptoms: clamp(100 * (1 - totalSeverity / (3 * severities.length))),
    adherence: o.doses_prescribed > 0 ? clamp((100 * o.doses_taken) / o.doses_prescribed) : 100,
    milestones: o.milestones_due > 0 ? clamp((100 * o.milestones_completed) / o.milestones_due) : 100,
  };
}
