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
