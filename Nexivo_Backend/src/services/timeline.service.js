// Nexivo M5: one patient's recovery timeline: check-ins (with their scores),
// alerts, and milestone events, merged in time order.

import {
  findProfile,
  listAlerts,
  listLatestObservations,
  listMilestones,
  listScoreHistory,
} from '../repositories/recovery.repository.js';
import { assertPatient } from './recovery.service.js';

const DAY_MS = 86_400_000;

/**
 * Pure merge. Events: check_in {observation, score}, alert {alert},
 * milestone_completed {milestone}, milestone_due {milestone} (only dues that have passed).
 *
 * @param {{ surgery_date: string } | null} profile
 * @param {{ observations: object[], scores: object[], alerts: object[], milestones: object[] }} data
 * @param {{ from?: string, to?: string, now?: number }} [range] inclusive ISO bounds; now in ms
 * @returns {{ kind: string, at: string }[]} oldest first
 */
export function buildTimeline(
  profile,
  { observations, scores, alerts, milestones },
  { from, to, now = Date.now() } = {},
) {
  const scoreFor = new Map(scores.map((s) => [s.observation_id, s]));
  const dueAt = (m) => new Date(Date.parse(profile.surgery_date) + m.target_day * DAY_MS).toISOString();
  const events = [
    ...observations.map((o) => ({
      kind: 'check_in',
      at: o.observed_at,
      observation: o,
      score: scoreFor.get(o.id) ?? null,
    })),
    ...alerts.map((a) => ({ kind: 'alert', at: a.created_at, alert: a })),
    ...milestones
      .filter((m) => m.completed_at)
      .map((m) => ({ kind: 'milestone_completed', at: m.completed_at, milestone: m })),
    ...(profile ? milestones.map((m) => ({ kind: 'milestone_due', at: dueAt(m), milestone: m })) : []).filter(
      (e) => Date.parse(e.at) <= now,
    ),
  ];
  const lo = from ? Date.parse(from) : -Infinity;
  const hi = to ? Date.parse(to) : Infinity;
  return events
    .filter((e) => Date.parse(e.at) >= lo && Date.parse(e.at) <= hi)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); // stable: a check-in stays before the alerts it raised
}

export async function getTimeline(patientId, range) {
  await assertPatient(patientId);
  const [profile, observations, scores, alerts, milestones] = await Promise.all([
    findProfile(patientId),
    listLatestObservations(patientId, range),
    listScoreHistory(patientId, range),
    listAlerts(patientId, null),
    listMilestones(patientId),
  ]);
  return buildTimeline(profile, { observations, scores, alerts, milestones }, range);
}
