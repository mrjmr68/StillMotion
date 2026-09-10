/**
 * The stage — the television surface.
 *
 * A static server shell whose only job is to mount the client root. Keeping the
 * page itself server-rendered and inert means the document the TV receives is
 * tiny and the whole runtime lives in exactly one component, which is what makes
 * spec §3's "simple enough to debug by eye" achievable.
 *
 * Query flags:
 *   ?sim=tv     letterbox and mask off APIs the TV lacks
 *   ?debug=1    the on-screen HUD — works on the real television too
 *   ?screen=…   jump to one screen without driving the whole flow
 *   ?ua=1       print what this browser IS (see below)
 */

import { headers } from 'next/headers';
import StageRoot from './StageRoot';

/**
 * `?ua=1` — the only diagnostic that survives a bundle the engine cannot parse.
 *
 * Every other debugging tool on this screen, the `?debug=1` HUD included, needs
 * JavaScript to be running. When a television shows the server-rendered shell and
 * then nothing — which is exactly what a `SyntaxError` on an unsupported operator
 * looks like — all of them are useless, and spec §3 says there are no devtools to
 * fall back on.
 *
 * This is rendered on the SERVER from the request's own headers, so it prints even
 * when not one line of client code has executed. Two facts are enough to pick a
 * compile target: which engine, and which version.
 */
export default async function StagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params.ua !== '1') return <StageRoot />;

  const requestHeaders = await headers();
  const agent = requestHeaders.get('user-agent');

  return (
    <div style={{ padding: '4vmin', color: '#F2EFE9', font: '2.4vmin/1.5 system-ui, sans-serif' }}>
      <p style={{ color: '#E0894A', letterSpacing: '0.1em' }}>THIS BROWSER IS</p>
      <p style={{ wordBreak: 'break-word' }}>
        {agent ? agent : 'no user-agent header'}
      </p>
      <p style={{ marginTop: '3vmin', color: '#E0894A', letterSpacing: '0.1em' }}>
        SERVER RENDERING REACHED THIS PAGE
      </p>
      <p>
        So the network, the route and the CSS are all fine. If the normal stage
        shows nothing, the problem is the client bundle.
      </p>
    </div>
  );
}
