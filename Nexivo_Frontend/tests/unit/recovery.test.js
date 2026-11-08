import { describe, expect, it } from 'vitest';
import { chartRows, signedPoints, trend } from '../../src/utils/recovery.js';

describe('trend', () => {
    it('maps the score slope to an arrow and a text label', () => {
        expect(trend(1.2)).toEqual({ symbol: '↑', label: 'Improving' });
        expect(trend(0.5).label).toBe('Improving');
        expect(trend(0.49).label).toBe('Steady');
        expect(trend(-0.49).label).toBe('Steady');
        expect(trend(-0.5).label).toBe('Worsening');
        expect(trend(null)).toEqual({ symbol: '–', label: 'No trend yet' });
    });
});

describe('chartRows', () => {
    it('takes raw 0-10 values and normalized symptom/adherence scores from the factors', () => {
        const score = {
            day_post_op: 9,
            composite: 72.345,
            expected: 49.64,
            contributions: [
                { parameter: 'pain', raw_value: 4, normalized: 60 },
                { parameter: 'mobility', raw_value: 7, normalized: 70 },
                { parameter: 'fatigue', raw_value: 2, normalized: 80 },
                { parameter: 'symptoms', raw_value: 2, normalized: 86.6667 },
                { parameter: 'adherence', raw_value: 0.75, normalized: 75 },
                { parameter: 'milestones', raw_value: null, normalized: 100 },
            ],
        };
        expect(chartRows([score])).toEqual([
            { day: 9, score: 72.3, expected: 49.6, pain: 4, mobility: 7, fatigue: 2, symptoms: 86.7, adherence: 75 },
        ]);
    });

    it('scores without factors still give score and expected', () => {
        expect(chartRows([{ day_post_op: 3, composite: 60, expected: 43.2, contributions: null }])).toEqual([
            { day: 3, score: 60, expected: 43.2, pain: null, mobility: null, fatigue: null, symptoms: null, adherence: null },
        ]);
    });
});

describe('signedPoints', () => {
    it('signs and rounds', () => {
        expect(signedPoints(3.24)).toBe('+3.2');
        expect(signedPoints(-10)).toBe('−10');
        expect(signedPoints(0.04)).toBe('0');
    });
});
