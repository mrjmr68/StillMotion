import type { CueLevel } from '@/lib/stage/contract';

/**
 * Coaching cues, modelled on subtitles (spec §8).
 *
 *   off  — name and timer only
 *   key  — one cue, the single most important thing, held for the whole item
 *   full — all cues, rotating
 *
 * The container keeps its height at every level so toggling the layer never
 * reflows the focal area above it — a layout that jumps when you change a
 * setting is the sort of thing you only notice from the couch.
 */
export default function CueLayer({
  cues,
  level,
  index,
}: {
  cues: string[];
  level: CueLevel;
  index: number;
}) {
  if (level === 'off' || cues.length === 0) return <div className="cues" />;

  const cue = level === 'key' ? cues[0] : cues[index % cues.length];

  return (
    <div className="cues">
      {/* Keyed so React remounts on change and the fade actually runs. */}
      <div className="cue cue--enter" key={cue}>
        {cue}
      </div>
    </div>
  );
}
