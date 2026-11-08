import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, HeartPulse } from 'lucide-react';
import {
    AlertList,
    Button,
    Card,
    DecisionSupportNotice,
    FactorList,
    MilestoneChecklist,
    ParameterChart,
    Recommendation,
    ScoreCard,
    ScoreTrendChart,
    Timeline,
} from '../components';
import { useAuth } from '../context/AuthContext';
import { useRecoveryData } from '../hooks/useRecoveryData';
import { recoveryAPI } from '../services/djangoApi';
import { chartRows } from '../utils/recovery';

const PARAMETER_CHARTS = [
    { dataKey: 'pain', label: 'Pain', max: 10, hint: '0-10, lower is better' },
    { dataKey: 'mobility', label: 'Mobility', max: 10, hint: '0-10, higher is better' },
    { dataKey: 'fatigue', label: 'Fatigue', max: 10, hint: '0-10, lower is better' },
    { dataKey: 'symptoms', label: 'Symptom score', max: 100, hint: '0-100, higher is better' },
    { dataKey: 'adherence', label: 'Medication adherence', max: 100, hint: '%' },
];

// Nexivo patient recovery view (spec M5). /patient/recovery for the logged-in
// patient; /doctor/patients/:id for clinicians, from the overview.
export default function PatientRecovery() {
    const navigate = useNavigate();
    const { id } = useParams();
    const { user, loading: authLoading } = useAuth();
    const isClinicianView = id !== undefined;
    const patientId = isClinicianView ? Number(id) : user?.id;
    const { data, loading, error, reload } = useRecoveryData(patientId);

    const changeAlert = async (alertId, status) => {
        await recoveryAPI.setAlertStatus(alertId, status);
        await reload();
    };
    const toggleMilestone = async (milestoneId, completed) => {
        await recoveryAPI.setMilestoneCompleted(milestoneId, completed);
        await reload();
    };

    let body;
    if (!isClinicianView && !authLoading && !user) {
        body = (
            <Card padding="lg" hover={false}>
                <p className="text-slate-700 mb-4">Please log in to see your recovery.</p>
                <Button onClick={() => navigate('/patient/login')}>Go to login</Button>
            </Card>
        );
    } else if (authLoading || loading) {
        body = <p className="text-slate-600">Loading…</p>;
    } else if (error) {
        body = <p role="alert" className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700">{error.message}</p>;
    } else if (!data.profile) {
        body = (
            <Card padding="lg" hover={false}>
                <p className="text-slate-700 mb-4">No recovery profile yet: the surgery date is needed before the first check-in.</p>
                {!isClinicianView && <Button onClick={() => navigate('/patient/check-in')}>Set up and check in</Button>}
            </Card>
        );
    } else {
        const rows = chartRows(data.scores);
        body = (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <ScoreCard score={data.latest} />
                    <Recommendation score={data.latest} />
                    <FactorList score={data.latest} />
                    <ScoreTrendChart rows={rows} />
                    {rows.length > 0 && (
                        <section aria-labelledby="parameters-heading">
                            <h2 id="parameters-heading" className="text-lg font-bold text-slate-900 mb-3">Parameters</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {PARAMETER_CHARTS.map((chart) => <ParameterChart key={chart.dataKey} rows={rows} {...chart} />)}
                            </div>
                        </section>
                    )}
                </div>
                <div className="space-y-6">
                    <AlertList alerts={data.alerts} onChange={changeAlert} />
                    <MilestoneChecklist milestones={data.milestones} currentDay={data.latest?.day_post_op ?? null} onToggle={toggleMilestone} />
                    <Timeline events={data.timeline} />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/20">
            <div className="max-w-7xl mx-auto px-6 py-8">
                <button onClick={() => navigate(isClinicianView ? '/doctor/overview' : '/patient/dashboard')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6">
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" /> {isClinicianView ? 'Back to overview' : 'Back to dashboard'}
                </button>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                            <HeartPulse className="w-6 h-6 text-emerald-600" aria-hidden="true" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900">{isClinicianView ? 'Patient recovery' : 'My recovery'}</h1>
                            {data?.profile && (
                                <p className="text-slate-600">
                                    {data.profile.surgery_type ?? 'Surgery'} on {data.profile.surgery_date} · expected recovery {data.profile.expected_recovery_days} days
                                </p>
                            )}
                        </div>
                    </div>
                    {!isClinicianView && user && (
                        <Button icon={ClipboardCheck} onClick={() => navigate('/patient/check-in')}>New check-in</Button>
                    )}
                </div>
                <DecisionSupportNotice className="mb-6" />
                {body}
            </div>
        </div>
    );
}
