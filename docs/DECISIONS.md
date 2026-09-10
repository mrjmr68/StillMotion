# Decisions

One short entry per non-obvious choice, so the reasoning stays attached to
the decision.

---

**Code lives outside the Google Drive folder.** `WORKOUT_APP_V2_SPEC.md`
sits in `D:\My Drive\WORKOUT_APP`; the actual repo is a local clone of
this GitHub repo (`mrjmr68/StillMotion`), currently checked out at
`C:\StillMotion`. The first `npm install` in the Drive folder failed
outright (`EBADF`, corrupted tarballs) — Drive's sync client fights
`node_modules`' tens of thousands of small files. Git (via GitHub) is the
real source of truth for code; Drive stays for the spec/docs the owner
already has there.

**Build 1's planner uses the recency list only, not the full coverage
ledger.** The spec's build-order table (§12) puts "coverage ledger fed back
into the planner" in Build 3, but §7's input list also mentions it — a
contradiction. Went with Build 3, per the build table's own done-condition
("it stops repeating itself"). Confirmed with the owner. Consequence:
Build 1's `sessions`/`exercise_logs` schema doesn't need a ledger view yet;
that's Build 3 work.

**`middleware.ts` → `proxy.ts`.** Next.js 16 (shipped with this scaffold)
renamed the middleware file convention to `proxy.ts`; `middleware.ts` is
deprecated but still works via a compat shim. Used `proxy.ts` directly
since we're starting fresh.

**Auth uses PKCE `code` exchange, not `token_hash` + `verifyOtp`.**
Originally implemented as `token_hash` + `verifyOtp`, on the assumption
that Supabase's default magic-link template (`{{ .ConfirmationURL }}`)
passes `token_hash`/`type` straight through to `/auth/confirm`. In
practice it doesn't: `{{ .ConfirmationURL }}` points at Supabase's own
hosted `/auth/v1/verify` endpoint, which verifies the token on Supabase's
domain and redirects back to `redirect_to` (our `/auth/confirm`) with a
`?code=` param instead. Editing the template to emit `token_hash`
directly requires custom SMTP to be configured first (Supabase locks
template editing on the built-in mailer) — not worth blocking on for
local dev. Switched `/auth/confirm` to `exchangeCodeForSession(code)`,
which works with the default template unmodified. Revisit if/when custom
SMTP is set up for production.

**Env var is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, not `..._ANON_KEY`.**
Supabase renamed the client-side key from "anon key" to "publishable key"
in their newer API key system. Either an anon or a publishable key works
in that slot; named the env var for where the ecosystem is heading.

**Proxy session-refresh uses `getClaims()`, not `getSession()` or
`getUser()`.** `getClaims()` validates the JWT signature against the
project's published keys on every call, which `getSession()` does not (per
Supabase's own guidance — `getSession()` inside server code trusts an
unverified cookie). `getUser()` is safe but makes a network round-trip on
every request; `getClaims()` verifies locally after an initial key fetch.

