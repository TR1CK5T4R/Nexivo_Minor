import { Card } from './Card';
import { ALERT_SEVERITIES, CATEGORIES } from '../utils/recovery';

function describe(e) {
    switch (e.kind) {
        case 'check_in':
            return e.score
                ? `Check-in (day ${e.observation.day_post_op}): score ${Math.round(e.score.composite)}, ${CATEGORIES[e.score.category].label}`
                : `Check-in (day ${e.observation.day_post_op})`;
        case 'alert':
            return `${ALERT_SEVERITIES[e.alert.severity].label} alert: ${e.alert.message}`;
        case 'milestone_due':
            return `Milestone due: ${e.milestone.name}`;
        case 'milestone_completed':
            return `Milestone completed: ${e.milestone.name}`;
        default:
            return e.kind;
    }
}

const DOT = { check_in: 'bg-emerald-500', alert: 'bg-rose-500', milestone_due: 'bg-slate-400', milestone_completed: 'bg-blue-500' };

// Recovery timeline, newest first.
export const Timeline = ({ events }) => (
    <Card padding="lg" hover={false}>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Timeline</h2>
        {events.length === 0 ? (
            <p className="text-slate-600">Nothing yet.</p>
        ) : (
            <ol className="relative border-l border-slate-200 ml-2 space-y-4 max-h-[32rem] overflow-y-auto pr-2">
                {[...events].reverse().map((e, i) => (
                    <li key={`${e.kind}-${e.at}-${i}`} className="ml-4">
                        <span className={`absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full ${DOT[e.kind]}`} aria-hidden="true" />
                        <time className="block text-xs text-slate-500">{new Date(e.at).toLocaleString()}</time>
                        <p className="text-sm text-slate-800">{describe(e)}</p>
                    </li>
                ))}
            </ol>
        )}
    </Card>
);
