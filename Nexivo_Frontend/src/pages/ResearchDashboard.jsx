import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FlaskConical } from 'lucide-react';
import { Button, Card } from '../components';
import { researchAPI } from '../services/djangoApi';
import { BINARY_METRICS, formatMetric, runToCsv } from '../utils/research';

// Nexivo research dashboard (spec M6): datasets, evaluation runs, and a
// side-by-side comparison of the fixed-threshold baseline and Nexivo.
const INPUT = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-400';
const CLASSES = [
    ['normal', 'Normal'],
    ['slower', 'Slower'],
    ['attention', 'Attention'],
];

function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function HonestyNote() {
    return (
        <div role="note" className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900">
            Results on synthetic data validate the pipeline and illustrate how the engines behave. They are not clinical evidence.
            Clinical claims require validated datasets and ethical approval (future scope).
        </div>
    );
}

function BinaryConfusion({ title, c }) {
    return (
        <table className="text-sm border border-slate-200">
            <caption className="text-left font-semibold text-slate-800 mb-1">{title}</caption>
            <thead className="bg-slate-50">
                <tr>
                    <th scope="col" className="px-3 py-1 text-left">Actual \ Flagged</th>
                    <th scope="col" className="px-3 py-1">Yes</th>
                    <th scope="col" className="px-3 py-1">No</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <th scope="row" className="px-3 py-1 text-left">Attention</th>
                    <td className="px-3 py-1 text-center">{c.tp}</td>
                    <td className="px-3 py-1 text-center">{c.fn}</td>
                </tr>
                <tr>
                    <th scope="row" className="px-3 py-1 text-left">Not attention</th>
                    <td className="px-3 py-1 text-center">{c.fp}</td>
                    <td className="px-3 py-1 text-center">{c.tn}</td>
                </tr>
            </tbody>
        </table>
    );
}

