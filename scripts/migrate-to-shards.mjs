#!/usr/bin/env node
/**
 * THE MUSEUM — one-time shard migration (THE SHARDING MIGRATION,
 * 2026-08-19/20, the Janitor's gavel: "Let's shard now and run parallel
 * extraction campaigns. It's time.").
 *
 * Historical record of how data/shards/ was populated from the pre-sharding
 * monoliths — kept in the repo for audit/reproducibility, not part of the
 * ordinary pipeline (that's scripts/build-data.mjs, which runs every
 * session from here on). Re-running this script is safe (it's a pure
 * function of the current monoliths, idempotent) but should never be
 * necessary again short of a full re-migration.
 *
 * Two modes, run in that order, each its own commit per the migration's own
 * execution plan:
 *
 *   node scripts/migrate-to-shards.mjs normalize
 *     Stable-sorts each of the 7 shardable monoliths by `id` IN PLACE
 *     (data/characters.json etc. — same files, reordered rows only, zero
 *     content change). Run this FIRST, alone, so the migration commit that
 *     follows is a pure move (shard content byte-identical to the
 *     now-normalized monolith rows) rather than a reorder-and-move
 *     conflated together.
 *
 *   node scripts/migrate-to-shards.mjs shard
 *     Reads the (now-normalized) monoliths and writes data/shards/. Also
 *     writes data/shards/_headers/<type>.json (the non-array header fields
 *     each monolith carries — `_schema_version`, rps.json's own `_note`/
 *     `schema` — extracted once here, hand-maintained from here on since
 *     they change far less often than any single row does).
 *
 * Round-trip proof: after `shard`, `node scripts/build-data.mjs` must
 * reproduce every monolith BYTE-IDENTICAL to its post-normalize state.
 * That's verified separately (see the migration's own commit message /
 * archive digest for the diff run), not by this script itself.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SHARD_TYPES, UNASSIGNED_SHARD, buildTitlePromotionMap, shardOf, comparatorFor } from "./shard-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");
const SHARDS = resolve(DATA, "shards");

function readJSON(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}
function writeJSON(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function loadMonolith(type) {
  const p = resolve(DATA, `${type}.json`);
  const obj = readJSON(p);
  return { path: p, obj, rows: obj[type] };
}

function normalize() {
  for (const type of SHARD_TYPES) {
    const { path, obj, rows } = loadMonolith(type);
    const before = JSON.stringify(rows.map((r) => r.id));
    rows.sort(comparatorFor(type));
    const after = JSON.stringify(rows.map((r) => r.id));
    writeJSON(path, obj);
    console.log(`normalize: data/${type}.json — ${rows.length} rows${before === after ? " (already sorted)" : " (reordered)"}`);
  }
}

function shard() {
  const promotions = readJSON(resolve(DATA, "promotions.json")).promotions.map((p) => p.id);
  const titles = readJSON(resolve(DATA, "titles.json")).titles;
  const titlePromotionMap = buildTitlePromotionMap(titles);
  const shardDirs = [...promotions, UNASSIGNED_SHARD];

  // Ensure every promotion (+ the reserved pseudo-shard, + the headers dir) has a directory.
  for (const dir of [...shardDirs, "_headers"]) mkdirSync(resolve(SHARDS, dir), { recursive: true });

  const counts = {};
  for (const type of SHARD_TYPES) {
    const { obj, rows } = loadMonolith(type);
    const header = {};
    for (const k of Object.keys(obj)) if (k !== type) header[k] = obj[k];
    writeJSON(resolve(SHARDS, "_headers", `${type}.json`), header);

    const byShardId = new Map(shardDirs.map((d) => [d, []]));
    for (const row of rows) {
      const dir = shardOf(type, row, titlePromotionMap);
      if (!byShardId.has(dir)) {
        throw new Error(`migrate: ${type} row "${row.id}" resolved to unknown shard "${dir}" — not a promotions.json id and not ${UNASSIGNED_SHARD}`);
      }
      byShardId.get(dir).push(row);
    }
    counts[type] = {};
    for (const dir of shardDirs) {
      const shardRows = byShardId.get(dir);
      counts[type][dir] = shardRows.length;
      // Always write the file, even empty — a parallel writer scoped to a
      // promotion with zero rows of a type today should still find a ready
      // shard file to append its first row to.
      writeFileSync(resolve(SHARDS, dir, `${type}.json`), JSON.stringify(shardRows, null, 2) + "\n");
    }
  }

  console.log("shard: wrote data/shards/<promotion>/<type>.json for", shardDirs.length, "shard dirs ×", SHARD_TYPES.length, "types");
  for (const type of SHARD_TYPES) {
    const nonZero = Object.entries(counts[type]).filter(([, n]) => n > 0);
    console.log(`  ${type}: ${nonZero.map(([d, n]) => `${d}=${n}`).join(", ")}`);
  }
}

const mode = process.argv[2];
if (mode === "normalize") normalize();
else if (mode === "shard") shard();
else {
  console.error("usage: node scripts/migrate-to-shards.mjs <normalize|shard>");
  process.exit(1);
}
