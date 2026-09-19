# Punch list

Things found while actually using the thing, kept until they are dealt with.
Opened 2026-09-10 during the first end-to-end run on the real television.

Ordered by how much they matter, not by how hard they are.

---

## 1. The shape screen blames the generator for something it didn't do

**Severity: high — it is actively misleading.**

The first real check-in produced "Built from a template this time — the generator
didn't produce a usable plan." That is false. `source` was `template_degraded`,
which means the **pool was too thin and generation was never attempted**. No API
call was made.

`ShapeCard` treats both template paths identically, but they are different events
with different fixes:

| source | what happened | what the user should do |
| --- | --- | --- |
| `template_degraded` | pool too thin, generation skipped | add equipment, or relax a constraint |
| `template` | the model ran and the result couldn't be repaired | nothing — try again |

The honest message for the first case names the constraint that caused it, which
the finding already carries: `prepare: 2 of 3 needed; main work: 5 of 6 needed`.

---

## 2. The default check-in cannot reach the generator

**Severity: high — it is the out-of-the-box experience, and it is not marginal.**

Measured against the real catalog:

| equipment | pool | 15 | 25 | 40 | 60 |
| --- | --- | --- | --- | --- | --- |
| nothing (the default) | 12 | ok | **no** | **no** | **no** |
| mat | 46 | ok | ok | ok | ok |
| mat + wall | 50 | ok | ok | ok | ok |
| mat + wall + chair | 55 | ok | ok | ok | ok |
| everything | 91 | ok | ok | ok | ok |

Shortfalls with no equipment:

```
25min  prepare: 2 of 3 needed; main work: 5 of 6 needed
40min  prepare: 2 of 3; main work: 5 of 8; down-regulate: 2 of 3
60min  prepare: 2 of 4; main work: 5 of 10; down-regulate: 2 of 3
```

So `DEFAULT_CHECKIN`'s `equipment_on_hand: []` is not a slightly pessimistic
default — it is the one setting under which **only a 15-minute session can ever be
generated**. Everything longer skips generation entirely. The reasoning behind the
default was sound (never prescribe a kettlebell someone does not own) and the
consequence is worse than the thing it avoided.

**A single mat takes the pool from 12 to 46 and makes all four durations feasible.**
That is the whole fix for three of the four, from one default.

Do both of these:

- **Default `equipment_on_hand` to `['mat']`.** Highest leverage in the codebase
  per character changed. Still a guess about someone's room, but being wrong about
  a mat costs one substitution, while being wrong about an empty room costs the
  generator entirely.
- **Surface feasibility on the form, before Generate.** `feasibility()` is already
  pure and already runs server-side. The console should say "bodyweight only
  reaches 15 minutes" while there is still time to tick something, rather than
  reporting it after the fact. This is the part that treats the user as informed
  instead of surprised, and it stays correct as the catalog grows.

---

## 3. The catalog is 87% props

**Severity: medium — a data bias, not a code fault.**

Only **12 of 91** entries need no equipment at all. The generation batches leaned on
props without anyone deciding they should, and the equipment-free floor is what
item 2 runs into. Related: the known `minimize_floor` gap leaves 7 prep and 7
down-regulate.

The highest-value `catalog:generate` batch is the intersection of both gaps:
**standing and seated mobility, breath work, and bodyweight main-work movements
needing no props.** One batch plausibly fixes both, and would raise the
equipment-free pool from 12 to somewhere near 25 — enough for a 40-minute session
with nothing but a floor.

---

## 4. There is no artwork yet

**Severity: high — the biggest hole in the product. The pipeline now exists; the
art does not.**

**Update 2026-09-19:** the delivery path is built and proven end to end.
`assets:upload` writes into the public bucket and sets `asset_ready` only after
the storage write returns ok; `resolveAsset` branches on that flag and hands the
television a real public URL. Verified with throwaway files: an uploaded movement
resolves to a URL and an un-uploaded one still resolves to null, so a catalog
half-covered in art renders correctly — which is the state it will be in for a
long time.

Decided: **animated 3D**, sourced from Mixamo first with the exotic movements
filled in later. Whether it renders live on the set or is pre-rendered to video
loops is waiting on `/stage/probe/render`, which measures a rigged character
under load on the actual television.

