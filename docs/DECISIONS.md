# Decisions

One short entry per non-obvious choice, so the reasoning stays attached to
the decision.

---

**Code lives outside the Google Drive folder.** `WORKOUT_APP_V2_SPEC.md`
sits in `D:\My Drive\WORKOUT_APP`, but the actual repo is at
`C:\dev\workout-app`. The first `npm install` in the Drive folder failed
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
