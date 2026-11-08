import { describe, expect, it } from 'vitest';
import { formatMetric, runToCsv } from '../../src/utils/research.js';

const engineMetrics = (f1) => ({
    accuracy: 0.9,
    precision: 0.5,
    recall: null,
    f1,
    false_positive_rate: 0.1,
    false_positives: 4,
    false_positives_per_patient: 0.2,
});
const metrics = (f1) => ({ baseline: engineMetrics(f1), nexivo: { ...engineMetrics(f1), three_class: { accuracy: 0.7, macro_f1: 0.6 } } });

describe('formatMetric', () => {
    it('3 decimals for ratios, whole false-positive counts, — for undefined', () => {
        expect(formatMetric('f1', 0.66666)).toBe('0.667');
        expect(formatMetric('false_positives', 12)).toBe('12');
        expect(formatMetric('precision', null)).toBe('—');
    });
});

describe('runToCsv', () => {
    it('lists every metric for both engines on the test and tuning sets; empty for null', () => {
        const csv = runToCsv({ metrics: { ...metrics(0.25), tuning: metrics(0.75) } });
        const lines = csv.trim().split('\n');
        expect(lines[0]).toBe('set,engine,metric,value');
        expect(lines).toHaveLength(1 + 2 * (2 * 7 + 2));
        expect(lines).toContain('test,baseline,f1,0.25');
        expect(lines).toContain('tuning,nexivo,f1,0.75');
        expect(lines).toContain('test,nexivo,recall,');
        expect(lines).toContain('test,nexivo,three_class_macro_f1,0.6');
    });
});
