/**
 * Stage tunables, palette, and type scale.
 *
 * Same role the other two vocab files play: one place to change a number.
 *
 * NOTE ON SYNTAX: everything under src/lib/stage and src/app/(stage) is linted
 * into an ES2015 subset — no optional chaining, no nullish coalescing, no
 * Array.prototype.at. Spec §3 requires the stage to run on a smart-TV browser
 * ("roughly a phone browser from several years ago"), and Next's compile target
 * is global rather than per-route, so our own source must not depend on the
 * compiler downleveling it.
 */

/* ------------------------------------------------------------------ *
 * Timing
 * ------------------------------------------------------------------ */

/** How often the TV polls the sync endpoint. Spec §3: "poll, don't socket." */
export const SYNC_MS = 750;

/**
 * Write the cursor on every Nth sync — 3 x 750ms ≈ 2.25s, matching spec §4's
 * "writes its state to the session row every ~2s". Reads stay at 750ms so a
 * command from the phone is picked up promptly.
 */
export const STATE_WRITE_EVERY = 3;

/**
 * Re-render cadence. This only re-reads the clock; the remaining time is always
 * derived from wall time, so jitter here is never cumulative.
 *
 * Deliberately NOT requestAnimationFrame: it is throttled or absent on old TV
 * browsers, and it burns GPU on hardware spec §3 tells us is weak.
 */
export const RENDER_MS = 200;

/** Spec §8: "final 5 seconds shift color". */
export const FINAL_SECONDS = 5;

/** Spec §8: at cue level "full", cues rotate every ~6 seconds. */
export const CUE_ROTATE_SECONDS = 6;

/** How long the side-switch flash holds. Visual stand-in for the backlogged chime. */
export const SIDE_FLASH_MS = 400;

/** Consecutive sync failures before the offline dot appears. */
export const OFFLINE_AFTER_FAILURES = 4;

/** Breath pacer (spec §7): 4-count in, 6-count out. */
export const BREATH_IN_SECONDS = 4;
export const BREATH_OUT_SECONDS = 6;

/**
 * How long the centering screen should expect to wait. Generation measures
 * ~2 minutes at effort `high`, not the spec's stated 20-30s, so the pacer needs
 * roughly twelve breath cycles and a "still working" affordance — a two-minute
 * wordless screen otherwise reads as hung.
 */
export const CENTERING_REASSURE_AFTER_SECONDS = 90;

/* ------------------------------------------------------------------ *
 * Palette — dark ground, ink, one warm accent (spec §8: dojo restraint)
 * ------------------------------------------------------------------ */

export const PALETTE = {
  ground: '#0B0B0C',
  ink: '#F2EFE9',
  accent: '#E0894A',
  /** The final-5-seconds shift. */
  urgent: '#C9482F',
  muted: 'rgba(242, 239, 233, 0.4)',
  faint: 'rgba(242, 239, 233, 0.15)',
};

/* ------------------------------------------------------------------ *
 * Type scale
 *
 * In vmin so a 720p set scales the same as a 1080p one. The cue floor of
 * 2.6vmin (~28px at 1080p) is the practical minimum for ten-foot reading.
 * ------------------------------------------------------------------ */

export const TYPE_SCALE = {
  name: '7vmin',
  numerals: '10vmin',
  cue: '2.6vmin',
  next: '2vmin',
  side: '9vmin',
  blockLabel: '2.4vmin',
};

/**
 * Many televisions still overscan. Without a safe-area inset the progress bar
 * at the very top of spec §8's layout is simply not on the screen.
 */
export const OVERSCAN_PADDING = '4vmin';
