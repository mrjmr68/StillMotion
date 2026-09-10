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
 */

import StageRoot from './StageRoot';

export default function StagePage() {
  return <StageRoot />;
}
