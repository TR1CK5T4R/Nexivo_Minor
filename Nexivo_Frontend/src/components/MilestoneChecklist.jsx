import { useState } from 'react';
import { Card } from './Card';

// Milestone plan with completion checkboxes. onToggle(milestoneId, completed) saves; the page reloads.
export const MilestoneChecklist = ({ milestones, currentDay, onToggle }) => {
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const toggle = async (m) => {
        setBusy(m.id);
        setError(null);
        try {
            await onToggle(m.id, m.completed_at === null);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };
    return (
        <Card padding="lg" hover={false}>
            <h2 className="text-lg font-bold text-slate-900 mb-4">Milestones</h2>
            {error && <p role="alert" className="mb-3 text-sm text-rose-700">{error}</p>}
            {milestones.length === 0 ? (
                <p className="text-slate-600">No milestones yet.</p>
            ) : (
                <ul className="space-y-2">
                    {milestones.map((m) => {
                        const overdue = m.completed_at === null && currentDay !== null && currentDay > m.target_day;
                        return (
                            <li key={m.id}>
                                <label className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                                    <input type="checkbox" checked={m.completed_at !== null} disabled={busy === m.id} onChange={() => toggle(m)} className="mt-1 w-4 h-4 accent-emerald-600" />
                                    <span>
                                        <span className={m.completed_at ? 'text-slate-500 line-through' : 'text-slate-800'}>{m.name}</span>
                                        <span className="block text-xs text-slate-500">
                                            Due day {m.target_day}
                                            {overdue && <span className="text-amber-700"> · past due</span>}
                                        </span>
                                    </span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Card>
    );
};
