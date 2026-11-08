// The browser camera plus MediaPipe's pose model, shared by the exercise workout
// and the movement test: one result per new video frame goes to onFrame.
import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// Pinned: the WASM runtime matches the installed @mediapipe/tasks-vision
// version, and the model is Google's versioned "full" pose model, the Tasks
// equivalent of Django's mp.solutions.pose model_complexity=1.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

// Django parity: mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5) (views.py:888)
const LANDMARKER_OPTIONS = {
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
};

/**
 * @param {boolean} cameraOn
 * @param {(result: import('@mediapipe/tasks-vision').PoseLandmarkerResult, video: HTMLVideoElement, canvas: HTMLCanvasElement | null) => void} onFrame
 * @returns {{ videoRef, canvasRef, cameraError: string | null, ready: boolean }}
 */
export function usePoseCamera(cameraOn, onFrame) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const onFrameRef = useRef(onFrame);
    const [cameraError, setCameraError] = useState(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        onFrameRef.current = onFrame;
    }, [onFrame]);

    useEffect(() => {
        if (!cameraOn) return undefined;
        let cancelled = false;
        let stream = null;
        let landmarker = null;
        let frameId = null;
        let lastVideoTime = -1;

        const loop = () => {
            const video = videoRef.current;
            if (cancelled || !video || !landmarker) return;
            if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
                lastVideoTime = video.currentTime;
                onFrameRef.current(landmarker.detectForVideo(video, performance.now()), video, canvasRef.current);
            }
            frameId = requestAnimationFrame(loop);
        };

        (async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                if (cancelled) return;
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
                const vision = await FilesetResolver.forVisionTasks(WASM_URL);
                landmarker = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
                    ...LANDMARKER_OPTIONS,
                });
                if (cancelled) {
                    landmarker.close();
                    return;
                }
                setCameraError(null);
                setReady(true);
                frameId = requestAnimationFrame(loop);
            } catch (err) {
                console.error('Camera or pose model failed:', err);
                setCameraError(
                    err?.name === 'NotAllowedError'
                        ? 'Camera access was denied. Allow the camera in your browser to track your movement.'
                        : 'Could not start the camera. Make sure a camera is connected and not used by another app.',
                );
            }
        })();

        // Cleanup on stop or unmount: frame loop, camera, model.
        return () => {
            cancelled = true;
            setReady(false);
            if (frameId !== null) cancelAnimationFrame(frameId);
            stream?.getTracks().forEach((track) => track.stop());
            landmarker?.close();
        };
    }, [cameraOn]);

    return { videoRef, canvasRef, cameraError, ready };
}
