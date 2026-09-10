import { formatSeconds } from '@/lib/planner/budget';
import type { BundleResponse } from '@/lib/stage/contract';

/**
 * The session shape (spec §7): "the TV shows the session shape for a beat —
 * '38 minutes · 4 blocks · kettlebell + floor' — then waits for Begin."
 *
 * Everything here is derived from the bundle rather than restated by the server,
 * so it cannot disagree with the plan the TV is about to run.
 */
export default function Shape({ bundle }: { bundle: BundleResponse | null }) {
  if (!bundle) {
    return (
      <div className="stage">
        <div className="stage__main">
          <div className="block-label">Loading the session</div>
        </div>
      </div>
    );
  }

  const plan = bundle.plan;
  const minutes = Math.round(plan.totals.total_seconds / 60);

  const equipment: string[] = [];
  for (const piece of plan.checkin.equipment_on_hand) {
    if (equipment.indexOf(piece) < 0) equipment.push(piece);
  }

  const summary = [
    `${minutes} minutes`,
    `${plan.blocks.length} blocks`,
    equipment.length > 0 ? equipment.join(' + ') : 'bodyweight',
  ].join('  ·  ');

  return (
    <div className="stage">
      <div className="stage__main">
        <div className="block-label">Ready</div>
        <h1 className="movement-name">{summary}</h1>

        <div className="setup-note" style={{ marginTop: '2vmin' }}>
          {plan.blocks
            .map((block) => `${block.label}${block.rounds > 1 ? ` ×${block.rounds}` : ''}`)
            .join('   ·   ')}
        </div>

        <div className="next-strip" style={{ marginTop: '4vmin' }}>
          Press OK to begin  ·  {formatSeconds(plan.totals.work_seconds)} of work
        </div>
      </div>
    </div>
  );
}
