import { Card } from './Card';
import { CATEGORIES, signedPoints } from '../utils/recovery';

// Current score, category badge (colour + label), change vs the patient's own baseline.
export const ScoreCard = ({ score }) => {
    if (!score) {
        return (
            <Card padding="lg" hover={false}>
                <h2 className="text-lg font-bold text-slate-900 mb-1">Recovery score</h2>
                <p className="text-slate-600">No check-ins yet.</p>
            </Card>
        );
    }
    const category = CATEGORIES[score.category];
    return (
        <Card padding="lg" hover={false}>
            <h2 className="text-lg font-bold text-slate-900 mb-4">Recovery score</h2>
            <div className="flex flex-wrap items-end gap-4">
                <p className="text-5xl font-bold text-slate-900">
                    {Math.round(score.composite)}
                    <span className="text-xl font-medium text-slate-500"> / 100</span>
                </p>
                <span className={`px-3 py-1 rounded-full border text-sm font-semibold ${category.className}`}>{category.label}</span>
            </div>
            <p className="mt-3 text-slate-600">
                Day {score.day_post_op} after surgery
                {score.baseline !== null && <> · {signedPoints(score.composite - score.baseline)} vs usual ({Math.round(score.baseline)})</>}
            </p>
            {score.limited_history && (
                <p className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
                    Limited history: fewer than 3 earlier check-ins, so fixed score bands decide the category until a personal baseline builds up.
                </p>
            )}
        </Card>
    );
};
