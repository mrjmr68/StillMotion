'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Capability report, printed large enough to read from the sofa and photograph.
 *
 * Every probe is individually wrapped, because the whole point is to survive the
 * thing that fails. A TV where WebGL throws on context creation must still show
 * the video-codec answer — that is the case where the answer matters most.
 *
 * ES2015 only: this file is inside the stage fence, and a diagnostic that cannot
 * parse on the machine it is diagnosing is worse than no diagnostic.
 */

type Row = { label: string; value: string; good: boolean | null };

function attempt(label: string, probe: () => string, good?: (value: string) => boolean): Row {
  try {
    const value = probe();
    return { label, value, good: good ? good(value) : null };
  } catch (error) {
    return {
      label,
      value: 'threw: ' + (error instanceof Error ? error.message : String(error)),
      good: false,
    };
  }
}

function webglRows(): Row[] {
  const rows: Row[] = [];
  const canvas = document.createElement('canvas');

  let gl: WebGLRenderingContext | null = null;
  rows.push(
    attempt(
      'WebGL',
      function () {
        const two = canvas.getContext('webgl2');
        if (two) {
          gl = two as unknown as WebGLRenderingContext;
          return 'WebGL 2';
        }
        const one = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (one) {
          gl = one as WebGLRenderingContext;
          return 'WebGL 1 only';
        }
        return 'NOT SUPPORTED';
      },
      function (value) {
        return value !== 'NOT SUPPORTED';
      },
    ),
  );

  if (gl) {
    const context = gl as WebGLRenderingContext;
    rows.push(
      attempt('GPU', function () {
        const info = context.getExtension('WEBGL_debug_renderer_info');
        if (!info) return 'hidden by the browser';
        return String(context.getParameter(info.UNMASKED_RENDERER_WEBGL));
      }),
    );
    rows.push(
      attempt('Max texture', function () {
        return String(context.getParameter(context.MAX_TEXTURE_SIZE)) + 'px';
      }),
    );
    rows.push(
      attempt(
        'Vertex texture units',
        function () {
          return String(context.getParameter(context.MAX_VERTEX_TEXTURE_IMAGE_UNITS));
        },
        function (value) {
          // Skinned-mesh animation usually wants bone data in a vertex texture.
          // Zero here means three.js falls back to uniforms and caps the rig.
          return Number(value) > 0;
        },
      ),
    );
  }

  return rows;
}

function videoRows(): Row[] {
  const video = document.createElement('video');
  const codecs: { label: string; type: string }[] = [
    { label: 'H.264 (mp4)', type: 'video/mp4; codecs="avc1.42E01E"' },
    { label: 'VP9 (webm)', type: 'video/webm; codecs="vp9"' },
    { label: 'VP8 (webm)', type: 'video/webm; codecs="vp8"' },
    { label: 'HEVC (mp4)', type: 'video/mp4; codecs="hvc1"' },
    { label: 'AV1 (mp4)', type: 'video/mp4; codecs="av01.0.05M.08"' },
  ];

  return codecs.map(function (codec) {
    return attempt(
      codec.label,
      function () {
        const answer = video.canPlayType(codec.type);
        return answer === '' ? 'no' : answer;
      },
      function (value) {
        return value === 'probably' || value === 'maybe';
      },
    );
  });
}

/*
 * The probe runs once and its result is cached, so the snapshot is
 * referentially stable and `useSyncExternalStore` does not loop.
 *
 * That hook rather than an effect because this is a client-only value by
 * definition: the server cannot know what a television supports, and computing
 * it during the initial render would be a hydration mismatch — the same bug that
 * made the stage flash on every boot.
 */
let cached: Row[] | null = null;

function collect(): Row[] {
  const collected: Row[] = [];

  collected.push(
    attempt('Screen', function () {
      return (
        String(window.innerWidth) +
        ' x ' +
        String(window.innerHeight) +
        '  dpr ' +
        String(window.devicePixelRatio || 1)
      );
    }),
  );

  const webgl = webglRows();
  for (let i = 0; i < webgl.length; i += 1) collected.push(webgl[i]);

  const video = videoRows();
  for (let i = 0; i < video.length; i += 1) collected.push(video[i]);

  collected.push(
    attempt(
      'requestAnimationFrame',
      function () {
        return typeof window.requestAnimationFrame === 'function' ? 'present' : 'ABSENT';
      },
      function (value) {
        return value === 'present';
      },
    ),
  );

  return collected;
}

function subscribe(): () => void {
  return function () {};
}

function clientRows(): Row[] | null {
  if (cached === null) cached = collect();
  return cached;
}

function serverRows(): Row[] | null {
  return null;
}

export default function Capabilities() {
  const rows = useSyncExternalStore(subscribe, clientRows, serverRows);
  const [fps, setFps] = useState<string>('measuring…');

  useEffect(() => {
    /*
     * Frame budget. Not a benchmark of anything real — just whether this set can
     * hand out frames at a usable rate at all. A television that reports WebGL
     * and then delivers 8fps has answered the question just as clearly as one
     * that reports no WebGL.
     */
    let frames = 0;
    const started = Date.now();
    let stopped = false;

    if (typeof window.requestAnimationFrame !== 'function') {
      // Asynchronous, so it is a state update from outside React rather than a
      // cascading render — and it is the answer, not a failure.
      const timer = setTimeout(function () {
        setFps('no requestAnimationFrame — cannot measure');
      }, 0);
      return () => clearTimeout(timer);
    }

    const tick = function () {
      if (stopped) return;
      frames += 1;
      if (Date.now() - started >= 2000) {
        setFps(String(Math.round((frames * 1000) / (Date.now() - started))) + ' fps idle');
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);

    return () => {
      stopped = true;
    };
  }, []);

  return (
    <div
      style={{
        padding: '4vmin',
        color: '#F2EFE9',
        font: '2.6vmin/1.5 system-ui, sans-serif',
        minHeight: '100vh',
      }}
    >
      <p style={{ color: '#E0894A', letterSpacing: '0.12em', margin: '0 0 2vmin' }}>
        WHAT THIS TELEVISION CAN DO
      </p>

      {rows === null ? (
        <p>probing…</p>
      ) : (
        <table style={{ borderSpacing: '0 0.8vmin', width: '100%' }}>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td style={{ opacity: 0.6, paddingRight: '3vmin', whiteSpace: 'nowrap' }}>
                  {row.label}
                </td>
                <td
                  style={{
                    color:
                      row.good === null ? '#F2EFE9' : row.good ? '#7FC08A' : '#C9482F',
                    wordBreak: 'break-word',
                  }}
                >
                  {row.value}
                </td>
              </tr>
            ))}
            <tr>
              <td style={{ opacity: 0.6, paddingRight: '3vmin' }}>Frame rate</td>
              <td>{fps}</td>
            </tr>
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '4vmin', opacity: 0.5, fontSize: '2vmin' }}>
        Green is usable. Red is not. Photograph this screen.
      </p>
    </div>
  );
}
