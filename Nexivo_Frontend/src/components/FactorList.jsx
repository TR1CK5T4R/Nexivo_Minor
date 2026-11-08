import { Card } from './Card';
import { PARAMETER_LABELS, signedPoints } from '../utils/recovery';

// "Why this status": each parameter's contribution in points, plus the explanation text.
export const FactorList = ({ score }) => {
    if (!score?.contributions) return null;
    const factors = score.contributions.filter((f) => Math.abs(f.contribution) >= 0.05);
    const max = Math.max(...factors.map((f) => Math.abs(f.contribution)), 1);
    const reference = score.limited_history ? 'the best possible value' : "this patient's usual values";
    return (
        <Card padding="lg" hover={false}>
            <h2 className="text-lg font-bold text-slate-900 mb-1">Why this status</h2>
            <p className="text-sm text-slate-500 mb-4">Points each parameter added or removed, compared with {reference}.</p>
            {factors.length === 0 ? (
                <p className="text-slate-600">{score.explanation}</p>
            ) : (
                <>
                    <ul className="space-y-3 mb-4">
                        {factors.map((f) => (
                            <li key={f.parameter}>
                                <div className="flex justify-between text-sm">
                                    <span className="font-medium text-slate-800">{PARAMETER_LABELS[f.parameter]}</span>
                                    <span className={f.contribution < 0 ? 'text-rose-700' : 'text-emerald-700'}>{signedPoints(f.contribution)} points</span>
                                </div>
                                <div className="h-2 mt-1 bg-slate-100 rounded-full" aria-hidden="true">
                                    <div
                                        className={`h-2 rounded-full ${f.contribution < 0 ? 'bg-rose-400' : 'bg-emerald-400'}`}
                                        style={{ width: `${(Math.abs(f.contribution) / max) * 100}%` }}
                                    />
                                </div>
                            </li>
                        ))}
                    </ul>
                    <p className="text-slate-700">{score.explanation}</p>
                </>
            )}
        </Card>
    );
};
