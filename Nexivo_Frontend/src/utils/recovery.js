// Nexivo recovery categories (spec M5): a colour and always the text label, never colour alone.
export const CATEGORIES = {
    normal: { label: 'Normal', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    slower: { label: 'Slower than expected', className: 'bg-amber-100 text-amber-900 border-amber-300' },
    attention: { label: 'Requires attention', className: 'bg-rose-100 text-rose-800 border-rose-300' },
};

// Alert severities (spec M3), with the same rule: text label always shown.
export const ALERT_SEVERITIES = {
    high: { label: 'High', className: 'bg-rose-50 border-rose-200 text-rose-900' },
    medium: { label: 'Medium', className: 'bg-amber-50 border-amber-200 text-amber-900' },
    low: { label: 'Low', className: 'bg-slate-50 border-slate-200 text-slate-700' },
};

export const PARAMETER_LABELS = {
    pain: 'Pain',
    mobility: 'Mobility',
    fatigue: 'Fatigue',
    symptoms: 'Symptom score',
    adherence: 'Medication adherence',
    milestones: 'Milestones completed',
};

const round1 = (x) => Math.round(x * 10) / 10;

// Trend arrow from the score slope (points per day), always with a text label.
// ±0.5 matches the default min_slope_per_day in the scoring config.
export function trend(slope) {
    if (slope === null || slope === undefined) return { symbol: '–', label: 'No trend yet' };
    if (slope >= 0.5) return { symbol: '↑', label: 'Improving' };
    if (slope <= -0.5) return { symbol: '↓', label: 'Worsening' };
    return { symbol: '→', label: 'Steady' };
}

// Score history → chart rows. Pain, mobility and fatigue on 0-10; symptom score
// and adherence on 0-100 (their normalized values). Scores from before
// explanations existed have no factors, so only score and expected are shown.
export function chartRows(scores) {
    return scores.map((s) => {
        const f = Object.fromEntries((s.contributions ?? []).map((c) => [c.parameter, c]));
        return {
            day: s.day_post_op,
            score: round1(s.composite),
            expected: round1(s.expected),
            pain: f.pain?.raw_value ?? null,
            mobility: f.mobility?.raw_value ?? null,
            fatigue: f.fatigue?.raw_value ?? null,
            symptoms: f.symptoms ? round1(f.symptoms.normalized) : null,
            adherence: f.adherence ? round1(f.adherence.normalized) : null,
        };
    });
}

// "+3.2" / "−4" / "0": signed points, one decimal at most.
export function signedPoints(x) {
    const r = round1(x);
    if (r === 0) return '0';
    return `${r > 0 ? '+' : '−'}${Math.abs(r)}`;
}
