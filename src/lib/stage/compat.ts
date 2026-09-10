/**
 * Browser compatibility shims and the `?sim=tv` harness.
 *
 * Everything here is feature-detected rather than assumed, and written in the
 * ES2015 subset the lint fence enforces — because spec §3 puts this on a
 * smart-TV browser and Next's compile target is global, so our own source must
 * not lean on the compiler downleveling it.
 */

/**
 * Monotonic time where available.
 *
 * `performance.now()` is immune to the system clock jumping mid-session (an NTP
 * correction during a 60-minute workout would otherwise skew or freeze the
 * countdown). Falls back to `Date.now()` on engines that lack it — which is
 * exactly what `?sim=tv` forces, so the fallback path gets exercised on the
 * desktop rather than only on the television.
 */
export function now(): number {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Unlock media playback.
 *
 * Spec §3 nominates the pairing screen's Connect press as the unlock gesture,
 * but a bookmarked, already-paired television never shows that screen — so the
 * real hook is "the first user gesture, wherever it happens".
 *
 * Today this is a no-op with a single call site. Muted inline video generally
 * autoplays without any gesture; the requirement really belongs to the future
 * audio layer, and having one place to put it means the chime drops in later
 * without hunting for the trigger.
 */
export function unlockMedia(): void {
  /* no-op until the audio layer lands */
}

/**
 * The side-switch chime.
 *
 * Audio is backlog per spec §8, and TV audio autoplay is a separate unlock from
 * video autoplay. The switch announces itself visually instead (an accent flash
 * plus the incoming side letter scaling in). This exists so that when audio
 * lands there is exactly one place to wire it.
 */
export function playChime(): void {
  /* no-op — see the visual .side-flash treatment in stage.css */
}

export type StageFlags = {
  /** Letterbox to 1080p and mask off APIs the TV lacks. */
  sim: boolean;
  /** On-screen HUD. Works on the real television too — there are no devtools. */
  debug: boolean;
  /** Jump straight to a screen, for looking at one without driving the whole flow. */
  screen: string | null;
};

export function readFlags(search: string): StageFlags {
  const params = new URLSearchParams(search);
  const sim = params.get('sim');
  return {
    sim: sim === 'tv' || sim === '1',
    debug: params.get('debug') === '1',
    screen: params.get('screen'),
  };
}

/**
 * Make the desktop behave a little more like the television.
 *
 * The APIs are DELETED rather than stubbed. Stubbing would let code that
 * reaches for them keep working here and fail silently on the set; deleting
 * makes it throw in front of you. That is the whole point — a sim mode that
 * passes while the real device fails is worse than no sim mode.
 *
 * Stated limit: this proves the layout, the type scale and the state machine.
 * It proves nothing about the JS engine, the CSS engine, or codec support.
 * Only a load on the actual television does that.
 */
export function applySimMasks(): void {
  if (typeof window === 'undefined') return;

  const target = window as unknown as Record<string, unknown>;
  delete target.ResizeObserver;
  delete target.IntersectionObserver;
  // Force the Date.now() branch of now().
  target.performance = undefined;
}
