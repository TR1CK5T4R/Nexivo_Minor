import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';
import { Card, DecisionSupportNotice } from '../components';
import { recoveryAPI } from '../services/djangoApi';
import { CATEGORIES, trend } from '../utils/recovery';

// Nexivo clinician overview (spec M5): every patient with a recovery profile,
// most urgent first (the server sorts: Requires attention, Slower, Normal, no check-ins).
export default function ClinicianOverview() {
    const navigate = useNavigate();
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        recoveryAPI.getOverview().then(setRows).catch(setError);
    }, []);

    let body;
    if (error) body = <p role="alert" className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700">{error.message}</p>;
    else if (!rows) body = <p className="text-slate-600">Loading…</p>;
    else if (rows.length === 0) body = <p className="text-slate-600">No patients have a recovery profile yet.</p>;
    else {
        body = (
            <Card padding="none" hover={false} className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <caption className="sr-only">Patients sorted by urgency</caption>
                    <thead className="bg-slate-50 text-slate-600">
                        <tr>
                            <th scope="col" className="px-4 py-3 font-semibold">Patient</th>
                            <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                            <th scope="col" className="px-4 py-3 font-semibold">Score</th>
                            <th scope="col" className="px-4 py-3 font-semibold">Trend</th>
                            <th scope="col" className="px-4 py-3 font-semibold">Open alerts</th>
                            <th scope="col" className="px-4 py-3 font-semibold">Last check-in</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((r) => {
                            const category = r.category ? CATEGORIES[r.category] : null;
                            const t = trend(r.slope);
                            return (
                                <tr key={r.patient_id} className="hover:bg-slate-50">
                                    <td className="px-4 py-3">
                                        <Link to={`/doctor/patients/${r.patient_id}`} className="font-medium text-emerald-700 hover:underline">{r.name}</Link>
                                        <span className="block text-xs text-slate-500">{r.surgery_type ?? 'Surgery'} · {r.surgery_date}</span>
                                    </td>
                                    <td className="px-4 py-3">
                                        {category ? (
                                            <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${category.className}`}>{category.label}</span>
                                        ) : (
                                            <span className="text-slate-500">No check-ins</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">{r.composite === null ? '–' : Math.round(r.composite)}</td>
                                    <td className="px-4 py-3">
                                        <span aria-hidden="true">{t.symbol}</span> {t.label}
                                    </td>
                                    <td className="px-4 py-3">{r.open_alerts}</td>
                                    <td className="px-4 py-3">
                                        {r.last_check_in ? `${new Date(r.last_check_in).toLocaleDateString()} (day ${r.day_post_op})` : '–'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </Card>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/20">
            <div className="max-w-7xl mx-auto px-6 py-8">
                <button onClick={() => navigate('/doctor')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6">
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" /> Back to doctor dashboard
                </button>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                        <Users className="w-6 h-6 text-emerald-600" aria-hidden="true" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900">Recovery overview</h1>
                </div>
                <DecisionSupportNotice className="mb-6" />
                {body}
            </div>
        </div>
    );
}