What remains is the art itself.

The plumbing is finished and was built for this: `Figure` branches on
`asset_url`/`asset_kind` and never on `asset_tier`, the box the art will occupy is
already reserved at the right size so the ten-foot composition will not shift the
day it arrives, and the bucket is public so the unauthenticated TV needs no signing
round-trip. Dropping art in is an upload.

What is missing is the art itself, and the decision about what it should be:

- **Tier 0, line-drawing stills.** One SVG per movement. Cheapest, and the box is
  already sized for it. Generating 91 anatomically-legible exercise drawings
  programmatically is the risky part — form is exactly what a wrong drawing gets
  wrong, and a wrong drawing on a ten-foot screen teaches the wrong thing.
- **Tier 1, pose cycles.** Two or three stills per movement, cross-faded. Much more
  legible for anything with a start and end position, which is most of them.
- **Tier 2, short video loops.** What spec §8 actually asks for. Filming 91 of them
  is real work but produces the only version that teaches unfamiliar movements
  without words.
- **Interim, and worth considering on its own merits:** the placeholder could carry
  more than `body_position` — the setup note, a start/end description — and be
  genuinely useful rather than obviously absent.

Until this lands, the stage teaches movements you already know and names movements
you don't.

---

## 5. Ending early records the whole session as performed

**Severity: high — it writes false history.**

Observed: `end` pressed 59 seconds into a 25-minute session wrote 32 `exercise_logs`
rows, every one at full prescribed dose with `was_skipped` false — including two
entire blocks that were never reached.

`buildPerformed` only distinguishes items in `run.skipped`, which holds explicit
`skip` commands. Anything the clock never arrived at is indistinguishable from
something completed. The unilateral grain is correct (one plan item writing left and
right rows), so the shape of the data is right and only the truth of it is wrong.

It needs the phase the run actually stopped at: items after it were not performed,
and the item in progress was partial. `exercise_logs.completed_dose` is nullable
precisely so "unknown" is expressible, and `was_skipped` already exists for
"deliberately passed" — the missing third state is "never reached", which should
probably not produce a row at all.

This matters more than it looks: Build 2's progression and the recency window both
read these rows, so a minute of testing currently looks like a completed workout.

---

## 6. `swap` is accepted and ignored

**Severity: low — known, deliberate, pre-existing.**

It needs a catalog row the TV never bundled, and choosing a replacement belongs with
the console slice. Currently logs a HUD note rather than failing silently.

---

## 7. The anchor list is empty

**Severity: low — an owner decision, not a defect.**

`is_anchor` is `false` on all 91 entries. The 8–12 anchors are a judgement call about
which movements should recur often enough to become familiar.

---

## 8. One duplicate held back in review

**Severity: low.**

`push_v.review.json` holds "Half-Kneeling One-Arm Press" back over an over-broad
alias. Needs a decision, not work.

---

## Resolved during this run

- **Begin on the phone did nothing.** `POST /api/console/command` did an `update`
  on `session_live_state`, but that row does not exist until a session starts — so
  the one command whose job is to START a session had nowhere to land. Zero rows
  changed, no error from Postgres, a 200 from the endpoint, and a television that
  never heard anything. Unseen until now because the first verification pressed OK
  on the TV, which takes a different path. All three writes in that endpoint are
  upserts now, affecting zero rows is reported as a failure rather than a success,
  and the console shows it. Same update-vs-upsert class as the `user_preferences`
  bug found earlier the same day — worth treating as a pattern to look for.

- **Magic link failed from the phone.** Three independent causes: a hardcoded
  `NEXT_PUBLIC_SITE_URL`, Next dev blocking its own chunks from the LAN address, and
  Supabase silently substituting `site_url` for a non-allow-listed redirect. All
  fixed; see `docs/DECISIONS.md`.
- **The TV showed `····` and ran no JavaScript.** The bundle contained optional
  chaining and nullish coalescing, which its engine cannot parse. Browserslist pinned
  low; see `BROWSERSLIST.md`. Confirmed working on the set.
- **A TV paired to the wrong account could not be moved.** Pairing only fires on a
  401, so a set holding a valid token never showed a code again. Added
  `POST /api/console/pair/revoke` and a "Forget the connected television" control.
