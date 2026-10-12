/**
 * THE SHARDING MIGRATION — shared shard-assignment rules.
 *
 * The single source of truth for "which promotion's shard does this row
 * belong to," shared by scripts/migrate-to-shards.mjs (one-time migration),
 * scripts/build-data.mjs (every build), and scripts/registry-validate.mjs
 * (shard-integrity + shard-assignment-rule checks) — so the rule can never
 * drift between the script that assigns and the script that checks.
 *
 * THE ASSIGNMENT RULE (binding, documented in full in docs/SCHEMA.md's
 * "Sharding" section):
 *
 *   - shows.json / rps.json / titles.json / awards.json rows carry their
 *     own `promotion` field directly — the shard IS that field's value.
 *   - characters.json / units.json rows shard on `tenures[0].promotion` —
 *     the FIRST tenure listed on the row, not necessarily chronologically
 *     first and not a "most important" judgment call, just array-order-0,
 *     so the rule is 100% mechanical and never requires curatorial
 *     judgment. A multi-tenure entity's row is NOT duplicated or split —
 *     the whole row lives in one shard, unchanged, exactly as documented
 *     in the Janitor's own design brief ("a row's shard = its promotion;
 *     multi-tenure characters live in the shard of their FIRST/primary
 *     tenure with the row unchanged — sharding is STORAGE layout, never
 *     data meaning"). A character/unit with NO tenures at all (a frontier-
 *     only entity, tied to an unheld promotion, tenure deliberately omitted
 *     rather than guessed — four rows on file as of this migration) has no
 *     promotion to shard on; it lives in the reserved `_unassigned` pseudo-
 *     shard instead of forcing a guess.
 *   - reigns.json rows carry no `promotion` field at all (never did) — the
 *     shard is derived by joining `reign.title` against titles.json's own
 *     `promotion` field. This is a lookup at build/migrate time, never a
 *     new stored field — the reign row itself is written to its shard file
 *     completely unchanged.
 *   - rp-catalog.json is NOT sharded (see docs/SCHEMA.md) — most of its
 *     rows carry neither a `promotion` field nor a reliable mechanical way
 *     to derive one (1,162 of 2,105 rows, as surveyed at migration time,
 *     are `held: false` catalog entries with no `rps_id`/`show_id` to join
 *     through and no domain-bearing `url`). Sharding it would require
 *     inventing a fact the record doesn't currently carry, which the
 *     migration's own design principle forbids ("sharding is storage
 *     layout, never data meaning"). It stays a cross-promotion monolithic
 *     source until a future wave adds a real `promotion` field to every
 *     row — a schema change, not a storage migration.
 */

// The types that migrate to per-promotion shards. Each maps to the shape
// its shard files hold: a bare JSON array of that type's rows, no wrapper.
export const SHARD_TYPES = [
  "characters",
  "units",
  "shows",
  "rps",
  "reigns",
  "titles",
  "awards",
];

// The reserved pseudo-shard directory for entities with no tenure to shard
// on. Only ever holds characters.json rows (units.json currently has zero
// zero-tenure rows; the mechanism still applies to units if that ever
// changes).
export const UNASSIGNED_SHARD = "_unassigned";

/** Build a `titleId -> promotionId` lookup from titles.json's own rows. */
export function buildTitlePromotionMap(titles) {
  const m = new Map();
  for (const t of titles) m.set(t.id, t.promotion);
  return m;
}

/**
 * Returns the shard id (a promotions.json id, or UNASSIGNED_SHARD) a given
 * row of `type` belongs to. `titlePromotionMap` is only consulted for
 * `type === "reigns"` (build it once via buildTitlePromotionMap and pass it
 * through — a fresh join per row would be needlessly quadratic).
 */
export function shardOf(type, row, titlePromotionMap) {
  switch (type) {
    case "characters":
    case "units": {
      const first = row.tenures?.[0];
      return first?.promotion ?? UNASSIGNED_SHARD;
    }
    case "rps":
      // hook c106 (the Janitor's D407, "(A) on the hub"): a roleplay no fed claims shards on the community hub it was
      // posted on (`venue`); a later `promotion` moves it to that fed's shard (fix-shard-assignment.py), URL unchanged.
      return row.promotion ?? row.venue ?? UNASSIGNED_SHARD;
    case "shows":
    case "titles":
    case "awards":
      return row.promotion ?? UNASSIGNED_SHARD;
    case "reigns":
      return titlePromotionMap?.get(row.title) ?? UNASSIGNED_SHARD;
    default:
      throw new Error(`shard-lib: unknown shardable type "${type}"`);
  }
}

/** Stable sort comparator — plain string comparison on `id`, ties broken
 *  by original array position (Array#sort/toSorted are already stable in
 *  every Node version this repo targets, so no explicit index tiebreak is
 *  needed — kept as a named comparator purely so every caller sorts the
 *  exact same way). */
export function byId(a, b) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * reigns.json's own DECLARED sort key is never `id` — reign ids are a mix
 * of two minting schemes across the corpus's own history (a `<title>-rNNN`
 * running counter for one wave, a `<title>-<label>-<year>` slug for
 * another), so a plain string sort on `id` does NOT reproduce chronological
 * order even within one title's own reigns (caught live during this
 * migration: napw-world's `napw-world-evan-cartwright-2006` id-sorts
 * *before* `napw-world-r001` despite winning over a year later).
 * `registry-validate.mjs`'s own chronological-ordering check
 * (THE REIGN-SHOW LINKAGE INVARIANT's neighbor, "dates run backwards")
 * depends on same-title reigns staying grouped in `won`-date order in the
 * monolith's own array — so reigns sort on `title` instead (grouping every
 * title's reigns back together), stable, which preserves each title's own
 * existing chronological order exactly as long as that group's OWN
 * internal order was already chronological (true of every title on file as
 * of this migration — the "dates run backwards" check passes both before
 * and after this resort). Every other shardable type sorts on `id` — see
 * `byId` above — because none of them carry an analogous cross-row
 * ordering invariant.
 */
export function byTitleThenOrder(a, b) {
  if (a.title < b.title) return -1;
  if (a.title > b.title) return 1;
  return 0;
}

/** The correct stable-sort comparator for a given shardable type — the
 *  one thing every caller (migrate-to-shards.mjs, build-data.mjs) must
 *  share so the monolith's row order is reconstructed identically every
 *  time, regardless of which order shard files were read in. */
export function comparatorFor(type) {
  return type === "reigns" ? byTitleThenOrder : byId;
}
