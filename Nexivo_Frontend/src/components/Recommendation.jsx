import { Lightbulb } from 'lucide-react';

export const Recommendation = ({ score }) => {
    if (!score?.recommendation) return null;
    return (
        <div className="flex items-start gap-3 p-5 bg-emerald-50 border border-emerald-200 rounded-2xl">
            <Lightbulb className="w-6 h-6 text-emerald-700 flex-shrink-0" aria-hidden="true" />
            <div>
                <h2 className="font-bold text-slate-900">Recommendation</h2>
                <p className="text-slate-800">{score.recommendation}</p>
            </div>
        </div>
    );
};
