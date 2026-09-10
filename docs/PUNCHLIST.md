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

## 4. `swap` is accepted and ignored

**Severity: low — known, deliberate, pre-existing.**

It needs a catalog row the TV never bundled, and choosing a replacement belongs with
the console slice. Currently logs a HUD note rather than failing silently.

---

## 5. The anchor list is empty

**Severity: low — an owner decision, not a defect.**

`is_anchor` is `false` on all 91 entries. The 8–12 anchors are a judgement call about
which movements should recur often enough to become familiar.

---

## 6. One duplicate held back in review

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
