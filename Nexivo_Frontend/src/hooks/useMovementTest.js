// One side of the movement test: reads each camera frame and keeps the measurement.
// The video stays in the browser; only the numbers leave this hook.
import { useCallback, useRef, useState } from 'react';
import { usePoseCamera } from './usePoseCamera';
import { addFrame, createMeasurement, readFrame } from '../utils/movementTest';

function drawJoint(canvas, video, landmarks, joint) {
    const ctx = canvas.getContext('2d');
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!joint) return;
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 6;
    ctx.beginPath();
    joint.forEach((i, index) => {
        const x = landmarks[i].x * canvas.width;
        const y = landmarks[i].y * canvas.height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
}

/**
 * @param {boolean} cameraOn
 * @param {string} movementId a key of MOVEMENTS
 * @param {boolean} measuring frames count towards the result only while this is true
 */
export function useMovementTest(cameraOn, movementId, measuring) {
    const measurementRef = useRef(createMeasurement());
    const [live, setLive] = useState({ status: 'no_person', degrees: null });
    const [best, setBest] = useState(null);

    const onFrame = useCallback(
        (result, video, canvas) => {
            const landmarks = result.landmarks[0];
            const frame = readFrame(movementId, landmarks, result.worldLandmarks[0], {
                width: video.videoWidth,
                height: video.videoHeight,
            });
            if (measuring) {
                const next = addFrame(measurementRef.current, performance.now(), frame);
                if (next.best !== measurementRef.current.best) setBest(next.best);
                measurementRef.current = next;
            }
            const degrees = frame.status === 'ok' ? Math.round(frame.degrees) : null;
            // Re-render only when something the page shows changed, not on every frame.
            setLive((was) => (was.status === frame.status && was.degrees === degrees ? was : { status: frame.status, degrees }));
            if (canvas) drawJoint(canvas, video, landmarks, frame.joint);
        },
        [movementId, measuring],
    );
    const camera = usePoseCamera(cameraOn, onFrame);

    /** This side's result ({degrees, degrees3d}, or null if nothing was held still), ready for the next side. */
    const takeResult = useCallback(() => {
        const result = measurementRef.current.best;
        measurementRef.current = createMeasurement();
        setBest(null);
        return result;
    }, []);

    return { ...camera, live, best, takeResult };
}