**Build 1 schema: enum-like fields use `text` + `CHECK`, not native
Postgres `ENUM`.** The catalog (modality, movement_pattern, equipment,
body_position, timing_type, regions, etc.) is being actively hand-curated
right now, so vocab values are more likely to be renamed or removed than
purely added. `ENUM` values are effectively append-only in Postgres —
renaming needs `ALTER TYPE ... RENAME VALUE` (doesn't cover removal);
removal needs a full type rebuild. A `CHECK` constraint is a one-statement
`DROP`/`ADD CONSTRAINT`. Cost: `CHECK`-constrained text doesn't feed
`supabase gen types typescript` a literal union the way enums do — if
typed unions matter later, hand-maintain a small vocab file instead of
relying on codegen.

**Live session state is its own table (`session_live_state`), not columns
on `sessions`.** The TV writes it every ~2s (450–1800 writes across a
single 15–60 min session) while `sessions` itself is written twice
(create, finalize) and is what future coverage-ledger queries will hit
hardest. Keeping the high-churn ephemeral state off the permanent history
row avoids unnecessary dead-tuple/autovacuum pressure on the table that
needs to stay indexed and stable, and lets the live-state table carry its
own narrow RLS surface independent of `sessions`'.

**The TV is never authenticated, so `pairings` and `session_live_state`
have no insert/update/delete RLS policy yet — by design, not an
oversight.** Per spec §3 ("you never type on the TV"), the TV has no
Supabase Auth session, so it can't satisfy `auth.uid() = user_id`-style
policies for its own writes (creating a pairing code, ticking the ~2s
state). RLS is deny-by-default once enabled, so both tables already
satisfy "RLS enforced on every table" with `select`-only policies for the
owning user; the TV's writes are meant to go through service-role Route
Handlers built in the pairing/stage-runtime slices, not through client-
side RLS. The phone's high-frequency 750ms poll of `session_live_state`,
by contrast, reads it directly under its own authenticated RLS — no
server hop needed for that side.

**`user_id` is denormalized onto `exercise_logs` and `cardio_logs`**
(alongside their `session_id` FK) so RLS policies compare a flat column
instead of an `EXISTS` subquery against `sessions` on every row check —
cheaper, and safe since row ownership never changes after insert.

**`user_movement_preferences` (include/exclude specific movements) is a
normalized join table, not a `text[]` column on `user_preferences`** —
gives real FK integrity against `exercise_catalog`, so a removed catalog
entry cascades cleanly instead of leaving a dangling id string.

**Catalog relations are drafted as names, resolved to ids at import.** The LLM
never emits `progression_id`/`regression_id` — it emits `*_hint` fields holding
movement *names*. Two reasons: generating in batches means the model would
reference ids that don't exist yet and blow the FK, and naming a movement is the
claim the model is actually qualified to make ("the harder version is a
single-leg RDL") whereas picking a primary key is not. Import resolves names to
ids against every drafted and already-imported entry, and drops unresolved hints
with a warning rather than failing — a sparse progression chain is fine; an
import that fails because a movement hasn't been drafted yet would be maddening.
Import is therefore two-pass (insert with null relations, then update them),
because Postgres checks FKs per-row and a single multi-row insert where A
references B fails if A is checked first. Both passes are idempotent, so a
failure between them is fixed by re-running.

**The LLM produces movement-science fields; the harness derives the rest.** The
line: the model owns any field where a wrong value is a judgment a human must
adjudicate; the harness owns any field where, given the others, exactly one
value is correct — there a wrong value is a bug, not an opinion. So `id`,
`asset_tier`, `asset_path`, `loop_seconds`, and the reps/`rep_cap_seconds`
coupling are computed. Notably **`is_anchor` is hard-coded `false`**: the spec's
own open-items list says the anchor set is an undecided owner decision, and
letting the model guess would silently manufacture a decision that was
explicitly deferred. Side benefit: the structured-output schema drops to ~16
fields, which improves generation reliability.

**`default_dose` is per side; `rep_cap_seconds` bounds the whole block.** For a
unilateral movement, 8 reps means 8 on *each* side — matching how
`hold_per_side` already reads, and the runtime schedules both sides anyway.
`rep_cap_seconds` is the wall-clock ceiling for the entire set (the soft cap
that auto-advances the stage), not the time for one rep, because that is what
the planner needs to budget session duration. Neither is inferable from the
schema, and inconsistency across 80 entries would be invisible — so both are
stated in the generation prompt and enforced in the harness.

**`src/lib/catalog/vocab.ts` serves both the validator and the prompt.** This is
the hand-maintained vocab file the CHECK-vs-ENUM decision above anticipated. zod
builds every enum from its arrays *and* the system prompt interpolates the same
arrays, so prompt and validator cannot drift apart about what values are legal.
Validation is split by severity: errors mirror the DB CHECKs (so we fail before
paying for generation rather than eating a 23514 at INSERT), warnings are style
signals that annotate an entry for review without blocking it. The LLM-facing
zod schema deliberately contains no `.refine()` — refinements don't survive
compilation to JSON Schema and would be a silent no-op on the model side.

**Scripts run under `tsx`, not Node's native type stripping.**
`--experimental-strip-types` won't resolve the `@/` path aliases, and with no
`"type": "module"` in package.json Node would treat `scripts/**/*.ts` as CJS (no
top-level await). Adding `"type": "module"` at the root to work around that is
too much blast radius for a build script. Scripts are launched with
`--env-file-if-exists=.env.local` rather than `--env-file`, because the latter
hard-fails opaquely when the file is missing and `.env.local` is gitignored —
`scripts/catalog/lib/env.ts` produces a useful message instead.

**Name normalization strips possessives.** `normalizeName` turned "Farmer's
Carry" into `farmer s carry`, which does not match `farmer carry` — so a
relation hint saying "Farmer Carry" silently failed to resolve against the
catalog entry named "Farmer's Carry", and a genuine duplicate spelled with an
apostrophe would have slipped past dedupe. Possessive `'s` is now removed before
the non-alphanumeric collapse, and other apostrophes are dropped rather than
turned into separators. Found on the first real catalog, affecting Farmer's
Carry and Child's Pose.

**Freezing ids at import earned its keep immediately.** `deriveId` runs on
`slugify`, which runs on `normalizeName` — so the possessive fix above silently
changed what id "Farmer's Carry" would derive to (`carry_farmer_s_carry` →
`carry_farmer_carry`). Because ids freeze once `importedAt` is set, the existing
row kept its key instead of being re-inserted under a new one, which would have
orphaned any `exercise_logs` rows pointing at the old id and left a duplicate
catalog entry behind. Worth recording as a validated decision rather than a
theoretical one: a normalization change is exactly the kind of edit that looks
safe and silently re-keys a table.

**LLM exemplars in the prompt become phantom relation targets.** Cat-Cow was one
of two worked examples in the generation system prompt. The model never drafted
it — correctly treating it as an example — but referenced it as a relation hint
seven times across four different patterns, so those links had nowhere to land.
Any movement used as an exemplar therefore has to be in some category's
`mustInclude`, or it will be referenced and never exist.

**Plan rounds are flattened at expand time; a unilateral movement is one item
with two sides.** Both are forced by the schema rather than chosen.
`session_live_state` carries only `current_block_index` / `current_item_index` —
there is no round cursor — and `exercise_logs`' unique key is
`(session_id, block_index, item_index, side)`. Flattening keeps both working
with no migration, and it is what makes the sequencing rules checkable at all,
since "no more than two consecutive items sharing a primary region" and "hardest
work not in the final 15%" need the flat running order across round and block
boundaries. Because `side` is a column *in* that key rather than part of
`item_index`, one item logs two rows — which turns "unilateral work always
schedules both sides, same dose" into something unconstructible-if-violated
rather than a rule to check.

**Avoided regions are a hard error on `primary_regions` only; secondary
involvement is a warning.** Measured against the live catalog: `mat|wall|chair`
plus "avoid hip" leaves 25 rows when avoidance tests primary only, but 12 rows
with just 2 main-work entries if secondary counts too — which makes a 60-minute
session arithmetically impossible. It is also the right reading: "avoid hip
today" means don't make the hip the target, not "never let the hip participate,"
which would rule out standing up.

**Templates are stored as `PlanDraft`, not `SessionPlan`.** A fallback then runs
the identical expand → validate → repair path as a generated plan, so it gets
*fitted* to the check-in — equipment substitutions, dose trims — rather than
served rigidly. Costs nothing extra and turns "a canned workout" into "a canned
skeleton, adapted." `plan:check` validates all four against the live catalog
across 64 duration × equipment × avoid-region scenarios, because a template
referencing a deleted `exercise_id` would silently break the one path that
guarantees "you always get a workout." Run it after every `catalog:import`.

**Focus is a scoring bias, never a filter.** This is what makes the check-in's
"balance & control" option work despite the catalog having zero entries with
`modality: 'balance'` — the label promises a quality of movement (single-leg
work, carries, gait, ground transitions), not a database column. Biasing rather
than filtering yields 31 candidates, and a real generation confirmed it:
Cossack squats, lateral step-outs, split squats, step-ups and shuffles. The
prompt states the absence explicitly, because otherwise the model hunts for a
modality that does not exist and either invents an id or returns a thin block.

**Two spec rules are deliberately allowed to bend, in writing rather than via a
quiet `catch`.** (1) `consecutive_region`: `primary_regions` is concentrated —
shoulder 41 of 91 rows, hip 40 — so with "avoid hip" the main pool is
overwhelmingly shoulder-dominant and any three consecutive items share
`shoulder` by construction. Once swaps and substitutions are exhausted this
downgrades to a warning rather than escalating, because a re-prompt cannot fix a
pool with no alternative. (2) `hard_work_late` is skipped entirely when all main
work shares one intensity: there is then no "hardest work" to misplace, and
firing would be unfixable by construction. Separately, spec §7 wants
conditioning *after* strength AND the hardest work *out of* the final 15%; when
a conditioning block closes the session those collide, resolved by ordering that
block to end on its easiest movement.

**Validator findings are per-item, so a repairer must re-validate between
fixes.** Rounds flatten one movement into several items, so a 4-round block
yields four identical findings for the same offending movement. Acting on a
stale list meant the first fix replaced all four instances and the remaining
three then re-substituted the *replacement* — 25 repairs that produced a session
built from three copies of one movement with doses inflated by each pass. The
substitution pass now re-runs `planErrors` between fixes. Worth recording
because the bug was invisible in the output (a valid-looking plan) and only
showed up as absurd repair counts.

**Generation takes ~2 minutes at effort `high`, not the spec's 20-30 seconds.**
Measured on real 40- and 25-minute sessions with adaptive thinking. §7 treats the
wait as a feature (the TV runs a breath pacer meanwhile), but two minutes is a
long centering screen — worth either dropping to effort `medium` for the
runtime call or designing the pacer for a longer hold. Not a blocker; a number
to design around rather than discover in production.

**The television can never read anything from Supabase, so a bundle endpoint is
mandatory rather than an optimisation.** `exercise_catalog`'s only policy is
`select ... to authenticated`, and the TV has no session by design (spec §3:
"you never type on the TV"). It therefore cannot read the catalog, `sessions`,
or `session_live_state` — every name, cue and setup note it displays has to
arrive through a service-role endpoint. The upside is that this shape is forced
rather than chosen: the TV fetches the plan plus every movement it references
exactly once, holds it in memory, and after that the network is optional. §4's
"if the network drops, the workout keeps running" falls out as a consequence of
RLS rather than as a feature anyone had to build.

**The stage timeline is `itemTotalSeconds` unrolled, term for term.**
`buildTimeline` emits `[transition] [work(L)] [side_switch] [work(R)] [rest]`
per item — exactly the terms `budget.ts` sums — so
`Σ phase.seconds === plan.totals.total_seconds` is an identity, asserted by
`stage:check` across all 64 template scenarios. That assertion is what keeps the
planner's ±10% duration guarantee true at *runtime*; without it the TV could
count down differently from what the validator budgeted and nothing would say
so. Critically the timeline *consumes* `item.work_seconds` rather than
recomputing it, so there is exactly one implementation of "how long is this
movement" in the codebase.

**The stage clock never accumulates.** Remaining time is always derived from
wall time (`duration + added − (now − startedAt − pausedAccum)`), never
decremented per tick. `setInterval` drift across a 60-minute session on weak
hardware is real and TV browsers throttle timers in the background, so
subtracting a tick per frame would turn drift into a session ending minutes
late. The 200ms interval exists only to re-read the clock and re-render, which
makes 200ms of jitter permanently 200ms rather than cumulative. No
`requestAnimationFrame`: throttled or absent on old TV browsers, and it burns
GPU on hardware §3 tells us is weak.

**The reps soft cap is `item.work_seconds`, not raw `rep_cap_seconds`.**
`itemWorkSeconds` scales the cap by `dose / default_dose`; using the raw cap
would make the wall clock diverge from `totals` and quietly falsify the ±10%
guarantee. Note also that a reps phase still advances when the cap expires —
spec §8's "you are never stranded holding a kettlebell waiting for permission
to continue" means Done is an *early* exit, not a required one.

**`pairings.expires_at` gates only the unclaimed code.** Enforced while
`claimed_at is null` and ignored afterwards. Otherwise a bookmarked television
would un-pair itself fifteen minutes later, contradicting §3's "you bookmark one
short URL once." The 4-digit code is a display artefact for a human; the real
credential is a 32-byte token stored only as its SHA-256, so a database leak is
not a paired TV.

**The console and the stage have separate root layouts, via route groups.** The
console moved to `src/app/(console)/` and the stage lives at
`src/app/(stage)/`, each with its own `<html>`/`<body>`. A nested layout cannot
remove the console's two Geist webfonts from `<head>` or Tailwind's preflight
from the document, and §3 explicitly says `/stage` "does not share the console's
component library." Verified rather than assumed: `/stage` links exactly one
stylesheet, its own, with zero Geist or Tailwind references. Route groups don't
appear in URLs, so `/`, `/login`, `/app` and `/auth/*` were unaffected.

**"`/stage` is a separately-targeted bundle" is not achievable in Next 16.**
Browserslist lives in `package.json` and is global; there is no per-route compile
target. What the route group buys is separate CSS, fonts and document — not a
separate JS target, and React 19 plus the App Router runtime ship to the stage
regardless. Since config cannot enforce it, an ESLint override scoped to
`src/app/(stage)/**` and `src/lib/stage/**` bans optional chaining, `??`,
`Array.prototype.at`, `structuredClone` and friends, so at least our own source
never depends on the compiler downleveling it. That keeps two escape hatches
mechanical rather than a rewrite: widen browserslist globally (cheap here — one
console user, on a modern phone), or lift the stage out to hand-written vanilla
JS. Which is needed is a question only a load on the actual television answers.

**The proxy no longer runs on `/stage` or `/api/stage`.** Those requests carry
no Supabase cookie at all, so `getClaims()` had nothing to refresh and was
costing an auth round-trip per poll — roughly one a second for a whole session.
Written as extra negative lookaheads on the existing matcher rather than a
positive matcher, so nothing previously covered silently fell out;
`src/lib/supabase/proxy.ts` and its cookie-sync contract are untouched, and
`/app` still redirects when unauthenticated.

**The pairing code is returned on every sync, not just from `/pair`.** The
television does not remember its own code. A remount, a hot reload, or a set
rebooting mid-pair otherwise strands the screen on a placeholder with nothing to
type — found exactly that way while wiring the flow up. Pairing is now minted
only in response to a 401, which is the one unambiguous "the server has no
pairing for you" signal, and the code itself rides along on the poll the TV is
already making.

**Commands are acknowledged by a payload id, and the guard earns its keep.**
The console stamps a uuid into `pending_command_payload`, the TV applies the
command and acknowledges that id on its next sync, and the server clears with a
compare-and-swap on it. The id lives in the payload rather than the command name
because `add_30s` is the one command a human genuinely presses twice in a row,
and a CAS on the name would silently collapse the second press into the first.
The at-most-once guard fired in real traffic during the first end-to-end run —
a redelivered `add_30s` was correctly ignored rather than adding sixty seconds.

**Query flags go through `useSyncExternalStore`, not a `useState` initialiser.**
Reading `window.location.search` during the initial render makes the server
produce a HUD-less tree and the client produce one with the HUD, which is a
hydration mismatch: React discards the server HTML and the television flashes on
every boot for no reason. The store's server snapshot is the honest way to say
"this value only exists on the client".

**Nothing that drives rendering is held in a ref.** An earlier draft kept the run
state, the timeline and the cue level in refs so async callbacks could read them
without a stale closure, and rendered from those refs — which React's own lint
rule flags, because a ref read during render can silently show a previous value.
Refs are now callback-only; the timeline is derived from the plan with `useMemo`.
On a screen with no devtools, a stale render would be a miserable bug to chase.

**The clock finishing is what ends a session.** Whether the timeline ran out or
`end` was pressed, `run.finished` is the single trigger that reports completion,
writes `plan_performed`, and inserts `exercise_logs`. Guarded by a ref because
the render tick would otherwise fire it every 200ms. `outcome` distinguishes
running off the end (`completed`) from stopping early (`abandoned`).
Verified end to end: a unilateral movement produces two `exercise_logs` rows,
left and right, from one plan item — which is the whole point of side being a
column in that table's unique key rather than part of the item index.

**The console reads Supabase directly and writes through route handlers.** The
phone is authenticated, so `sessions`, `session_live_state`, `pairings` and
`exercise_catalog` are all readable under its own RLS — putting a server hop in
front of the 750ms mirror poll would be latency for nothing. Every write is the
opposite: claiming a pairing the user does not own yet, queueing a command into a
table with no update policy, setting the TV's screen during generation. Those are
exactly the rows RLS refuses, which is what `service_role` is for. The split is
therefore the policies' shape, not a preference — and `/app` loading correctly is
a standing check that the phone can see its own data.

**Which screen the console shows is derived from `sessions.status`, never from
what was last tapped.** There is no local "I pressed Begin" flag, because every
transition the console cares about is made by the TELEVISION: planned to active
when the TV picks up `begin`, active to complete when the clock runs out. A local
flag would be a second opinion about a fact the phone does not own, and the two
would disagree the first time a phone locked mid-session. The cost is a 2s status
poll; the benefit is that a reload, a slept phone, or picking the phone up
mid-workout all land exactly where you actually are.

**The check-in has two shapes, and the boundary between them is enforced rather
than documented.** `CheckinRequest` is the eight things a human can touch;
`Checkin` is that plus the include/exclude lists and the recency window, which the
server resolves. The resolved object is stored verbatim into
`sessions.checkin_input` as the permanent record of why a plan looks the way it
does — so a phone that could post `recent_exercise_ids` could rewrite that record.
The request schema is a `strictObject` and `console:check` asserts that each of
the three server-resolved fields is REJECTED rather than ignored when submitted.

**Generating twice returns the session already there.** A two-minute wait invites
a second press, and `uq_sessions_one_active_per_user` only stops a duplicate
*active* session — two `planned` ones are perfectly legal and would cost a second
API call plus a coin-flip about which one the TV picked up. The generate route
checks for an open session first and hands it back. The same check is what makes
reopening the phone mid-generation safe.

**The inserted session, not the generate response, is the source of truth.** The
request takes about two minutes, which is long enough that a locked phone, a
dropped connection, or a browser giving up are all ordinary rather than
exceptional. So the console keeps polling for the session independently, and a
failed fetch drops back to waiting instead of erroring. That is what spec §7's
"closing the phone during generation orphans nothing" has to mean in practice —
the schema guarantee (`plan_generated` is NOT NULL, so the row only exists once
the plan is complete) is only half of it.

**The prompt, the generator and the planner's database access moved out of
`scripts/` into `src/lib/planner/`.** The console generates from the same prompt
the CLI does, and two copies would be two places for the prompt version, the
effort setting or the refusal handling to drift — which would quietly make
`plan --dry-run` print something the console does not send, destroying the only
diagnostic that tool has. `scripts/planner/lib/` keeps thin re-export shims so the
CLI's import paths still say what they need.

**`user_preferences` is upserted, never updated.** There is no row until something
creates one, and this account had none — an `update` would have silently written
nothing and the sticky half of the check-in would have reset every day with no
error anywhere. Confirmed against the live database rather than assumed.

**The mirrored countdown interpolates but freezes when paused.** The TV writes its
cursor every ~2.25s, so showing the raw value would make the phone jump 30 → 28 →
25 beside a screen counting evenly. Carrying the last read forward with local
elapsed time fixes that, but only while the TV says it is running: a paused clock
that kept sliding would be the one case where the mirror actively lies about the
screen in front of you. Both directions are asserted in `console:check`, along
with a stale read flooring at zero rather than going negative.

**A finished session asks to be rated for six hours, then stops asking.** The
prompt exists because the phone is usually put down at the end of a workout rather
than answered, so it has to survive a reload. But a rating prompt for Tuesday's
session is not a prompt, it is an obstacle between you and today's check-in — and
a rating given days late is worse data than no rating, which is also why Skip is a
real, equally-weighted answer rather than a dismissal.

**The magic link comes back to whichever device asked for it.** A fixed
`NEXT_PUBLIC_SITE_URL` cannot be right for a two-screen app developed on a LAN:
set to `http://localhost:3000`, a link requested on the PHONE points the phone at
itself. The failure is completely silent from the server's side — the request
never arrives, so the log shows a `POST /login` and then nothing at all, which is
exactly how it presented. The origin is now derived from the request's Host
header, trusted only for loopback and RFC1918 addresses (a forged Host is how
host-header injection works, and Supabase's redirect allow-list is a second gate
behind that). Pulled out as a pure function precisely because the failure mode is
invisible: `console:check` asserts eleven host cases, including that `172.32.x` is
public even though `172.16-31.x` is private — the one a lazy `172.` prefix match
gets wrong.

**`allowedDevOrigins` includes the LAN address.** Next's dev server refuses to
serve its own chunks and the HMR socket to an unrecognised origin, so loading the
console from the phone produced a rendered shell with every interaction dead —
which looks like broken application code and isn't. Development only; `next
build` is unaffected.

**Supabase silently substitutes `site_url` when `emailRedirectTo` is not on the
allow-list.** It does not error, and nothing in the response says it happened —
so a correct `emailRedirectTo` produced an email pointing somewhere else
entirely, and the only symptom was the phone's browser failing to resolve a host.
Diagnosing it meant reading the project's auth config through the Management API
rather than reasoning about the code, which was fine. The project now allow-lists
both origins explicitly (`http://localhost:3000/auth/confirm` and
`http://192.168.0.13:3000/auth/confirm`) with `site_url` on the LAN address, so
even the substitution path lands somewhere the phone can reach. Exact paths rather
than wildcards: this list is what decides where Supabase will hand out an auth
code.

**The built-in email service is capped at 2 sends per hour.**
`rate_limit_email_sent` is 2 on this project, which is low enough that debugging a
sign-in problem exhausts it — and the resulting failure ("email rate limit
exceeded") looks like a new bug rather than a quota. Worth checking before
concluding anything about a magic link that did not arrive. Raising it meaningfully
needs custom SMTP, which is the same wall the email-template edit hit.

**A television can be forgotten, because otherwise it cannot be moved.** Pairing
only fires in response to a 401 — that is what stopped the TV stranding itself on
a placeholder code it had forgotten. The flip side, found the first time a second
account signed in: a set holding a valid token will never show a code again, so a
TV paired to the wrong account was unmovable from either screen and needed
`pairings.revoked_at` edited with a service key. `POST /api/console/pair/revoke`
closes that, scoped to the caller's own pairings — account B must not be able to
unpair account A's set, so the cross-account case still ends at whoever owns the
pairing. The TV is not notified; it finds out on its next sync, which 401s and
sends it down the same path a brand new set takes rather than adding a second
mechanism to rot.

**Browserslist is pinned low, and the television is why.** Next's default floor is
around Chrome 109, and the stage bundle it emitted contained 38 optional chainings,
60 nullish coalescings and a logical assignment. An engine below Chrome 80 cannot
PARSE that, so it throws a SyntaxError, no client code runs, and the screen holds
the server-rendered shell forever — which presented as a pairing screen stuck on
`····` with not one `/api/stage/*` request in the server log. This is the flag from
the stage plan coming due, and the escape hatch it named being taken. Details and
the per-entry reasoning are in `BROWSERSLIST.md`. The cost lands entirely on the
console, which runs on a current phone and does not care.

**`/stage?ua=1` prints the user-agent from the server.** Every other diagnostic on
this screen, the `?debug=1` HUD included, needs JavaScript to be running — so all
of them are useless in exactly the failure that matters most, a bundle the engine
cannot parse. Rendering the UA server-side is the one thing that still answers
"what is this television" when nothing else does, and spec §3 says there are no
devtools to fall back on.

**Dev mode is the wrong thing to put on the television.** The dev bundle carries the
HMR client and React refresh and is served as on-demand Turbopack chunks whose names
change every time the server restarts, so a TV holding a stale page requests files
that no longer exist. For anything being judged on the real set, serve a production
build.
