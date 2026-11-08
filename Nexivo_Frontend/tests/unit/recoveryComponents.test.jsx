// Smoke test: the Nexivo recovery components render API-shaped data (server-side
// render, so no browser needed). Charts need a measured container, so they are
// only checked for their accessible wrapper.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AlertList } from '../../src/components/AlertList';
import { FactorList } from '../../src/components/FactorList';
import { MilestoneChecklist } from '../../src/components/MilestoneChecklist';
import { Recommendation } from '../../src/components/Recommendation';
import { ScoreCard } from '../../src/components/ScoreCard';
import { ScoreTrendChart } from '../../src/components/ScoreTrendChart';
import { Timeline } from '../../src/components/Timeline';
import { chartRows } from '../../src/utils/recovery';

const score = {
    observation_id: 4,
    composite: 62.5,
    baseline: 75,
    slope: -3.1,
    expected: 49.6,
    category: 'attention',
    limited_history: false,
    day_post_op: 9,
    observed_at: '2026-11-01T09:00:00+00:00',
    explanation: 'Pain rose to 7/10 (usual for this patient: 2/10), lowering the score by 12.5 points.',
    recommendation: 'Recommend prompt professional follow-up. Main driver: Pain.',
    contributions: [
        { parameter: 'pain', raw_value: 7, normalized: 30, baseline: 80, contribution: -12.5 },
        { parameter: 'mobility', raw_value: 8, normalized: 80, baseline: 80, contribution: 0 },
        { parameter: 'fatigue', raw_value: 2, normalized: 80, baseline: 80, contribution: 0 },
        { parameter: 'symptoms', raw_value: 0, normalized: 100, baseline: 100, contribution: 0 },
        { parameter: 'adherence', raw_value: null, normalized: 100, baseline: 100, contribution: 0 },
        { parameter: 'milestones', raw_value: null, normalized: 100, baseline: 100, contribution: 0 },
    ],
};
const html = (element) => renderToStaticMarkup(element);

describe('recovery components render API data', () => {
    it('ScoreCard: score, label (not colour alone), change vs usual', () => {
        const out = html(<ScoreCard score={score} />);
        expect(out).toContain('63');
        expect(out).toContain('Requires attention');
        expect(out).toContain('−12.5 vs usual (75)');
        expect(html(<ScoreCard score={{ ...score, limited_history: true, baseline: null }} />)).toContain('Limited history');
        expect(html(<ScoreCard score={null} />)).toContain('No check-ins yet');
    });

    it('FactorList and Recommendation', () => {
        const factors = html(<FactorList score={score} />);
        expect(factors).toContain('Why this status');
        expect(factors).toContain('Pain');
        expect(factors).toContain('−12.5 points');
        expect(factors).not.toContain('Mobility'); // zero contributions are left out
        expect(html(<Recommendation score={score} />)).toContain('Main driver: Pain.');
    });

    it('AlertList shows unresolved alerts with their actions', () => {
        const alerts = [
            { id: 1, severity: 'high', message: 'Pain rose from 2/10 to 7/10.', status: 'open', last_seen_at: '2026-11-01T09:00:00Z' },
            { id: 2, severity: 'medium', message: 'Adherence 50%.', status: 'acknowledged', last_seen_at: '2026-11-01T09:00:00Z' },
            { id: 3, severity: 'low', message: 'Old.', status: 'resolved', last_seen_at: '2026-10-30T09:00:00Z' },
        ];
        const out = html(<AlertList alerts={alerts} onChange={() => {}} />);
        expect(out).toContain('High:');
        expect(out.match(/Acknowledge</g)).toHaveLength(1);
        expect(out.match(/Resolve</g)).toHaveLength(2);
        expect(out).not.toContain('Old.');
        expect(out).toContain('1 resolved alert(s)');
    });

    it('MilestoneChecklist and Timeline', () => {
        const milestones = [
            { id: 1, name: 'First follow-up visit', target_day: 7, completed_at: null },
            { id: 2, name: 'Walk 10 minutes', target_day: 14, completed_at: '2026-11-01T09:00:00Z' },
        ];
        const checklist = html(<MilestoneChecklist milestones={milestones} currentDay={9} onToggle={() => {}} />);
        expect(checklist).toContain('past due');
        expect(checklist.match(/type="checkbox"/g)).toHaveLength(2);

        const events = [
            { kind: 'check_in', at: '2026-11-01T09:00:00Z', observation: { day_post_op: 9 }, score },
            { kind: 'alert', at: '2026-11-01T09:00:01Z', alert: { severity: 'high', message: 'Pain rose.' } },
            { kind: 'milestone_due', at: '2026-10-29T00:00:00Z', milestone: milestones[0] },
            { kind: 'milestone_completed', at: '2026-11-01T10:00:00Z', milestone: milestones[1] },
        ];
        const timeline = html(<Timeline events={events} />);
        expect(timeline).toContain('Check-in (day 9): score 63, Requires attention');
        expect(timeline).toContain('High alert: Pain rose.');
        expect(timeline.indexOf('Milestone completed')).toBeLessThan(timeline.indexOf('Milestone due')); // newest first
    });

    it('ScoreTrendChart renders its accessible wrapper or the empty message', () => {
        expect(html(<ScoreTrendChart rows={chartRows([score])} />)).toContain('aria-label="Recovery score by day after surgery');
        expect(html(<ScoreTrendChart rows={[]} />)).toContain('after the first check-in');
    });
});
