import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { Button, Card, DecisionSupportNotice } from '../components';
import { useAuth } from '../context/AuthContext';
import { recoveryAPI } from '../services/djangoApi';
import { CATEGORIES } from '../utils/recovery';

// Nexivo daily check-in (spec M5). The symptom list comes from the active scoring config.
const SCALES = [
    { key: 'pain', label: 'Pain', low: 'No pain', high: 'Worst pain' },
    { key: 'mobility', label: 'Mobility', low: 'Cannot move', high: 'Fully mobile' },
    { key: 'fatigue', label: 'Fatigue', low: 'Not tired', high: 'Exhausted' },
];
const SEVERITIES = ['None', 'Mild', 'Moderate', 'Severe'];
const INPUT = 'w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-400';
const humanize = (name) => name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the browser's time zone

function Errors({ error }) {
    if (!error) return null;
    return (
        <div role="alert" className="mb-5 p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
            <p className="font-semibold">{error.message}</p>
            {error.fields && (
                <ul className="mt-1 list-disc list-inside">
                    {Object.entries(error.fields).map(([field, message]) => (
                        <li key={field}>{humanize(field)} {message}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function ProfileForm({ patientId, onSaved }) {
    const [surgeryDate, setSurgeryDate] = useState('');
    const [surgeryType, setSurgeryType] = useState('');
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            onSaved(await recoveryAPI.saveProfile(patientId, { surgery_date: surgeryDate, surgery_type: surgeryType.trim() || null }));
        } catch (err) {
            setError(err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card padding="lg" hover={false}>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Your surgery details</h2>
            <p className="text-slate-600 mb-6">Nexivo compares each check-in with your own recovery, counted from your surgery date.</p>
            <form onSubmit={submit}>
                <Errors error={error} />
                <label htmlFor="surgery-date" className="block text-sm font-medium text-slate-700 mb-2">Surgery date *</label>
                <input id="surgery-date" type="date" required max={today()} value={surgeryDate} onChange={(e) => setSurgeryDate(e.target.value)} className={`${INPUT} mb-5`} />
                <label htmlFor="surgery-type" className="block text-sm font-medium text-slate-700 mb-2">Surgery type</label>
                <input id="surgery-type" type="text" maxLength={100} placeholder="e.g. Knee replacement" value={surgeryType} onChange={(e) => setSurgeryType(e.target.value)} className={`${INPUT} mb-6`} />
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save and continue'}</Button>
            </form>
        </Card>
    );
}

function CheckIn({ patientId, symptomNames }) {
    const blank = () => ({
        pain: 5,
        mobility: 5,
        fatigue: 5,
        symptoms: Object.fromEntries(symptomNames.map((s) => [s, 0])),
        doses_prescribed: 0,
        doses_taken: 0,
        notes: '',
    });
    const [form, setForm] = useState(blank);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            setResult(await recoveryAPI.createObservation(patientId, { ...form, notes: form.notes.trim() || null }));
        } catch (err) {
            setError(err);
        } finally {
            setSaving(false);
        }
    };

    if (result) {
        return (
            <Card padding="lg" hover={false}>
                <div role="status">
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Check-in saved</h2>
                    <p className="text-slate-600">Day {result.observation.day_post_op} after your surgery.</p>
                    <p className="mt-4 text-slate-800">Recovery score <strong className="text-2xl">{Math.round(result.score.composite)}</strong> / 100</p>
                    <span className={`inline-block mt-2 px-3 py-1 rounded-full border text-sm font-semibold ${CATEGORIES[result.score.category].className}`}>
                        {CATEGORIES[result.score.category].label}
                    </span>
                    {result.score.limited_history && (
                        <p className="mt-3 text-sm text-slate-500">Based on limited history: your personal baseline builds up over your first few check-ins.</p>
                    )}
                </div>
                <Button className="mt-6" onClick={() => { setForm(blank()); setResult(null); }}>New check-in</Button>
            </Card>
        );
    }

    return (
        <Card padding="lg" hover={false}>
            <form onSubmit={submit}>
                <Errors error={error} />
                <fieldset className="mb-8">
                    <legend className="text-lg font-bold text-slate-900 mb-4">How are you today?</legend>
                    {SCALES.map(({ key, label, low, high }) => (
                        <div key={key} className="mb-6">
                            <label htmlFor={key} className="flex justify-between text-sm font-medium text-slate-700 mb-2">
                                <span>{label}</span>
                                <span>{form[key]} / 10</span>
                            </label>
                            <input id={key} type="range" min={0} max={10} step={1} value={form[key]} onChange={(e) => set(key, Number(e.target.value))} className="w-full accent-emerald-600" aria-valuetext={`${form[key]} out of 10`} />
                            <div className="flex justify-between text-xs text-slate-500 mt-1"><span>0 · {low}</span><span>10 · {high}</span></div>
                        </div>
                    ))}
                </fieldset>

                <fieldset className="mb-8">
                    <legend className="text-lg font-bold text-slate-900 mb-4">Symptoms</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {symptomNames.map((name) => (
                            <div key={name}>
                                <label htmlFor={`symptom-${name}`} className="block text-sm font-medium text-slate-700 mb-2">{humanize(name)}</label>
                                <select id={`symptom-${name}`} value={form.symptoms[name]} onChange={(e) => set('symptoms', { ...form.symptoms, [name]: Number(e.target.value) })} className={INPUT}>
                                    {SEVERITIES.map((s, i) => <option key={s} value={i}>{s}</option>)}
                                </select>
                            </div>
                        ))}
                    </div>
                </fieldset>

                <fieldset className="mb-8">
                    <legend className="text-lg font-bold text-slate-900 mb-1">Medication since your last check-in</legend>
                    <p className="text-sm text-slate-500 mb-4">Leave both at 0 if nothing was prescribed.</p>
                    <div className="grid grid-cols-2 gap-4">
                        {[['doses_prescribed', 'Doses prescribed'], ['doses_taken', 'Doses taken']].map(([key, label]) => (
                            <div key={key}>
                                <label htmlFor={key} className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
                                <input id={key} type="number" min={0} max={1000} step={1} value={form[key]} onChange={(e) => set(key, Number(e.target.value))} className={INPUT} />
                            </div>
                        ))}
                    </div>
                </fieldset>

                <label htmlFor="notes" className="block text-sm font-medium text-slate-700 mb-2">Notes</label>
                <textarea id="notes" rows={3} maxLength={2000} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={`${INPUT} mb-6 resize-none`} />

                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Submit check-in'}</Button>
            </form>
        </Card>
    );
}

export default function CheckInForm() {
    const navigate = useNavigate();
    const { user, loading } = useAuth();
    const [symptomNames, setSymptomNames] = useState(null);
    const [profile, setProfile] = useState(undefined); // undefined: loading; null: not set yet
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user) return;
        const noProfile = (err) => { if (err.status === 404) return null; throw err; };
        Promise.all([recoveryAPI.getConfig(), recoveryAPI.getProfile(user.id).catch(noProfile)])
            .then(([config, p]) => { setSymptomNames(config.params.symptoms); setProfile(p); })
            .catch(setError);
    }, [user]);

    let body;
    if (loading || (user && profile === undefined && !error)) body = <p className="text-slate-600">Loading…</p>;
    else if (!user) {
        body = (
            <Card padding="lg" hover={false}>
                <p className="text-slate-700 mb-4">Please log in to record a check-in.</p>
                <Button onClick={() => navigate('/patient/login')}>Go to login</Button>
            </Card>
        );
    } else if (error) body = <Errors error={error} />;
    else if (profile === null) body = <ProfileForm patientId={user.id} onSaved={setProfile} />;
    else body = <CheckIn patientId={user.id} symptomNames={symptomNames} />;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/20">
            <div className="max-w-3xl mx-auto px-6 py-8">
                <button onClick={() => navigate('/patient/dashboard')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6">
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" /> Back to dashboard
                </button>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                        <ClipboardCheck className="w-6 h-6 text-emerald-600" aria-hidden="true" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900">Daily check-in</h1>
                </div>
                <DecisionSupportNotice className="mb-6" />
                {body}
            </div>
        </div>
    );
}
