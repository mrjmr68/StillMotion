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

**Severity: high — it is the out-of-the-box experience.**

`DEFAULT_CHECKIN` sets `equipment_on_hand: []`. That was deliberate — prescribing a
kettlebell someone doesn't own produces a session they can't do, and the failure
would look like a bad plan rather than a bad default. But the consequence is worse
than the thing it avoided: with no equipment the bodyweight pool cannot fill 25
minutes, so a first-time user who never opens "More options" gets a degraded
template every time and never sees the generator at all.

Three candidate fixes, not mutually exclusive:

- **Surface feasibility before Generate, not after.** `feasibility()` is already
  pure and already runs server-side; the console could call it as the check-in
  changes and say "bodyweight only gets you about 15 minutes" while there is still
  time to tick Mat. This is the one that treats the user as informed rather than
  surprised.
- **Fill the bodyweight pool** (see 3).
- **Reconsider the default.** `mat` is close to universal and unlocks a large
  fraction of the catalog. Still a guess about someone's room, but a far cheaper
  one to be wrong about than an empty set is.

---

## 3. Catalog gap: bodyweight, no equipment

**Severity: medium — a data problem, not a code one.**

Equipment-free counts are below the `MIN_POOL_SIZES` thresholds for 25 minutes:
2 prepare (needs 3) and 5 main (needs 6). This is the same shape as the already-known
`minimize_floor` gap, which leaves 7 prep and 7 down-regulate.

The highest-value `catalog:generate` batch is therefore the intersection:
**standing and seated mobility, breath work, and bodyweight main-work movements
needing no props.** One batch plausibly fixes both gaps.

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