function ThreeClassConfusion({ matrix }) {
    return (
        <table className="text-sm border border-slate-200">
            <caption className="text-left font-semibold text-slate-800 mb-1">Nexivo, 3 classes</caption>
            <thead className="bg-slate-50">
                <tr>
                    <th scope="col" className="px-3 py-1 text-left">Actual \ Predicted</th>
                    {CLASSES.map(([k, label]) => <th key={k} scope="col" className="px-3 py-1">{label}</th>)}
                </tr>
            </thead>
            <tbody>
                {CLASSES.map(([actual, label]) => (
                    <tr key={actual}>
                        <th scope="row" className="px-3 py-1 text-left">{label}</th>
                        {CLASSES.map(([predicted]) => <td key={predicted} className="px-3 py-1 text-center">{matrix[actual][predicted]}</td>)}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function RunResults({ run }) {
    const m = run.metrics;
    return (
        <Card padding="lg" hover={false}>
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-lg font-bold text-slate-900">Run #{run.id}: {run.dataset_name}</h2>
                    <p className="text-sm text-slate-600">
                        Config {run.config_version} · split seed {run.seed} · test set {run.split.test.length} patients ({m.baseline.observations} check-ins) ·
                        tuning set {run.split.tuning.length} patients
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => download(`nexivo-run-${run.id}.csv`, runToCsv(run), 'text/csv')}>CSV</Button>
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => download(`nexivo-run-${run.id}.json`, JSON.stringify(run, null, 2), 'application/json')}>JSON</Button>
                </div>
            </div>
            <div className="overflow-x-auto mb-6">
                <table className="w-full text-sm">
                    <caption className="text-left text-slate-600 mb-2">Test set. Positive class: Requires attention.</caption>
                    <thead className="bg-slate-50 text-slate-600">
                        <tr>
                            <th scope="col" className="px-3 py-2 text-left">Metric</th>
                            <th scope="col" className="px-3 py-2 text-right">Fixed-threshold baseline (ReviveCare-style)</th>
                            <th scope="col" className="px-3 py-2 text-right">Nexivo</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {BINARY_METRICS.map(([key, label]) => (
                            <tr key={key}>
                                <th scope="row" className="px-3 py-2 text-left font-medium">{label}</th>
                                <td className="px-3 py-2 text-right">{formatMetric(key, m.baseline[key])}</td>
                                <td className="px-3 py-2 text-right">{formatMetric(key, m.nexivo[key])}</td>
                            </tr>
                        ))}
                        <tr>
                            <th scope="row" className="px-3 py-2 text-left font-medium">3-class accuracy</th>
                            <td className="px-3 py-2 text-right">— (2 classes)</td>
                            <td className="px-3 py-2 text-right">{formatMetric('accuracy', m.nexivo.three_class.accuracy)}</td>
                        </tr>
                        <tr>
                            <th scope="row" className="px-3 py-2 text-left font-medium">3-class macro-F1</th>
                            <td className="px-3 py-2 text-right">— (2 classes)</td>
                            <td className="px-3 py-2 text-right">{formatMetric('f1', m.nexivo.three_class.macro_f1)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div className="flex flex-wrap gap-6">
                <BinaryConfusion title="Baseline" c={run.confusion.baseline} />
                <BinaryConfusion title="Nexivo" c={run.confusion.nexivo} />
                <ThreeClassConfusion matrix={run.confusion.nexivo_three_class} />
            </div>
            <p className="mt-4 text-xs text-slate-500">
                Thresholds may be adjusted only using the tuning-set numbers (in the JSON export); the table above is the held-out test set.
            </p>
        </Card>
    );
}

export default function ResearchDashboard() {
    const navigate = useNavigate();
    const [datasets, setDatasets] = useState([]);
    const [runs, setRuns] = useState([]);
    const [datasetId, setDatasetId] = useState('');
    const [run, setRun] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [synthetic, setSynthetic] = useState({ name: 'Synthetic 42', seed: 42, patients: 60 });
    const [csvName, setCsvName] = useState('');
    const [csvFile, setCsvFile] = useState(null);
    const [splitSeed, setSplitSeed] = useState(7);

    const load = useCallback(async () => {
        const [d, r] = await Promise.all([researchAPI.listDatasets(), researchAPI.listRuns()]);
        setDatasets(d);
        setRuns(r);
        setDatasetId((current) => current || (d[0] ? String(d[0].id) : ''));
    }, []);

    useEffect(() => {
        load().catch(setError);
    }, [load]);

    const act = async (fn) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    };
    const createSynthetic = (e) => {
        e.preventDefault();
        act(async () => {
            const d = await researchAPI.createDataset({ source: 'synthetic', ...synthetic });
            setDatasetId(String(d.id));
            await load();
        });
    };
    const importCsv = (e) => {
        e.preventDefault();
        act(async () => {
            const d = await researchAPI.createDataset({ source: 'csv', name: csvName.trim() || csvFile.name, csv: await csvFile.text() });
            setDatasetId(String(d.id));
            await load();
        });
    };
    const runEvaluation = (e) => {
        e.preventDefault();
        act(async () => {
            setRun(await researchAPI.runEvaluation(Number(datasetId), Number(splitSeed)));
            await load();
        });
    };
    const openRun = (id) => act(async () => setRun(await researchAPI.getRun(id)));

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/20">
            <div className="max-w-7xl mx-auto px-6 py-8">
                <button onClick={() => navigate('/doctor')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6">
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" /> Back to doctor dashboard
                </button>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                        <FlaskConical className="w-6 h-6 text-emerald-600" aria-hidden="true" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900">Research evaluation</h1>
                        <p className="text-slate-600">Fixed-threshold baseline vs Nexivo, replayed check-in by check-in without look-ahead.</p>
                    </div>
                </div>
                <HonestyNote />
                {error && (
                    <div role="alert" className="mt-4 p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
                        <p className="font-semibold">{error.message}</p>
                        {error.fields && Object.values(error.fields).map((m) => <p key={m}>{m}</p>)}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                    <Card padding="lg" hover={false}>
                        <h2 className="text-lg font-bold text-slate-900 mb-3">Generate synthetic data</h2>
                        <form onSubmit={createSynthetic} className="space-y-3">
                            <div>
                                <label htmlFor="syn-name" className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                                <input id="syn-name" required maxLength={100} value={synthetic.name} onChange={(e) => setSynthetic({ ...synthetic, name: e.target.value })} className={INPUT} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="syn-seed" className="block text-sm font-medium text-slate-700 mb-1">Seed</label>
                                    <input id="syn-seed" type="number" required min={0} max={2147483647} value={synthetic.seed} onChange={(e) => setSynthetic({ ...synthetic, seed: Number(e.target.value) })} className={INPUT} />
                                </div>
                                <div>
                                    <label htmlFor="syn-patients" className="block text-sm font-medium text-slate-700 mb-1">Patients</label>
                                    <input id="syn-patients" type="number" required min={10} max={500} value={synthetic.patients} onChange={(e) => setSynthetic({ ...synthetic, patients: Number(e.target.value) })} className={INPUT} />
                                </div>
                            </div>
                            <Button type="submit" size="sm" disabled={busy}>Generate</Button>
                        </form>
                    </Card>

                    <Card padding="lg" hover={false}>
                        <h2 className="text-lg font-bold text-slate-900 mb-1">Import a CSV</h2>
                        <p className="text-xs text-slate-500 mb-3">
                            Synthetic or de-identified research data only. Columns: patient_id, day_post_op, pain, mobility, fatigue, symptom columns,
                            doses_prescribed, doses_taken, milestones_completed, milestones_due, label.
                        </p>
                        <form onSubmit={importCsv} className="space-y-3">
                            <div>
                                <label htmlFor="csv-name" className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                                <input id="csv-name" maxLength={100} value={csvName} onChange={(e) => setCsvName(e.target.value)} placeholder="Defaults to the file name" className={INPUT} />
                            </div>
                            <div>
                                <label htmlFor="csv-file" className="block text-sm font-medium text-slate-700 mb-1">File</label>
                                <input id="csv-file" type="file" required accept=".csv,text/csv" onChange={(e) => setCsvFile(e.target.files[0] ?? null)} className="text-sm" />
                            </div>
                            <Button type="submit" size="sm" disabled={busy || !csvFile}>Import</Button>
                        </form>
                    </Card>

                    <Card padding="lg" hover={false}>
                        <h2 className="text-lg font-bold text-slate-900 mb-3">Run an evaluation</h2>
                        <form onSubmit={runEvaluation} className="space-y-3">
                            <div>
                                <label htmlFor="dataset" className="block text-sm font-medium text-slate-700 mb-1">Dataset</label>
                                <select id="dataset" required value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className={INPUT}>
                                    {datasets.length === 0 && <option value="">No datasets yet</option>}
                                    {datasets.map((d) => (
                                        <option key={d.id} value={d.id}>
                                            #{d.id} {d.name} ({d.patient_count} patients, {d.observation_count} check-ins)
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="split-seed" className="block text-sm font-medium text-slate-700 mb-1">Split seed (30% tuning / 70% test)</label>
                                <input id="split-seed" type="number" required min={0} max={2147483647} value={splitSeed} onChange={(e) => setSplitSeed(e.target.value)} className={INPUT} />
                            </div>
                            <Button type="submit" size="sm" disabled={busy || !datasetId}>{busy ? 'Working…' : 'Run'}</Button>
                        </form>
                    </Card>
                </div>

                <div className="mt-6 space-y-6">
                    {run && <RunResults run={run} />}
                    {runs.length > 0 && (
                        <Card padding="none" hover={false} className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <caption className="text-left font-bold text-slate-900 px-4 pt-4 pb-2 text-lg">Runs</caption>
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th scope="col" className="px-4 py-2 text-left">Run</th>
                                        <th scope="col" className="px-4 py-2 text-left">Dataset</th>
                                        <th scope="col" className="px-4 py-2 text-left">Config</th>
                                        <th scope="col" className="px-4 py-2 text-left">Seed</th>
                                        <th scope="col" className="px-4 py-2 text-right">Baseline F1</th>
                                        <th scope="col" className="px-4 py-2 text-right">Nexivo F1</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {runs.map((r) => (
                                        <tr key={r.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-2">
                                                <button type="button" onClick={() => openRun(r.id)} className="font-medium text-emerald-700 hover:underline">#{r.id}</button>
                                            </td>
                                            <td className="px-4 py-2">{r.dataset_name}</td>
                                            <td className="px-4 py-2">{r.config_version}</td>
                                            <td className="px-4 py-2">{r.seed}</td>
                                            <td className="px-4 py-2 text-right">{formatMetric('f1', r.baseline_f1)}</td>
                                            <td className="px-4 py-2 text-right">{formatMetric('f1', r.nexivo_f1)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
