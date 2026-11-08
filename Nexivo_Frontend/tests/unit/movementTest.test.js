// Measured Recovery: angles from landmarks, and the "held still" rule for the result.
import { describe, expect, it } from 'vitest';
import {
    addFrame,
    angle3d,
    createMeasurement,
    LIMITS,
    readFrame,
    shareOfHealthySide,
} from '../../src/utils/movementTest';

const SIZE = { width: 1280, height: 720 };
const px = (x, y) => ({ x: x / SIZE.width, y: y / SIZE.height, z: 0, visibility: 0.9 });

// A person side-on, left side nearest (lower z). Upright torso from (600, 400) to (600, 200).
function person(overrides = {}) {
    const points = Array.from({ length: 33 }, () => px(0, 0));
    points[11] = { ...px(600, 200), z: -0.2 }; // left shoulder
    points[12] = { ...px(620, 200), z: 0.2 }; // right shoulder, hidden behind
    points[23] = { ...px(600, 400), z: -0.2 }; // left hip
    points[24] = { ...px(620, 400), z: 0.2 }; // right hip
    points[13] = { ...px(600, 300), z: -0.2 }; // left elbow: arm down
    points[25] = { ...px(600, 550), z: -0.2 }; // left knee, straight below the hip
    points[27] = { ...px(600, 700), z: -0.2 }; // left ankle
    return Object.assign(points, overrides);
}
const shoulder = (landmarks) => readFrame('shoulder-flexion', landmarks, undefined, SIZE);
const ok = (degrees) => ({ status: 'ok', degrees, degrees3d: degrees + 1 });

describe('readFrame', () => {
    it('measures the raised arm in real pixels, so a wide camera does not distort it', () => {
        // Horizontal arm: 90° on screen. In normalized coordinates this would read about 60°.
        expect(shoulder(person({ 13: { ...px(700, 200), z: -0.2 } })).degrees).toBeCloseTo(90, 5);
        // 45° up from horizontal: 135°.
        expect(shoulder(person({ 13: { ...px(700, 100), z: -0.2 } })).degrees).toBeCloseTo(135, 5);
        expect(shoulder(person()).degrees).toBeCloseTo(0, 5);
    });

    it('reports a straight knee as 0° and a bent knee as its flexion', () => {
        const read = (ankle) => readFrame('knee-flexion', person({ 27: { ...px(...ankle), z: -0.2 } }), undefined, SIZE).degrees;
        expect(read([600, 700])).toBeCloseTo(0, 5);
        expect(read([750, 550])).toBeCloseTo(90, 5);
    });

    it('uses the side nearest the camera, whatever MediaPipe calls it', () => {
        const landmarks = person();
        landmarks[11].z = 0.2;
        landmarks[23].z = 0.2;
        landmarks[12].z = -0.2;
        landmarks[24].z = -0.2;
        landmarks[14] = { ...px(720, 200), z: -0.2 }; // right elbow: arm horizontal
        const frame = shoulder(landmarks);
        expect(frame.joint).toEqual([24, 12, 14]);
        expect(frame.degrees).toBeCloseTo(90, 5);
    });

    it('refuses to measure without a person, a visible joint or a side-on view', () => {
        expect(shoulder(undefined).status).toBe('no_person');
        expect(shoulder(person({ 13: { ...px(600, 300), z: -0.2, visibility: 0.2 } })).status).toBe('not_visible');
        expect(shoulder(person({ 13: { x: 1.2, y: 0.5, z: -0.2, visibility: 0.9 } })).status).toBe('not_visible');
        // Shoulders 150 px apart on a 200 px torso: facing the camera, where a forward raise can't be seen.
        expect(shoulder(person({ 12: { ...px(750, 200), z: 0.2 } })).status).toBe('not_side_on');
    });

    it('gives the 3D angle from world landmarks when there are any', () => {
        const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
        world[23] = { x: 0, y: 1, z: 0 };
        world[13] = { x: 0, y: 0, z: 1 };
        expect(readFrame('shoulder-flexion', person(), world, SIZE).degrees3d).toBeCloseTo(90, 5);
        expect(shoulder(person()).degrees3d).toBeNull();
    });
});

describe('angle3d', () => {
    it('handles a zero-length limb without failing', () => {
        const p = { x: 1, y: 1, z: 1 };
        expect(angle3d(p, p, { x: 2, y: 1, z: 1 })).toBe(0);
    });
});

describe('addFrame', () => {
    // Frames every 100 ms from a starting time.
    const run = (values, from = createMeasurement(), start = 0) =>
        values.reduce((m, value, i) => addFrame(m, start + i * 100, value === null ? { status: 'not_visible' } : ok(value)), from);
    const hold = (degrees, frames = 12) => Array(frames).fill(degrees);

    it('takes the median of a position held for a second', () => {
        const { best } = run([100, 101, 102, 101, 100, 101, 102, 101, 100, 101, 102, 101]);
        expect(best).toEqual({ degrees: 101, degrees3d: 102 });
    });

    it('ignores a swing or a tracking spike that is never held', () => {
        expect(run([10, 40, 80, 120, 170, 120, 80, 40, 10, 40, 80, 120]).best).toBeNull();
        const spike = [...hold(100, 6), 175, ...hold(100, 12)];
        expect(run(spike).best.degrees).toBe(100);
    });

    it('needs the whole hold: a shorter one does not count', () => {
        expect(run(hold(120, LIMITS.holdMs / 100)).best).toBeNull();
    });

    it('a lost frame restarts the hold', () => {
        expect(run([...hold(120, 6), null, ...hold(120, 6)]).best).toBeNull();
    });

    it('a gap between frames restarts the hold, even with enough frames', () => {
        let m = createMeasurement();
        m = run(hold(120, 6), m, 0);
        m = run(hold(120, 6), m, 1000);
        expect(m.best).toBeNull();
    });

    it('keeps the highest held position, even after the arm comes down', () => {
        const { best } = run([...hold(90), ...hold(140), ...hold(30)]);
        expect(best.degrees).toBe(140);
    });

    it('does not change its input', () => {
        const before = createMeasurement();
        addFrame(before, 0, ok(90));
        expect(before).toEqual(createMeasurement());
    });
});

describe('shareOfHealthySide', () => {
    it('is the operated side as a percentage of the healthy side', () => {
        expect(shareOfHealthySide(95, 140)).toBeCloseTo(67.86, 1);
        expect(shareOfHealthySide(null, 140)).toBeNull();
        expect(shareOfHealthySide(95, null)).toBeNull();
        expect(shareOfHealthySide(95, 0)).toBeNull();
    });
});
