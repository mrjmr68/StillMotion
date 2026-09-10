import type { StageMovement } from '@/lib/stage/contract';

/**
 * The movement figure.
 *
 * Branches on `asset_url`/`asset_kind`, NEVER on `asset_tier` — that is what
 * makes dropping real artwork in later an upload rather than a code change.
 * When Tier 2 lands the same server resolver reports 'video' and the markup is
 * already the right shape.
 *
 * At Tier 0 no files exist, so this renders a placeholder that reserves the
 * EXACT box the real figure will occupy. That matters: if the layout were tuned
 * at ten feet without the box reserved, the composition would shift the day art
 * arrives.
 */
export default function Figure({ movement }: { movement: StageMovement | undefined }) {
  if (movement && movement.asset_url && movement.asset_kind === 'video') {
    return (
      <div className="figure">
        {/* Muted + inline is what lets this autoplay without a gesture. One
            video plays at a time per spec §3. */}
        <video src={movement.asset_url} autoPlay loop muted playsInline />
      </div>
    );
  }

  if (movement && movement.asset_url && movement.asset_kind === 'image') {
    return (
      <div className="figure">
        {/* A plain <img> on purpose. next/image would pull its loader and
            optimisation pipeline into a bundle spec §3 requires to stay lean,
            to serve one fixed-size still on a television where LCP scoring is
            meaningless. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={movement.asset_url} alt="" />
      </div>
    );
  }

  return (
    <div className="figure">
      <div className="figure__placeholder">
        <span>{movement ? movement.body_position : ''}</span>
      </div>
    </div>
  );
}
