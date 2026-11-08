// Nexivo research dashboard helpers (spec M6).

export const BINARY_METRICS = [
    ['accuracy', 'Accuracy'],
    ['precision', 'Precision'],
    ['recall', 'Recall'],
    ['f1', 'F1-score'],
    ['false_positive_rate', 'False-positive rate'],
    ['false_positives', 'False positives'],
    ['false_positives_per_patient', 'False positives per patient'],
];

// Counts as whole numbers, ratios to 3 decimals, undefined ratios as "—".
export function formatMetric(key, value) {
    if (value === null || value === undefined) return '—';
    return key === 'false_positives' ? String(value) : value.toFixed(3);
}

/** One run → CSV rows "set,engine,metric,value" (test and tuning sets) for the paper. */
export function runToCsv(run) {
    const lines = ['set,engine,metric,value'];
    const add = (set, metrics) => {
        for (const engine of ['baseline', 'nexivo']) {
            for (const [key] of BINARY_METRICS) lines.push(`${set},${engine},${key},${metrics[engine][key] ?? ''}`);
        }
        lines.push(`${set},nexivo,three_class_accuracy,${metrics.nexivo.three_class.accuracy ?? ''}`);
        lines.push(`${set},nexivo,three_class_macro_f1,${metrics.nexivo.three_class.macro_f1 ?? ''}`);
    };
    add('test', run.metrics);
    add('tuning', run.metrics.tuning);
    return `${lines.join('\n')}\n`;
}
