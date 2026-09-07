# Catalog harness

Drafts exercise-catalog entries with an LLM, validates and dedupes them, and
writes them to a review file for curation. Per spec §5, **nothing enters the
catalog without a human reviewing it** — generation and import are separate
commands, and import only ever reads entries explicitly marked approved.

## Flow

```
generate  →  review file (all entries "pending")  →  review  →  import
```

Generation never writes to Postgres. It has no service-role write path at all.

## Commands

```bash
# See the assembled prompt without spending anything
npm run catalog:generate -- --category hinge --dry-run

# Draft one category (~8 entries, a few cents)
npm run catalog:generate -- --category hinge

# Everything, at lower effort
npm run catalog:generate -- --all --effort medium
```

Flags: `--category <id>` (repeatable) or `--all`, `--count <n>` to override the
category's target, `--effort low|medium|high|xhigh|max` (default `high`),
`--dry-run`.

Categories are defined in [`categories.ts`](./categories.ts) — that file is data,
edit the counts and briefs freely.

## Environment

Needs `.env.local` (gitignored — copy `.env.example`):

- `ANTHROPIC_API_KEY` — to generate at all.
- `SUPABASE_SERVICE_ROLE_KEY` — needed **even to read** the catalog: the select
  policy on `exercise_catalog` is `to authenticated`, and a script has no user
  session, so a publishable-key read returns zero rows rather than an error,
  silently defeating dedupe.
- `ANTHROPIC_MODEL` — defaults to `claude-opus-5`.

## Review files

`review/<category>.review.json` is **committed to git on purpose**: it is the
record of what was approved, it makes re-import reproducible, and it is where
reviewer edits live. Catalog content deliberately does not live in a migration —
migrations are append-only and curated content churns.

Each entry carries `draft` (the editable fields), `derived` (recomputed from
`draft` on every run, so renaming can't leave a stale id behind), plus `errors`,
`warnings`, `slotPeers`, and `status`.

Re-running generate **never overwrites an entry you have already touched** —
anything not `pending` is left alone and new drafts are appended alongside.

## What the model decides vs. what the harness does

The model owns fields where a wrong value is a movement-science judgment. The
harness owns fields where exactly one value is correct given the others — `id`,
`asset_tier`, `asset_path`, `loop_seconds`, the rep-cap coupling, and
`is_anchor` (hard-coded `false`, because the anchor set is an owner decision the
spec explicitly defers).

Relations are drafted as movement **names**, not ids — the model can't reference
ids that don't exist yet, and naming is the claim it's actually qualified to
make. Names resolve to ids at import time.

## Not built yet (increment 2)

`review` (terminal triage loop), `import` (two-pass insert-then-link, dry-run by
default), `check` (dangling refs, coverage matrix, vocab-vs-live-CHECK drift).
Import will additionally bind a content hash at approval time, so editing an
approved entry silently un-approves it.
