// Nexivo Measured Recovery: range of motion, in degrees, from pose landmarks. Pure:
// no camera, no React, no clock. The browser hook (hooks/useMovementTest.js) feeds it
// one MediaPipe result per video frame.
//
// The movements are the ones clinical trials report: active shoulder
// forward flexion and knee flexion. Both are seen from the side, one side at a time.
//
// Unlike the rep counter (exerciseLogic.js), which keeps Django's normalized
// coordinates, angles here use real pixels: x and y are fractions of a different
// width and height, so normalized angles are wrong on any non-square camera.

import { calculateAngle } from './exerciseLogic';

// Starting values, to be checked against real measurements.
export const LIMITS = Object.freeze({
    minVisibility: 0.5,
    // Horizontal distance between the shoulders ÷ torso length. Near 0 is exactly side-on; about 0.7 is facing the camera.
    maxShoulderSpread: 0.35,
    holdMs: 1000,
    holdToleranceDegrees: 6,
    holdMinFrames: 5,
    maxFrameGapMs: 300,
});

// joints: [left side, right side] MediaPipe indices of the three points around the joint.
export const MOVEMENTS = Object.freeze({
    'shoulder-flexion': {
        name: 'Shoulder forward raise',
        joints: { left: [23, 11, 13], right: [24, 12, 14] }, // hip, shoulder, elbow
        toDegrees: (inner) => inner, // arm down ≈ 0°, straight overhead ≈ 180°
        setup: 'Stand side-on to the camera, with the arm being tested nearest to it. Your head, hips and hand must all be in the picture.',
        action: 'Keep your elbow straight and raise your arm forward and up, as high as is comfortable. Hold it still for 2 seconds.',
        clearance: 'My surgeon or physio has cleared me to raise this arm on its own. Some people are told not to in the first weeks after shoulder surgery.',
    },
    'knee-flexion': {
        name: 'Knee bend',
        joints: { left: [23, 25, 27], right: [24, 26, 28] }, // hip, knee, ankle
        toDegrees: (inner) => 180 - inner, // straight leg ≈ 0°
        setup: 'Sit on the edge of a firm chair, side-on to the camera, with the leg being tested nearest to it. Your shoulders, hips and foot must all be in the picture.',
        action: 'Slide your foot back under the chair as far as is comfortable, keeping it on the floor. Hold it still for 2 seconds.',
        clearance: 'My surgeon or physio has cleared me to bend this knee on my own.',
    },
});

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Angle at b between a and c, in degrees, from 3D points. */
export function angle3d(a, b, c) {
    const u = [a.x - b.x, a.y - b.y, a.z - b.z];
    const v = [c.x - b.x, c.y - b.y, c.z - b.z];
    const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const size = Math.hypot(...u) * Math.hypot(...v);
    if (size === 0) return 0;
    return (Math.acos(Math.min(1, Math.max(-1, dot / size))) * 180) / Math.PI;
}

/**
 * One video frame. The side measured is the one nearest the camera, not the one MediaPipe
 * labels left or right: those labels are unreliable from the side.
 * shortcut: nothing checks the patient turned the side the page asked for; Phase 2 stores
 * results per requested side, so compare the facing direction there if mix-ups show up.
 *
 * @param {keyof typeof MOVEMENTS} movementId
 * @param {{ x: number, y: number, z: number, visibility: number }[] | undefined} landmarks normalized
 * @param {{ x: number, y: number, z: number }[] | undefined} worldLandmarks metres, for the 3D angle
 * @param {{ width: number, height: number }} size the video's size in pixels
 * @returns {{ status: 'ok', degrees: number, degrees3d: number | null, joint: number[] }
 *   | { status: 'no_person' | 'not_visible' | 'not_side_on' }}
 */
export function readFrame(movementId, landmarks, worldLandmarks, { width, height }) {
    if (!landmarks) return { status: 'no_person' };
    const movement = MOVEMENTS[movementId];
    const pixel = (i) => [landmarks[i].x * width, landmarks[i].y * height];

    const near = landmarks[LEFT_SHOULDER].z + landmarks[LEFT_HIP].z < landmarks[RIGHT_SHOULDER].z + landmarks[RIGHT_HIP].z;
    const joint = near ? movement.joints.left : movement.joints.right;
    const visible = joint.every((i) => {
        const { x, y, visibility } = landmarks[i];
        return visibility >= LIMITS.minVisibility && x >= 0 && x <= 1 && y >= 0 && y <= 1;
    });
    if (!visible) return { status: 'not_visible' };

    const shoulderHip = near ? [LEFT_SHOULDER, LEFT_HIP] : [RIGHT_SHOULDER, RIGHT_HIP];
    const torso = Math.hypot(pixel(shoulderHip[0])[0] - pixel(shoulderHip[1])[0], pixel(shoulderHip[0])[1] - pixel(shoulderHip[1])[1]);
    const shoulderSpread = Math.abs(pixel(LEFT_SHOULDER)[0] - pixel(RIGHT_SHOULDER)[0]);
    if (torso === 0 || shoulderSpread / torso > LIMITS.maxShoulderSpread) return { status: 'not_side_on' };

    const [a, b, c] = joint;
    return {
        status: 'ok',
        degrees: movement.toDegrees(calculateAngle(pixel(a), pixel(b), pixel(c))),
        degrees3d: worldLandmarks ? movement.toDegrees(angle3d(worldLandmarks[a], worldLandmarks[b], worldLandmarks[c])) : null,
        joint,
    };
}

export const createMeasurement = () => ({ recent: [], best: null });

/**
 * Adds one frame. The result is the highest position actually held still for holdMs,
 * so a tracking glitch or a swing through the top of the movement doesn't count.
 *
 * @param {ReturnType<typeof createMeasurement>} measurement
 * @param {number} timeMs when the frame was seen
 * @param {ReturnType<typeof readFrame>} frame
 * @returns {ReturnType<typeof createMeasurement>} a new measurement; the input isn't modified
 */
export function addFrame(measurement, timeMs, frame) {
    if (frame.status !== 'ok') return { ...measurement, recent: [] };
    const last = measurement.recent.at(-1);
    const continues = last && timeMs - last.timeMs <= LIMITS.maxFrameGapMs;
    const recent = [...(continues ? measurement.recent : []), { timeMs, degrees: frame.degrees, degrees3d: frame.degrees3d }];
    while (timeMs - recent[1]?.timeMs >= LIMITS.holdMs) recent.shift();

    const angles = recent.map((f) => f.degrees);
    const held =
        recent.length >= LIMITS.holdMinFrames &&
        timeMs - recent[0].timeMs >= LIMITS.holdMs &&
        Math.max(...angles) - Math.min(...angles) <= LIMITS.holdToleranceDegrees;
    if (!held) return { ...measurement, recent };

    const degrees = median(angles);
    if (measurement.best && measurement.best.degrees >= degrees) return { ...measurement, recent };
    const others = recent.map((f) => f.degrees3d).filter((d) => d !== null);
    return { recent, best: { degrees, degrees3d: others.length ? median(others) : null } };
}

/**
 * The operated side as a share of the healthy side, which is the patient's own reference.
 *
 * @param {number | null} operated degrees
 * @param {number | null} healthy degrees
 * @returns {number | null} a percentage, or null when either side has no usable result
 */
export function shareOfHealthySide(operated, healthy) {
    if (operated === null || healthy === null || healthy <= 0) return null;
    return (operated / healthy) * 100;
}
