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
