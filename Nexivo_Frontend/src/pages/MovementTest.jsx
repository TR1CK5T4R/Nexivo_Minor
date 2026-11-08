import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Move } from 'lucide-react';
import { Button, Card, DecisionSupportNotice } from '../components';
import { useAuth } from '../context/AuthContext';
import { useMovementTest } from '../hooks/useMovementTest';
import { MOVEMENTS, shareOfHealthySide } from '../utils/movementTest';

// Time to get into position from the keyboard, then time to do the movement.
const PREPARE_SECONDS = 10;
const MEASURE_SECONDS = 15;

const HINTS = {
    no_person: "We can't see you yet. Step back until you're fully in the picture.",
    not_visible: 'Part of the joint is hidden. Move so it is all in the picture, in good light.',
    not_side_on: 'Turn side-on to the camera.',
    ok: 'Tracking you. Keep the movement slow and steady.',
};

const otherSide = (side) => (side === 'left' ? 'right' : 'left');
const limbName = (movementId) => (movementId === 'knee-flexion' ? 'leg' : 'arm');

// The patient is across the room during the test, so the steps are spoken too.
function say(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function Setup({ onStart }) {
    const [movementId, setMovementId] = useState('shoulder-flexion');
    const [operatedSide, setOperatedSide] = useState('left');
    const [cleared, setCleared] = useState(false);

    return (
        <Card padding="lg" hover={false}>
            <form
                className="space-y-6"
                onSubmit={(e) => {
                    e.preventDefault();
                    onStart({ movementId, operatedSide });
                }}
            >
                <fieldset>
                    <legend className="font-semibold text-slate-900 mb-2">What are we measuring?</legend>
                    {Object.entries(MOVEMENTS).map(([id, m]) => (
                        <label key={id} className="flex items-center gap-2 py-1 text-slate-700">
                            <input
                                type="radio"
                                name="movement"
                                checked={movementId === id}
                                onChange={() => {
                                    setMovementId(id);
                                    setCleared(false);
                                }}
                            />
                            {m.name}
                        </label>
                    ))}
                </fieldset>

                <fieldset>
                    <legend className="font-semibold text-slate-900 mb-2">Which side had surgery?</legend>
                    {['left', 'right'].map((side) => (
                        <label key={side} className="flex items-center gap-2 py-1 text-slate-700 capitalize">
                            <input type="radio" name="side" checked={operatedSide === side} onChange={() => setOperatedSide(side)} />
                            {side}
                        </label>
                    ))}
                </fieldset>

                <div>
                    <h2 className="font-semibold text-slate-900 mb-2">How it works</h2>
                    <ol className="list-decimal list-inside space-y-1 text-slate-700">
                        <li>You test your healthy side first, then the side that had surgery.</li>
                        <li>{MOVEMENTS[movementId].setup}</li>
                        <li>{MOVEMENTS[movementId].action}</li>
                    </ol>
                    <p className="mt-3 text-slate-700">The video stays on this device. Only the angles are used.</p>
                    <p className="mt-3 font-medium text-rose-700">Stop straight away if it hurts. Never force the movement to get a higher number.</p>
                </div>

                <label className="flex items-start gap-2 text-slate-700">
                    <input type="checkbox" className="mt-1" checked={cleared} onChange={(e) => setCleared(e.target.checked)} required />
                    <span>{MOVEMENTS[movementId].clearance}</span>
                </label>

                <Button type="submit" disabled={!cleared}>Start the camera</Button>
            </form>
        </Card>
    );
}

function Running({ movementId, operatedSide, onDone }) {
    const sides = [otherSide(operatedSide), operatedSide];
    const [step, setStep] = useState({ index: 0, phase: 'prepare', secondsLeft: PREPARE_SECONDS });
    const [results, setResults] = useState([]);
    const test = useMovementTest(true, movementId, step.phase === 'measure');
    const side = sides[step.index];
    const { ready, takeResult } = test;

    useEffect(() => {
        if (!ready) return undefined;
        if (step.secondsLeft === PREPARE_SECONDS && step.phase === 'prepare') {
            say(`Get ready. Turn so your ${side} ${limbName(movementId)} is nearest the camera.`);
        }
        const id = setTimeout(() => {
            if (step.secondsLeft > 1) {
                setStep({ ...step, secondsLeft: step.secondsLeft - 1 });
            } else if (step.phase === 'prepare') {
                say('Start now. Move slowly, then hold still.');
                setStep({ ...step, phase: 'measure', secondsLeft: MEASURE_SECONDS });
            } else {
                const next = [...results, takeResult()];
                if (step.index + 1 < sides.length) {
                    setResults(next);
                    setStep({ index: step.index + 1, phase: 'prepare', secondsLeft: PREPARE_SECONDS });
                } else {
                    say('All done.');
                    onDone({ [sides[0]]: next[0], [sides[1]]: next[1] });
                }
            }
        }, 1000);
        return () => clearTimeout(id);
        // sides is rebuilt from operatedSide on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, step, results, takeResult, onDone, movementId, side]);

    return (
        <Card padding="lg" hover={false}>
            {test.cameraError && <p role="alert" className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700">{test.cameraError}</p>}
            <h2 className="text-2xl font-bold text-slate-900 capitalize">
                Test {step.index + 1} of 2: {side} {limbName(movementId)} {side === operatedSide ? '(surgery side)' : '(healthy side)'}
            </h2>
            <p className="text-slate-700 mt-1 mb-4">{MOVEMENTS[movementId].setup}</p>
            <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
                <video ref={test.videoRef} playsInline muted className="w-full h-full object-contain -scale-x-100" />
                <canvas ref={test.canvasRef} className="absolute inset-0 w-full h-full object-contain -scale-x-100 pointer-events-none" />
                {!ready && !test.cameraError && (
                    <p role="status" className="absolute inset-0 flex items-center justify-center text-white text-xl">Starting the camera...</p>
                )}
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4 text-center">
                <div>
                    <p className="text-sm text-slate-600">{step.phase === 'prepare' ? 'Get ready' : 'Move now'}</p>
                    <p className="text-5xl font-bold text-slate-900" aria-live="off">{step.secondsLeft}s</p>
                </div>
                <div>
                    <p className="text-sm text-slate-600">Angle now</p>
                    <p className="text-5xl font-bold text-emerald-600" aria-live="off">{test.live.degrees === null ? '–' : `${test.live.degrees}°`}</p>
                </div>
                <div>
                    <p className="text-sm text-slate-600">Best held</p>
                    <p className="text-5xl font-bold text-slate-900" aria-live="off">{test.best ? `${Math.round(test.best.degrees)}°` : '–'}</p>
                </div>
            </div>
            <p role="status" className="mt-4 text-center text-lg font-medium text-slate-800">
                {step.phase === 'measure' && test.live.status === 'ok' ? MOVEMENTS[movementId].action : HINTS[test.live.status]}
            </p>
        </Card>
    );
}

function Results({ movementId, operatedSide, results, onAgain }) {
    const healthySide = otherSide(operatedSide);
    const operated = results[operatedSide];
    const healthy = results[healthySide];
    const share = shareOfHealthySide(operated?.degrees ?? null, healthy?.degrees ?? null);
    const degrees = (r) => (r ? `${Math.round(r.degrees)}°` : 'No steady hold');

    return (
        <Card padding="lg" hover={false}>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">{MOVEMENTS[movementId].name}: your result</h2>
            <dl className="grid grid-cols-2 gap-4 text-center">
                <div className="p-4 bg-slate-50 rounded-xl">
                    <dt className="text-sm text-slate-600 capitalize">{operatedSide} (surgery side)</dt>
                    <dd className="text-4xl font-bold text-slate-900">{degrees(operated)}</dd>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl">
                    <dt className="text-sm text-slate-600 capitalize">{healthySide} (healthy side)</dt>
                    <dd className="text-4xl font-bold text-slate-900">{degrees(healthy)}</dd>
                </div>
            </dl>
            <p className="mt-4 text-lg text-slate-800">
                {share === null
                    ? 'We need a steady hold on both sides to compare them. Please try again.'
                    : `Your surgery side reaches ${Math.round(share)}% of your healthy side.`}
            </p>
            <p className="mt-2 text-sm text-slate-600">
                Camera measurements are an estimate and depend on where the camera is. This result isn't saved yet.
            </p>
            <details className="mt-4 text-sm text-slate-600">
                <summary className="cursor-pointer">Values for the accuracy check</summary>
                <ul className="mt-2 space-y-1">
                    {[[operatedSide, operated], [healthySide, healthy]].map(([side, r]) => (
                        <li key={side} className="capitalize">
                            {side}: from the picture {r ? r.degrees.toFixed(1) : '–'}°, from the 3D estimate {r?.degrees3d != null ? r.degrees3d.toFixed(1) : '–'}°
                        </li>
                    ))}
                </ul>
            </details>
            <Button className="mt-6" onClick={onAgain}>Test again</Button>
        </Card>
    );
}

// Nexivo Measured Recovery: a guided camera test of how far a joint moves.
export default function MovementTest() {
    const navigate = useNavigate();
    const { user, loading } = useAuth();
    const [choice, setChoice] = useState(null);
    const [results, setResults] = useState(null);

    let body;
    if (loading) {
        body = <p className="text-slate-600" role="status">Loading...</p>;
    } else if (!user) {
        body = (
            <Card padding="lg" hover={false}>
                <p className="text-slate-700 mb-4">Please log in to use the movement test.</p>
                <Button onClick={() => navigate('/patient/login')}>Go to login</Button>
            </Card>
        );
    } else if (results) {
        body = <Results {...choice} results={results} onAgain={() => { setResults(null); setChoice(null); }} />;
    } else if (choice) {
        body = <Running {...choice} onDone={setResults} />;
    } else {
        body = <Setup onStart={setChoice} />;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/20">
            <div className="max-w-3xl mx-auto px-6 py-8">
                <button onClick={() => navigate('/patient/dashboard')} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6">
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" /> Back to dashboard
                </button>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                        <Move className="w-6 h-6 text-emerald-600" aria-hidden="true" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900">Movement test</h1>
                </div>
                <DecisionSupportNotice className="mb-6" />
                {body}
            </div>
        </div>
    );
}
