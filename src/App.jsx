import { useState, useRef, useEffect, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import HandTracker from './components/HandTracker';

/* ─── Global Refs (written by HandTracker, read by useFrame) ─── */
const targetRotation = { current: { x: 0, y: 0 } };
const targetScale = { current: 1 };
const targetPosition = { current: { x: 0, y: 0 } };
const isGrabbing = { current: false };

/* ─── 3D Cube Component ─── */
function GlossyCube() {
  const meshRef = useRef();

  useFrame(() => {
    if (!meshRef.current) return;
    const m = meshRef.current;
    const f = 0.1;
    m.rotation.x = THREE.MathUtils.lerp(m.rotation.x, targetRotation.current.x, f);
    m.rotation.y = THREE.MathUtils.lerp(m.rotation.y, targetRotation.current.y, f);
    const s = targetScale.current;
    m.scale.x = THREE.MathUtils.lerp(m.scale.x, s, f);
    m.scale.y = THREE.MathUtils.lerp(m.scale.y, s, f);
    m.scale.z = THREE.MathUtils.lerp(m.scale.z, s, f);
    m.position.x = THREE.MathUtils.lerp(m.position.x, targetPosition.current.x, f);
    m.position.y = THREE.MathUtils.lerp(m.position.y, targetPosition.current.y, f);
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[2, 1.2, 3]} />
      <meshPhysicalMaterial
        color="#8b5cf6"
        metalness={0.4}
        roughness={0.1}
        clearcoat={1}
        clearcoatRoughness={0.05}
        transparent
        opacity={0.95}
      />
    </mesh>
  );
}

/* ─── Main App ─── */
export default function App() {
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const [zoomLocked, setZoomLocked] = useState(false);
  const [scaleDisplay, setScaleDisplay] = useState(1);

  const webcamCanvasRef = useRef(null);
  const pipCanvasRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const webcamAnimRef = useRef(null);

  // Start webcam background
  useEffect(() => {
    let cancelled = false;

    const startWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
        });
        const video = document.createElement('video');
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        video.srcObject = stream;
        await video.play();
        webcamVideoRef.current = video;

        const canvas = webcamCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const drawFrame = () => {
          if (cancelled) return;
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
          // Mirror horizontally for selfie view
          ctx.save();
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.restore();
          webcamAnimRef.current = requestAnimationFrame(drawFrame);
        };
        drawFrame();
      } catch (err) {
        console.error('Webcam access failed:', err);
      }
    };

    startWebcam();

    return () => {
      cancelled = true;
      if (webcamAnimRef.current) cancelAnimationFrame(webcamAnimRef.current);
      if (webcamVideoRef.current) {
        const tracks = webcamVideoRef.current.srcObject?.getTracks();
        tracks?.forEach((t) => t.stop());
      }
    };
  }, []);

  // Canvas created callback → hide loading
  const handleCanvasCreated = useCallback(() => {
    setLoading(false);
  }, []);

  // Gesture update handler
  const handleGestureUpdate = useCallback((gesture) => {
    if (gesture.type === 'grab') {
      isGrabbing.current = true;
      targetPosition.current = {
        x: -(gesture.x - 0.5) * 8,
        y: -(gesture.y - 0.5) * 6,
      };
    } else {
      isGrabbing.current = false;
      // Rotation (always active for non-grab)
      targetRotation.current = {
        x: (gesture.y - 0.5) * Math.PI,
        y: (gesture.x - 0.5) * Math.PI * 2,
      };
      // Scale (only via pinch)
      if (gesture.type === 'pinch' && gesture.scale !== undefined) {
        targetScale.current = gesture.scale;
      }
    }
  }, []);

  const handleTrackingStatus = useCallback((status) => setTracking(status), []);
  const handleGrabStatus = useCallback((status) => setGrabbing(status), []);
  const handleZoomLockStatus = useCallback((status) => setZoomLocked(status), []);
  const handleScaleUpdate = useCallback((scale) => setScaleDisplay(scale), []);

  // Determine tracking indicator state
  let trackingDotClass = 'tracking-dot inactive';
  let trackingLabel = 'No hand detected';
  if (zoomLocked) {
    trackingDotClass = 'tracking-dot locked';
    trackingLabel = 'Zoom Locked';
  } else if (grabbing) {
    trackingDotClass = 'tracking-dot grabbing';
    trackingLabel = 'Grabbing';
  } else if (tracking) {
    trackingDotClass = 'tracking-dot active';
    trackingLabel = 'Tracking';
  }

  return (
    <>
      {/* Webcam Background */}
      <div className="webcam-bg">
        <canvas ref={webcamCanvasRef} />
      </div>

      {/* Three.js Canvas */}
      <Canvas
        className="three-canvas"
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0, 6], fov: 50 }}
        onCreated={handleCanvasCreated}
      >
        <ambientLight intensity={0.4} />
        <spotLight position={[5, 5, 5]} intensity={1} color="#ffffff" angle={0.4} penumbra={0.5} />
        <spotLight position={[-5, 3, 2]} intensity={0.8} color="#a855f7" angle={0.5} penumbra={0.8} />
        <pointLight position={[0, -3, 4]} intensity={0.5} color="#3b82f6" />
        <Environment preset="city" />
        <GlossyCube />
      </Canvas>

      {/* Hand Tracker (renders nothing) */}
      <HandTracker
        onGestureUpdate={handleGestureUpdate}
        onTrackingStatus={handleTrackingStatus}
        onGrabStatus={handleGrabStatus}
        onZoomLockStatus={handleZoomLockStatus}
        onScaleUpdate={handleScaleUpdate}
        pipCanvasRef={pipCanvasRef}
      />

      {/* UI Overlay */}
      <div className="ui-overlay">
        {/* Title */}
        <div className="title-container glass">
          <div className="title-text">Hand-Tracked 3D</div>
          <div className="title-subtitle">
            {grabbing
              ? '✊ Grab Mode'
              : zoomLocked
                ? '🔒 Zoom Locked'
                : tracking
                  ? '✋ Tracking Active'
                  : 'Waiting for hand…'}
          </div>
        </div>

        {/* Scale Display */}
        {tracking && !grabbing && (
          <div className="scale-display glass">
            Scale: {scaleDisplay.toFixed(2)}x
            {zoomLocked && ' 🔒'}
          </div>
        )}

        {/* Instructions Panel */}
        <div className="instructions-panel glass">
          <h3>Right hand controls:</h3>
          <div className="gesture-item">
            <span className="emoji">✋</span>
            <span><span className="label">Open hand</span> — Rotate</span>
          </div>
          <div className="gesture-item">
            <span className="emoji">🤏</span>
            <span><span className="label">Pinch</span> — Zoom</span>
            {zoomLocked && <span className="badge badge-zoom-locked">🔒 Locked</span>}
          </div>
          <div className="gesture-item">
            <span className="emoji">✊</span>
            <span><span className="label">Fist</span> — Grab & Move</span>
            {grabbing && <span className="badge badge-grab">Active</span>}
          </div>
          <h3>Left hand:</h3>
          <div className="gesture-item">
            <span className="emoji">🖐️</span>
            <span><span className="label">Show left hand</span> — Toggle zoom lock</span>
          </div>
          {zoomLocked && (
            <div style={{ marginTop: 6 }}>
              <span className="badge badge-zoom-locked">🔒 ZOOM LOCKED</span>
            </div>
          )}
        </div>

        {/* Tracking Indicator */}
        <div className="tracking-indicator glass">
          <div className={trackingDotClass} />
          <span className="tracking-text">{trackingLabel}</span>
        </div>

        {/* PIP Overlay */}
        <div className="pip-overlay">
          <span className="pip-label">Hand Tracking</span>
          {zoomLocked && <span className="pip-zoom-lock">🔒 ZOOM LOCKED</span>}
          <canvas ref={pipCanvasRef} width={240} height={180} />
        </div>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div className="loading-text">Initializing…</div>
        </div>
      )}
    </>
  );
}
