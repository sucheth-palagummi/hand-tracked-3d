import { useEffect, useRef, useCallback } from 'react';
import { Hands } from '@mediapipe/hands';

export default function HandTracker({
    onGestureUpdate,
    onTrackingStatus,
    onGrabStatus,
    onZoomLockStatus,
    onScaleUpdate,
    pipCanvasRef,
}) {
    const videoRef = useRef(null);
    const isInitializedRef = useRef(false);
    const isProcessingRef = useRef(false);
    const animFrameRef = useRef(null);
    const handsRef = useRef(null);
    const leftHandFrameCountRef = useRef(0);
    const zoomLockedRef = useRef(false);
    const lastZoomToggleRef = useRef(0);

    // Store callbacks in refs to avoid stale closures
    const onGestureUpdateRef = useRef(onGestureUpdate);
    const onTrackingStatusRef = useRef(onTrackingStatus);
    const onGrabStatusRef = useRef(onGrabStatus);
    const onZoomLockStatusRef = useRef(onZoomLockStatus);
    const onScaleUpdateRef = useRef(onScaleUpdate);

    useEffect(() => { onGestureUpdateRef.current = onGestureUpdate; }, [onGestureUpdate]);
    useEffect(() => { onTrackingStatusRef.current = onTrackingStatus; }, [onTrackingStatus]);
    useEffect(() => { onGrabStatusRef.current = onGrabStatus; }, [onGrabStatus]);
    useEffect(() => { onZoomLockStatusRef.current = onZoomLockStatus; }, [onZoomLockStatus]);
    useEffect(() => { onScaleUpdateRef.current = onScaleUpdate; }, [onScaleUpdate]);

    const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

    const isFist = useCallback((landmarks) => {
        const wrist = landmarks[0];
        const fingerTips = [8, 12, 16, 20];
        const fingerKnuckles = [6, 10, 14, 18];
        let curledCount = 0;
        for (let i = 0; i < fingerTips.length; i++) {
            const tipDist = dist(landmarks[fingerTips[i]], wrist);
            const knuckleDist = dist(landmarks[fingerKnuckles[i]], wrist);
            if (tipDist < knuckleDist * 0.9) curledCount++;
        }
        return curledCount >= 3;
    }, []);

    const drawLandmarks = useCallback((canvas, results) => {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // Draw camera frame (dimmed)
        if (results.image) {
            ctx.save();
            ctx.globalAlpha = 0.4;
            ctx.drawImage(results.image, 0, 0, w, h);
            ctx.restore();
        }

        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;

        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],
            [0, 5], [5, 6], [6, 7], [7, 8],
            [5, 9], [9, 10], [10, 11], [11, 12],
            [9, 13], [13, 14], [14, 15], [15, 16],
            [13, 17], [17, 18], [18, 19], [19, 20],
            [0, 17]
        ];

        for (let handIdx = 0; handIdx < results.multiHandLandmarks.length; handIdx++) {
            const landmarks = results.multiHandLandmarks[handIdx];
            const handedness = results.multiHandedness[handIdx];
            // MediaPipe mirrors: "Left" label = user's right hand
            const isRightHand = handedness.label === 'Left';
            const fist = isRightHand ? isFist(landmarks) : false;
            const baseColor = isRightHand
                ? (fist ? '#22c55e' : '#a855f7')
                : '#3b82f6';

            // Draw connections
            ctx.strokeStyle = baseColor;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.6;
            for (const [i, j] of connections) {
                ctx.beginPath();
                ctx.moveTo(landmarks[i].x * w, landmarks[i].y * h);
                ctx.lineTo(landmarks[j].x * w, landmarks[j].y * h);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            // Draw landmark dots
            for (let i = 0; i < landmarks.length; i++) {
                const x = landmarks[i].x * w;
                const y = landmarks[i].y * h;
                const radius = 2;

                let color = baseColor;
                // Right hand special coloring
                if (isRightHand) {
                    if (i === 9) {
                        // Control point - green glow
                        color = '#22c55e';
                        ctx.shadowColor = '#22c55e';
                        ctx.shadowBlur = 8;
                    } else if (i === 4 || i === 8) {
                        color = '#f97316';
                    }
                }

                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }

            // Draw pinch line for right hand
            if (isRightHand && !fist) {
                const thumb = landmarks[4];
                const index = landmarks[8];
                const pinchDist = dist(thumb, index);
                const isPinching = pinchDist < 0.08;

                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = isPinching ? '#22c55e' : '#f97316';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(thumb.x * w, thumb.y * h);
                ctx.lineTo(index.x * w, index.y * h);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }, [isFist]);

    useEffect(() => {
        if (isInitializedRef.current) return;
        isInitializedRef.current = true;

        let cancelled = false;

        const initMediaPipe = async () => {
            try {
                const video = document.createElement('video');
                video.setAttribute('playsinline', '');
                video.setAttribute('autoplay', '');
                video.style.display = 'none';
                document.body.appendChild(video);
                videoRef.current = video;

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480, facingMode: 'user' }
                });
                video.srcObject = stream;
                await video.play();

                const hands = new Hands({
                    locateFile: (file) =>
                        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
                });

                hands.setOptions({
                    maxNumHands: 2,
                    modelComplexity: 1,
                    minDetectionConfidence: 0.7,
                    minTrackingConfidence: 0.5,
                    selfieMode: false,
                });

                hands.onResults((results) => {
                    if (cancelled) return;

                    // Draw on PIP canvas
                    if (pipCanvasRef?.current) {
                        drawLandmarks(pipCanvasRef.current, results);
                    }

                    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
                        onTrackingStatusRef.current?.(false);
                        onGrabStatusRef.current?.(false);
                        leftHandFrameCountRef.current = 0;
                        return;
                    }

                    onTrackingStatusRef.current?.(true);

                    let rightHandLandmarks = null;
                    let hasLeftHand = false;

                    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                        const handedness = results.multiHandedness[i];
                        // MediaPipe mirrors: "Left" label = user's right hand
                        if (handedness.label === 'Left') {
                            rightHandLandmarks = results.multiHandLandmarks[i];
                        } else if (handedness.label === 'Right') {
                            hasLeftHand = true;
                        }
                    }

                    // Left hand zoom lock toggle with debounce
                    if (hasLeftHand) {
                        leftHandFrameCountRef.current++;
                        if (leftHandFrameCountRef.current === 10) {
                            const now = Date.now();
                            if (now - lastZoomToggleRef.current > 500) {
                                zoomLockedRef.current = !zoomLockedRef.current;
                                lastZoomToggleRef.current = now;
                                onZoomLockStatusRef.current?.(zoomLockedRef.current);
                            }
                        }
                    } else {
                        leftHandFrameCountRef.current = 0;
                    }

                    // Right hand gesture processing
                    if (rightHandLandmarks) {
                        const landmarks = rightHandLandmarks;
                        const fist = isFist(landmarks);
                        const controlPoint = landmarks[9]; // Middle finger MCP
                        const thumb = landmarks[4];
                        const index = landmarks[8];
                        const pinchDist = dist(thumb, index);

                        if (fist) {
                            // Fist → Grab & Move
                            onGrabStatusRef.current?.(true);
                            onGestureUpdateRef.current?.({
                                type: 'grab',
                                x: controlPoint.x,
                                y: controlPoint.y,
                            });
                        } else {
                            onGrabStatusRef.current?.(false);

                            // Check pinch for zoom (only if not zoom-locked)
                            if (!zoomLockedRef.current) {
                                const scale = 0.4 + ((Math.min(Math.max(pinchDist, 0.03), 0.25) - 0.03) / (0.25 - 0.03)) * (1.8 - 0.4);
                                onScaleUpdateRef.current?.(scale);
                                onGestureUpdateRef.current?.({
                                    type: 'pinch',
                                    scale,
                                    x: controlPoint.x,
                                    y: controlPoint.y,
                                });
                            } else {
                                // Just rotation
                                onGestureUpdateRef.current?.({
                                    type: 'rotate',
                                    x: controlPoint.x,
                                    y: controlPoint.y,
                                });
                            }
                        }
                    } else {
                        onGrabStatusRef.current?.(false);
                    }
                });

                handsRef.current = hands;

                // RAF loop for sending frames
                const sendFrame = async () => {
                    if (cancelled) return;
                    if (!isProcessingRef.current && video.readyState >= 2) {
                        isProcessingRef.current = true;
                        try {
                            await hands.send({ image: video });
                        } catch (e) {
                            // Ignore errors from send
                        }
                        isProcessingRef.current = false;
                    }
                    animFrameRef.current = requestAnimationFrame(sendFrame);
                };
                animFrameRef.current = requestAnimationFrame(sendFrame);

            } catch (err) {
                console.error('MediaPipe initialization failed:', err);
            }
        };

        initMediaPipe();

        return () => {
            cancelled = true;
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            if (videoRef.current) {
                const tracks = videoRef.current.srcObject?.getTracks();
                tracks?.forEach(t => t.stop());
                videoRef.current.remove();
            }
            if (handsRef.current) handsRef.current.close();
        };
    }, [drawLandmarks, isFist, pipCanvasRef]);

    return null;
}
