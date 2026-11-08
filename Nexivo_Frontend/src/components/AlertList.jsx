import { useState } from 'react';
import { Card } from './Card';
import { ALERT_SEVERITIES } from '../utils/recovery';

const STATUS_LABELS = { open: 'Open', acknowledged: 'Acknowledged', resolved: 'Resolved' };

// Alerts with acknowledge / resolve. onChange(alertId, status) saves; the page reloads.
export const AlertList = ({ alerts, onChange }) => {
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const act = async (id, status) => {
        setBusy(id);
        setError(null);
        try {
            await onChange(id, status);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };
    const unresolved = alerts.filter((a) => a.status !== 'resolved');
    return (
        <Card padding="lg" hover={false}>
            <h2 className="text-lg font-bold text-slate-900 mb-4">Alerts</h2>
            {error && <p role="alert" className="mb-3 text-sm text-rose-700">{error}</p>}
            {unresolved.length === 0 ? (
                <p className="text-slate-600">No open alerts.</p>
            ) : (
                <ul className="space-y-3">
                    {unresolved.map((a) => (
                        <li key={a.id} className={`p-3 border rounded-lg text-sm ${ALERT_SEVERITIES[a.severity].className}`}>
                            <p>
                                <span className="font-semibold">{ALERT_SEVERITIES[a.severity].label}:</span> {a.message}
                            </p>
                            <p className="mt-1 text-xs opacity-80">
                                {STATUS_LABELS[a.status]} · last seen {new Date(a.last_seen_at).toLocaleString()}
                            </p>
                            <div className="mt-2 flex gap-2">
                                {a.status === 'open' && (
                                    <button type="button" disabled={busy === a.id} onClick={() => act(a.id, 'acknowledged')} className="px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                                        Acknowledge
                                    </button>
                                )}
                                <button type="button" disabled={busy === a.id} onClick={() => act(a.id, 'resolved')} className="px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                                    Resolve
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {alerts.length > unresolved.length && (
                <p className="mt-3 text-xs text-slate-500">{alerts.length - unresolved.length} resolved alert(s) are in the timeline.</p>
            )}
        </Card>
    );
};
