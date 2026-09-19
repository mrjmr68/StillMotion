'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Can this television render an animated, rigged human at a usable frame rate?
 *
 * The capability probe said WebGL 2, 16 vertex texture units and 56fps idle,
 * which means a skinned mesh is *possible*. It does not mean it is smooth — idle
 * frame rate measures nothing but the compositor, and the whole question is what
 * happens under load.
 *
 * So this renders the real thing: a rigged glTF with its skeletal animation
 * playing, at the set's own resolution, and reports the sustained rate. If it
 * holds 30, the movement figures can be live 3D — which buys mirroring for left
 * and right from one asset, holding a position on pause, and slow motion. If it
 * does not, the same 3D source gets rendered to video loops offline and the
 * television just plays them.
 *
 * three.js is imported dynamically so none of it lands in the stage's own
 * bundle. Whatever this concludes, /stage must stay lean.
 */

type Report = {
  fps: number;
  worst: number;
  triangles: number;
  calls: number;
  note: string;
};

const WARMUP_MS = 1500;
const MEASURE_MS = 8000;

export default function RenderTest() {
  const holder = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState('loading three.js…');
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    async function run() {
      try {
        const THREE = await import('three');
        const loaderModule = await import('three/examples/jsm/loaders/GLTFLoader.js');
        if (disposed) return;
        setStatus('loading the character…');

        const width = window.innerWidth;
        const height = window.innerHeight;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(1);
        renderer.setSize(width, height);
        renderer.setClearColor(0x0b0b0c, 1);
        const node = holder.current;
        if (!node) return;
        node.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
        camera.position.set(0, 1.0, 3.4);
        camera.lookAt(0, 0.9, 0);

        // Lighting close to what the stage would actually use: one key, one fill,
        // no shadows. Shadow maps are the first thing to cut on a TV GPU and the
        // figure reads fine without them.
        scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 2.2));
        const key = new THREE.DirectionalLight(0xffffff, 2.0);
        key.position.set(2, 4, 3);
        scene.add(key);

        const gltf = await new loaderModule.GLTFLoader().loadAsync('/probe/CesiumMan.glb');
        if (disposed) {
          renderer.dispose();
          return;
        }

        scene.add(gltf.scene);

        let triangles = 0;
        gltf.scene.traverse(function (object) {
          const mesh = object as unknown as { isMesh?: boolean; geometry?: { index?: { count: number } | null; attributes?: { position?: { count: number } } } };
          if (!mesh.isMesh || !mesh.geometry) return;
          const index = mesh.geometry.index;
          const position = mesh.geometry.attributes ? mesh.geometry.attributes.position : null;
          if (index) triangles += index.count / 3;
          else if (position) triangles += position.count / 3;
        });

        const mixer = new THREE.AnimationMixer(gltf.scene);
        if (gltf.animations.length > 0) mixer.clipAction(gltf.animations[0]).play();
        setStatus(
          gltf.animations.length > 0
            ? 'measuring — the figure should be walking'
            : 'measuring — model had no animation clip',
        );

        const clock = new THREE.Clock();
        const startedAt = Date.now();
        let frames = 0;
        let measuringFrom = 0;
        let worstFrame = 0;
        let last = Date.now();
        let raf = 0;

        const frame = function () {
          if (disposed) return;
          const now = Date.now();
          mixer.update(clock.getDelta());
          renderer.render(scene, camera);

          const elapsed = now - startedAt;
          if (elapsed > WARMUP_MS) {
            if (measuringFrom === 0) {
              measuringFrom = now;
              last = now;
            } else {
              const delta = now - last;
              if (delta > worstFrame) worstFrame = delta;
              last = now;
              frames += 1;
            }
          }

          if (measuringFrom !== 0 && now - measuringFrom >= MEASURE_MS) {
            const seconds = (now - measuringFrom) / 1000;
            setReport({
              fps: Math.round(frames / seconds),
              worst: worstFrame,
              triangles: Math.round(triangles),
              calls: renderer.info.render.calls,
              note:
                frames / seconds >= 30
                  ? 'Live 3D on the television is viable.'
                  : frames / seconds >= 20
                    ? 'Marginal. Playable, but pre-rendered video would be safer.'
                    : 'Too slow. Render the 3D offline and play video loops.',
            });
            setStatus('done');
            return;
          }

          raf = window.requestAnimationFrame(frame);
        };
        raf = window.requestAnimationFrame(frame);

        cleanup = function () {
          window.cancelAnimationFrame(raf);
          renderer.dispose();
          if (renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
          }
        };
      } catch (error) {
        if (!disposed) {
          setStatus('failed: ' + (error instanceof Error ? error.message : String(error)));
        }
      }
    }

    void run();

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0B0B0C' }}>
      <div ref={holder} style={{ position: 'absolute', inset: 0 }} />

      <div
        style={{
          position: 'relative',
          padding: '4vmin',
          color: '#F2EFE9',
          font: '2.6vmin/1.5 system-ui, sans-serif',
        }}
      >
        <p style={{ color: '#E0894A', letterSpacing: '0.12em', margin: 0 }}>
          RIGGED CHARACTER UNDER LOAD
        </p>
        <p style={{ opacity: 0.7 }}>{status}</p>

        {report !== null && (
          <div style={{ marginTop: '2vmin' }}>
            <p style={{ fontSize: '9vmin', margin: 0, fontWeight: 600 }}>{report.fps} fps</p>
            <p style={{ margin: '1vmin 0', opacity: 0.7 }}>
              worst frame {report.worst}ms · {report.triangles.toLocaleString()} triangles ·{' '}
              {report.calls} draw calls
            </p>
            <p style={{ color: report.fps >= 30 ? '#7FC08A' : '#C9482F', fontWeight: 600 }}>
              {report.note}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
