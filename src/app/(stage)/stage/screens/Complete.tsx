import { formatSeconds } from '@/lib/planner/budget';
import type { BundleResponse } from '@/lib/stage/contract';

/** The close. Dojo restraint: what you did, and nothing to press. */
export default function Complete({ bundle }: { bundle: BundleResponse | null }) {
  return (
    <div className="stage">
      <div className="stage__main">
        <div className="block-label">Done</div>
        <h1 className="movement-name">
          {bundle ? formatSeconds(bundle.plan.totals.total_seconds) : ''}
        </h1>
        <div className="next-strip">Rate it on your phone</div>
      </div>
    </div>
  );
}
