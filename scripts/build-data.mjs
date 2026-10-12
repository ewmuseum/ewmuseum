#!/usr/bin/env node
/**
 * THE MUSEUM — shard build step (THE SHARDING MIGRATION).
 *
 * Concatenates data/shards/<promotion-id>/<type>.json (plus the reserved
 * data/shards/_unassigned/<type>.json pseudo-shard, characters.json only
 * today) into the EXISTING monolithic data/<type>.json files — which are,
 * from this point on, GENERATED ARTIFACTS. Every consumer (client JS
 * fetches, cross-reference.mjs, the stampers, both validators) keeps
 * reading data/<type>.json unchanged; shards are a storage-layout change
 * only, never a data-meaning one (docs/SCHEMA.md's own "Sharding" section
 * has the full doctrine — read it before editing this file).
 *
 * Deterministic by construction: every type's rows are gathered from every
 * shard (file-read order doesn't matter) and then stable-sorted — by `id`
 * for every type except `reigns` (which sorts by `title` instead, to
 * preserve each title's own chronological reign order; see
 * scripts/shard-lib.mjs's `comparatorFor` for why) — so the same shard
 * contents always produce the same byte-for-byte monolith regardless of
 * directory-listing order across machines/OSes.
 *
 * Run directly (`node scripts/build-data.mjs` / `npm run build:data`) to
 * write every data/<type>.json. Also imported by scripts/registry-validate.mjs
 * for its rebuild-diff freshness check (build in memory, compare against
 * what's on disk, hard-fail on drift — the same "chrome/stats must be
 * fresh before check" pattern this repo already enforces).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SHARD_TYPES, UNASSIGNED_SHARD, comparatorFor } from "./shard-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");
const SHARDS = resolve(DATA, "shards");
const HEADERS = resolve(SHARDS, "_headers");

function readJSON(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Every promotion id shards may exist under, plus the reserved pseudo-shard. */
export function listShardDirs() {
  const promotions = readJSON(resolve(DATA, "promotions.json")).promotions;
  return [...promotions.map((p) => p.id), UNASSIGNED_SHARD];
}

/** Rows for one type, gathered from every shard directory that carries it. */
export function readShardRows(type) {
  const dirs = listShardDirs();
  const rows = [];
  for (const dir of dirs) {
    const p = resolve(SHARDS, dir, `${type}.json`);
    if (!existsSync(p)) continue;
    const arr = readJSON(p);
    if (!Array.isArray(arr)) {
      throw new Error(`build-data: data/shards/${dir}/${type}.json is not a bare array`);
    }
    rows.push(...arr);
  }
  rows.sort(comparatorFor(type));
  return rows;
}

/** Builds one type's full monolith object + its exact serialized text. */
export function buildMonolith(type) {
  const header = readJSON(resolve(HEADERS, `${type}.json`));
  const rows = readShardRows(type);
  const obj = { ...header, [type]: rows };
  const text = JSON.stringify(obj, null, 2) + "\n";
  return { obj, text };
}

/** Builds every shardable type. Returns a Map<type, {obj, text}>. */
export function buildAll() {
  const out = new Map();
  for (const type of SHARD_TYPES) out.set(type, buildMonolith(type));
  return out;
}

function main() {
  const built = buildAll();
  for (const [type, { text }] of built) {
    writeFileSync(resolve(DATA, `${type}.json`), text);
  }
  console.log(`build:data — wrote ${built.size} monoliths from data/shards/: ${[...built.keys()].join(", ")}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
