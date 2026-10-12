#!/usr/bin/env node
// Scratch tool, THE IDENTITY WAVE — regenerates the workshop-side readable digest
// of data/review-queue.json (the workshop's review-queue-readable.md, one level
// up from this repo, never served/committed here) per THE REVIEW-QUEUE HYGIENE
// doctrine (CURATION.md v66): OPEN entries first by default, settled entries
// (merged/distinct/dismissed) collected in a collapsed tail section.

import fs from "fs";
import path from "path";

const repoRoot = process.cwd();
const data = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "review-queue.json"), "utf8"));
const arr = data.review_queue;
const outPath = path.join(repoRoot, "..", "archive", "digests", "review-queue-readable.md");

const open = arr.filter((e) => e.status === "open");
const settled = arr.filter((e) => e.status !== "open");

function byType(list) {
  const groups = new Map();
  for (const e of list) {
    const list2 = groups.get(e.type) ?? [];
    list2.push(e);
    groups.set(e.type, list2);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderEntry(e) {
  const cands = (e.candidates || []).join(", ");
  const lines = [`### ${e.name}  [${e.status.toUpperCase()}]`, `Candidates: ${cands}`, ""];
  lines.push(e.note || "");
  if (e.resolution_note) lines.push("", e.resolution_note);
  if (e.resolution) lines.push("", e.resolution);
  return lines.join("\n");
}

function renderSection(list, heading) {
  const out = [`## ${heading}`, ""];
  for (const [type, entries] of byType(list)) {
    out.push(`### ${type} (${entries.length})`, "");
    for (const e of entries) {
      out.push(renderEntry(e), "");
    }
  }
  return out.join("\n");
}

const today = new Date().toISOString().slice(0, 10);
const parts = [
  `# The standing review queue — readable digest (regenerated ${today})`,
  "",
  `Source of truth: data/review-queue.json. ${arr.length} entries — ${open.length} open, ${settled.length} settled (distinct/merged/dismissed).`,
  "",
  "Default reading view: OPEN entries first, grouped by type — these are the ones that still need a verdict. Settled entries (merged / distinct / dismissed) are collected in a collapsed tail section below, for reference only.",
  "",
  "---",
  "",
  renderSection(open, "OPEN — still need a verdict"),
  "",
  "---",
  "",
  "<details>",
  "<summary>Settled entries (merged / distinct / dismissed) — click to expand</summary>",
  "",
  renderSection(settled, "SETTLED"),
  "",
  "</details>",
  "",
];

fs.writeFileSync(outPath, parts.join("\n"));
console.log(`Wrote ${outPath} — ${open.length} open, ${settled.length} settled`);
