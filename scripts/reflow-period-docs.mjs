#!/usr/bin/env node
/**
 * THE MUSEUM — period-document reflow tool (DOC-REFLOW lane, 2026-09-08).
 *
 * `--dry-run` and `--check` are diagnostic only and never write to any
 * file. `--write --class prose` (added this pass) DOES rewrite files, but
 * only whitespace, and only inside documents the classifier puts in the
 * `hard-wrapped-prose` class — never `mixed`, `list-card-table`, or any
 * other class. See PROPOSAL.md for the full investigation and heuristic
 * writeup; this header stays short and points there.
 *
 * promotions/*\/archive/*.html and promotions/*\/rp/*.html carry the
 * museum's served verbatim documents; CLAUDE.md invariant #4 / CURATION.md's
 * verbatim-serving rule say the mined text inside a served `.document`
 * block is never edited, corrected, or improved, though "wrapping repairs"
 * are explicitly carved out as allowed presentation work. `--write` acts
 * only within that carve-out: every character it changes is a hard-wrap
 * artifact `\n` (plus any surrounding horizontal whitespace) becoming a
 * single space — no letter, digit, punctuation mark, entity, or tag is
 * ever added, removed, or reordered. `<pre>`-classed blocks, any line the
 * "row" predicate flags (table/list/bracket/ASCII-art/quoted-reply/URL/
 * label-value/vs./ALLCAPS-heading), and any `<a class="entity-link">`
 * anchor or `<span class="redacted">` marker are left untouched — see
 * `looksLikeRow` and the cross-line-tag guard below. `--check` can also
 * serve as a regression signal that a new accession isn't landing
 * pre-hard-wrapped.
 *
 * Usage:
 *   node scripts/reflow-period-docs.mjs --dry-run [path-or-glob-root]
 *   node scripts/reflow-period-docs.mjs --check   [path-or-glob-root]
 *   node scripts/reflow-period-docs.mjs --dry-run --verbose path/to/one/file.html
 *   node scripts/reflow-period-docs.mjs --write --class prose [path-or-glob-root]
 *
 * --dry-run   walks promotions/*\/archive and promotions/*\/rp (or the given
 *             root), classifies every served .document block, and prints a
 *             per-file report of what would change (paragraph count, lines
 *             joined) plus a corpus-wide summary. Writes nothing.
 * --check     same walk and classification, summary only (no per-file
 *             listing); exits 1 if any document classifies as clearly
 *             hard-wrapped, 0 otherwise. Meant as an optional advisory signal
 *             for a future accession, never wired into `npm run check`.
 * --verbose   with --dry-run, also prints a before/after excerpt for every
 *             file that has at least one joinable boundary.
 * --write --class prose
 *             rewrites, in place, ONLY the `.document` blocks (per block,
 *             not per file — a file with several blocks may have some
 *             rewritten and others left alone) that classify as
 *             `hard-wrapped-prose`. `--class` currently accepts only
 *             `prose`; any other value is a usage error and nothing is
 *             written. A block is skipped (left byte-identical, logged as
 *             skipped) rather than rewritten if any tag inside it spans a
 *             raw newline (so a naive per-line strip could mis-measure or
 *             mis-split it) or if a whitespace-only round-trip invariant
 *             check fails for any other reason — this tool fails closed,
 *             never writes a block it isn't sure about.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === ".claude" || name === "node_modules" || name === "bot" || name === "functions") continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

function findServedDocFiles(root) {
  const promotionsDir = join(root, "promotions");
  const out = [];
  for (const promo of readdirSync(promotionsDir)) {
    const promoDir = join(promotionsDir, promo);
    if (!statSync(promoDir).isDirectory()) continue;
    for (const sub of ["archive", "rp"]) {
      const subDir = join(promoDir, sub);
      try {
        if (statSync(subDir).isDirectory()) walk(subDir, out);
      } catch {
        /* no archive/ or rp/ for this promotion — fine */
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract every <div class="document">...</div> block (by brace-depth match,
// since HTML-entity-encoded text inside can itself contain "</div"-looking
// substrings only as literal encoded text, never as a real tag).
// ---------------------------------------------------------------------------

function extractDocumentBlocks(html) {
  const blocks = [];
  const openRe = /<div class="document">/g;
  const tagRe = /<(\/?)div\b/g;
  let om;
  while ((om = openRe.exec(html))) {
    const start = om.index + om[0].length;
    tagRe.lastIndex = start;
    let depth = 1;
    let tm;
    let end = -1;
    while ((tm = tagRe.exec(html))) {
      if (tm.index < start) continue;
      depth += tm[1] === "" ? 1 : -1;
      if (depth === 0) {
        end = tm.index;
        break;
      }
    }
    if (end === -1) continue; // malformed — skip rather than guess
    blocks.push({ start, end, raw: html.slice(start, end) });
    openRe.lastIndex = end;
  }
  return blocks;
}

// About 28% of served .document blocks contain an embedded cross-reference
// link — e.g. `<a href="/characters/bullet-4ww.html" class="entity-link"
// data-entity="bullet-4ww">Bullet</a>` — auto-linked into the verbatim text
// by cross-reference.mjs. Any real implementation — build-time or render-time
// — must treat these as opaque inline nodes it never flattens or rewrites
// (see PROPOSAL.md §6 and §8). For length/row/sentence-end MEASUREMENT,
// tags are stripped (keeping their inner text) before any length-based
// heuristic runs, the same way a browser's `textContent` would see it. This
// mirrors runtime measurement only — `--write` always splices back into the
// ORIGINAL raw (tag-and-entity-intact) line, never the stripped view; see
// buildRawJoinPlan below.
function stripTagsKeepText(s) {
  return s.replace(/<[^>]+>/g, "");
}

// Minimal HTML-entity decode — only for the analysis heuristic (line-length,
// punctuation, case). The actual served bytes are never touched by this tool
// except via the explicit raw-line splice in buildRawJoinPlan.
const ENTITY_MAP = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'",
  "&#39;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–",
  "&hellip;": "…",
};
function decodeEntities(s) {
  return s.replace(/&#x?[0-9a-fA-F]+;|&[a-zA-Z]+;/g, (m) => {
    if (ENTITY_MAP[m]) return ENTITY_MAP[m];
    const hex = m.match(/^&#x([0-9a-fA-F]+);$/);
    if (hex) return String.fromCodePoint(parseInt(hex[1], 16));
    const dec = m.match(/^&#(\d+);$/);
    if (dec) return String.fromCodePoint(parseInt(dec[1], 10));
    return m;
  });
}

// ---------------------------------------------------------------------------
// The reflow heuristic — port this alongside js/reflow-document.js.
// Decides, for one line-boundary inside a blank-line-delimited paragraph
// block, whether the newline between `cur` and `next` is a hard-wrap
// artifact (should join with a single space) or an intentional break
// (leave alone).
// ---------------------------------------------------------------------------

const SENTENCE_END_RE = /[.!?:;"')\]]\s*$/;
const LIST_ITEM_RE = /^\s*(?:[-*=+#>]|\(?\d{1,3}[.)]\s|\(?[a-zA-Z][.)]\s)/;
const ALLCAPS_HEADING_RE = /^[A-Z0-9 .,'"!?&/-]{4,}$/;
const VS_RE = /\bvs\.?\b/i;
const LABEL_VALUE_RE = /^\S+\s*[:\-]\s*\S/;
const URL_LINE_RE = /^(?:https?:\/\/|www\.)\S+$/i;
// A line that's ASCII-art/box-drawing border — composed entirely of
// symbol/whitespace characters, no letters or digits at all (a run of
// underscores or pipes forming a signature-block box, a `---` or `===`
// divider, etc.). The pre-existing "3+ consecutive spaces" table signal
// only catches column *alignment*; it does not catch a solid border made of
// non-space characters, which has no letters for ALLCAPS_HEADING_RE to
// require either — found and fixed during --write hand-verification
// (DOC-REFLOW lane, 2026-09-08): a Usenet .sig block's own top/bottom
// border line (` ____...____` / `|____...____|`) was being joined into the
// signature text below/above it. Requires at least one run of 4+ identical
// border characters so a short, ordinary punctuation run doesn't misfire.
const BORDER_LINE_RE = /^[\s\-=_*~^+#|<>/\\.]{6,}$/;
const BORDER_RUN_RE = /([\-=_*~^+#|<>/\\.])\1{3,}/;

/** A line that reads as a list/results/bracket/table/quote row rather than
 * wrapped prose — never a join candidate on either side of it. */
function looksLikeRow(line) {
  const s = line.trim();
  if (!s) return true;
  if (/ {3,}/.test(s)) return true; // 3+ spaces = column alignment; a plain
  // double-space-after-period is normal prose punctuation for this era and
  // is deliberately NOT treated as a table signal.
  if (LIST_ITEM_RE.test(s)) return true; // also catches '>' quote-reply lines
  if (BORDER_LINE_RE.test(s) && BORDER_RUN_RE.test(s)) return true; // ASCII-art border/divider
  if (ALLCAPS_HEADING_RE.test(s) && s.length < 60) return true;
  if (VS_RE.test(s) && s.length < 70) return true;
  if (LABEL_VALUE_RE.test(s) && s.length < 45) return true;
  if (URL_LINE_RE.test(s)) return true; // a bare URL on its own line stays isolated
  return false;
}

/** Split a document's plain text into blank-line-delimited paragraph blocks
 * of raw (still-indented) lines. */
function toBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let cur = [];
  for (const l of lines) {
    if (l.trim() === "") {
      if (cur.length) blocks.push(cur);
      cur = [];
    } else {
      cur.push(l);
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

/**
 * The core per-boundary decision, shared by analyzeDocument (plain decoded
 * lines) and buildRawJoinPlan (paired raw/decoded lines) so the two paths
 * can never diverge. `block` is an array of decoded-text lines; `i` is the
 * boundary between block[i] and block[i+1]; `blockDomLen` is the paragraph's
 * own dominant (non-row) line length, precomputed once per block.
 */
function decideBoundary(block, i, blockDomLen) {
  const cur = block[i].trimEnd();
  const nextRaw = block[i + 1];
  const next = nextRaw.trimStart();
  if (looksLikeRow(cur) || looksLikeRow(nextRaw)) return false;
  if (SENTENCE_END_RE.test(cur) || cur.length < 35) return false;
  // 2026-10-03 (BLOB-DIAGNOSIS 0.17% misfire, desk D243): never join into a speaker/stipulation label
  // ("Fountain: ...", "STIPULATIONS: ...") or after a stage-direction / bracket closer.
  if (/^[A-Z][A-Za-z0-9 .'"-]{1,30}:\s/.test(next)) return false;
  if (/[>\]}]\s*$/.test(cur)) return false;
  if (next && (/[a-z]/.test(next[0]) || [",", ";", ")"].includes(next[0]))) return true;
  if (blockDomLen >= 55 && blockDomLen - cur.length <= 6) return true;
  return false;
}

function dominantLen(block) {
  return Math.max(0, ...block.filter((l) => !looksLikeRow(l)).map((l) => l.trimEnd().length));
}

/**
 * Analyze one document's decoded plain text. Returns per-boundary join
 * decisions (for a real implementation to act on) plus corpus-report stats.
 * This function makes NO changes — it only classifies.
 */
function analyzeDocument(decodedText) {
  const blocks = toBlocks(decodedText);
  let totalLines = 0;
  let rowLikeLines = 0;
  let totalBoundaries = 0;
  let joinableBoundaries = 0;
  const joinDecisions = []; // { blockIndex, lineIndex, join: bool }

  blocks.forEach((block, bi) => {
    for (const l of block) {
      totalLines++;
      if (looksLikeRow(l)) rowLikeLines++;
    }
    if (block.length < 2) return;
    const blockDomLen = dominantLen(block);
    for (let i = 0; i < block.length - 1; i++) {
      totalBoundaries++;
      const join = decideBoundary(block, i, blockDomLen);
      if (join) joinableBoundaries++;
      joinDecisions.push({ blockIndex: bi, lineIndex: i, join });
    }
  });

  const rowRatio = totalLines ? rowLikeLines / totalLines : 0;
  const joinableRatio = totalBoundaries ? joinableBoundaries / totalBoundaries : 0;

  let cls;
  if (totalLines === 0) cls = "empty";
  else if (rowRatio > 0.55) cls = "list-card-table";
  else if (totalBoundaries < 2) cls = "too-short-or-single-line";
  else if (joinableRatio >= 0.45) cls = "hard-wrapped-prose";
  else if (joinableRatio >= 0.15) cls = "mixed";
  else cls = "not-hard-wrapped";

  return { cls, totalLines, rowRatio, totalBoundaries, joinableBoundaries, joinableRatio, blocks, joinDecisions };
}

/** Apply join decisions to produce the reflowed text — used only to render
 * the before/after preview in --verbose reports. Never written to disk. */
function applyJoins({ blocks, joinDecisions }) {
  const decisionsByBlock = new Map();
  for (const d of joinDecisions) {
    if (!decisionsByBlock.has(d.blockIndex)) decisionsByBlock.set(d.blockIndex, []);
    decisionsByBlock.get(d.blockIndex).push(d);
  }
  const outParagraphs = [];
  blocks.forEach((block, bi) => {
    const decisions = decisionsByBlock.get(bi) || [];
    let out = block[0] ?? "";
    for (let i = 1; i < block.length; i++) {
      const d = decisions.find((x) => x.lineIndex === i - 1);
      if (d && d.join) {
        out = out.trimEnd() + " " + block[i].trimStart();
      } else {
        out += "\n" + block[i];
      }
    }
    outParagraphs.push(out);
  });
  return outParagraphs.join("\n\n");
}

// ---------------------------------------------------------------------------
// --write support: apply the SAME per-boundary decisions to the ORIGINAL raw
// (tag-and-entity-intact) text of a .document block, never to the
// decoded/stripped view used only for measurement.
// ---------------------------------------------------------------------------

/** Collapse every run of whitespace to a single space and trim. Used only as
 * an invariant check: since a correct reflow only ever turns a hard-wrap
 * `\n` (plus surrounding horizontal whitespace) into a single space, and
 * both a `\n` and a run of spaces collapse to the same thing under this
 * normalization, the collapsed form of a block MUST be identical before and
 * after a correct rewrite — this is the cheapest strong check available and
 * catches literally any accidental character loss/gain. */
function collapseWS(s) {
  return s.replace(/\s+/g, " ").trim();
}

/** True if any tag inside `raw` contains a literal newline (i.e. the tag's
 * own markup spans a raw line boundary — an `<a ...\n ...>` or a
 * `<span class="redacted">...\n...</span>` whose content crosses a line).
 * In that case per-raw-line tag-stripping (which operates one line at a
 * time) cannot be trusted to measure or splice correctly, so the caller
 * must skip the whole block rather than risk mismeasuring or, worse,
 * corrupting a redaction span. Checked against the real corpus: exactly one
 * `<a>`-family case (0 for entity-link) and one `<span class="redacted">`
 * case exist site-wide, and neither is in the hard-wrapped-prose class, but
 * the guard stays in unconditionally since a future accession could add
 * one. */
function hasCrossLineTag(raw) {
  const re = /<[^>]*>/g;
  let m;
  while ((m = re.exec(raw))) {
    if (m[0].includes("\n")) return true;
  }
  return false;
}

/**
 * Build the rewritten raw text for one .document block, applying the exact
 * same boundary decisions analyzeDocument would make (via the shared
 * decideBoundary), but splicing the join into the ORIGINAL raw line pair
 * (markup, entities, and redaction spans intact) rather than the
 * decoded/stripped measurement view.
 *
 * Returns { newRaw, joins, skipped, reason }. `skipped` is true (and
 * `newRaw` equals the input) whenever the block cannot be safely rewritten;
 * the caller must never write a skipped block.
 */
function buildRawJoinPlan(raw) {
  if (hasCrossLineTag(raw)) {
    return { newRaw: raw, joins: 0, skipped: true, reason: "tag spans a raw newline" };
  }

  const rawLines = raw.split("\n");
  const decodedWhole = decodeEntities(stripTagsKeepText(raw));
  const decodedLines = decodedWhole.split("\n");

  if (decodedLines.length !== rawLines.length) {
    // Should be unreachable given the cross-line-tag guard above (and the
    // corpus has no newline-producing entities — verified separately), but
    // fail closed rather than guess if some future accession breaks the
    // assumption.
    return { newRaw: raw, joins: 0, skipped: true, reason: "raw/decoded line count mismatch" };
  }

  // Rebuild the same blank-line-delimited paragraph grouping toBlocks()
  // uses, carrying the original flat-array index alongside each decoded
  // line so a join decision maps back to an exact raw-line boundary.
  const blocksWithIdx = [];
  let cur = [];
  decodedLines.forEach((dl, idx) => {
    if (dl.trim() === "") {
      if (cur.length) blocksWithIdx.push(cur);
      cur = [];
    } else {
      cur.push({ decoded: dl, idx });
    }
  });
  if (cur.length) blocksWithIdx.push(cur);

  const joinAt = new Array(rawLines.length - 1).fill(false); // joinAt[k] = join boundary between rawLines[k] and rawLines[k+1]
  let joins = 0;

  for (const block of blocksWithIdx) {
    if (block.length < 2) continue;
    const decodedOnly = block.map((p) => p.decoded);
    const blockDomLen = dominantLen(decodedOnly);
    for (let i = 0; i < block.length - 1; i++) {
      // Paragraph blocks are maximal runs of consecutive non-blank lines,
      // so within a block, consecutive entries are always adjacent raw
      // lines (idx differs by exactly 1) — assert this defensively rather
      // than trust it silently.
      if (block[i + 1].idx !== block[i].idx + 1) {
        return { newRaw: raw, joins: 0, skipped: true, reason: "non-contiguous paragraph block (unexpected)" };
      }
      const join = decideBoundary(decodedOnly, i, blockDomLen);
      if (join) {
        joinAt[block[i].idx] = true;
        joins++;
      }
    }
  }

  if (joins === 0) return { newRaw: raw, joins: 0, skipped: false, reason: null };

  let out = rawLines[0];
  for (let k = 1; k < rawLines.length; k++) {
    if (joinAt[k - 1]) {
      out = out.replace(/[ \t]+$/, "") + " " + rawLines[k].replace(/^[ \t]+/, "");
    } else {
      out += "\n" + rawLines[k];
    }
  }

  // Invariant check: only whitespace may have changed. Fail closed on any
  // violation rather than write a suspect block.
  if (collapseWS(out) !== collapseWS(raw)) {
    return { newRaw: raw, joins: 0, skipped: true, reason: "whitespace-only invariant failed" };
  }
  const entityLinkBefore = (raw.match(/class="entity-link"/g) || []).length;
  const entityLinkAfter = (out.match(/class="entity-link"/g) || []).length;
  const redactedBefore = (raw.match(/class="redacted"/g) || []).length;
  const redactedAfter = (out.match(/class="redacted"/g) || []).length;
  if (entityLinkBefore !== entityLinkAfter || redactedBefore !== redactedAfter) {
    return { newRaw: raw, joins: 0, skipped: true, reason: "entity-link/redacted marker count changed" };
  }

  return { newRaw: out, joins, skipped: false, reason: null };
}

const CLASS_MAP = { prose: "hard-wrapped-prose" };

/**
 * Rewrite files in place. Only `.document` blocks classifying as
 * `targetCls` are touched; every other block in a file is left
 * byte-identical. Returns a report: files actually rewritten (with their
 * per-file join counts), and any blocks skipped despite matching the class
 * (with a reason — should be rare/none in practice).
 */
function runWrite(files, targetCls) {
  const rewrittenFiles = [];
  const skipped = [];
  let totalJoins = 0;
  let totalBlocksRewritten = 0;

  for (const fp of files) {
    let html;
    try {
      html = readFileSync(fp, "utf8");
    } catch {
      continue;
    }
    const blocks = extractDocumentBlocks(html);
    if (blocks.length === 0) continue;

    const edits = []; // { start, end, newRaw }
    let fileJoins = 0;

    for (const block of blocks) {
      const decoded = decodeEntities(stripTagsKeepText(block.raw));
      const result = analyzeDocument(decoded);
      if (result.cls !== targetCls) continue;

      const plan = buildRawJoinPlan(block.raw);
      if (plan.skipped) {
        skipped.push({ file: relative(ROOT, fp), reason: plan.reason });
        continue;
      }
      if (plan.joins === 0) continue; // classified as target but nothing joinable in practice — leave alone

      edits.push({ start: block.start, end: block.end, newRaw: plan.newRaw });
      fileJoins += plan.joins;
    }

    if (edits.length === 0) continue;

    // Splice back-to-front so earlier offsets stay valid as length changes.
    edits.sort((a, b) => b.start - a.start);
    let newHtml = html;
    for (const e of edits) {
      newHtml = newHtml.slice(0, e.start) + e.newRaw + newHtml.slice(e.end);
    }

    // File-level invariant: everything outside the edited blocks is
    // untouched by construction (we only spliced within [start,end)
    // ranges), and the whole file's whitespace-collapsed form must match.
    if (collapseWS(newHtml) !== collapseWS(html)) {
      skipped.push({ file: relative(ROOT, fp), reason: "file-level whitespace invariant failed — not written" });
      continue;
    }

    writeFileSync(fp, newHtml, "utf8");
    rewrittenFiles.push({ file: relative(ROOT, fp), joins: fileJoins, blocks: edits.length });
    totalJoins += fileJoins;
    totalBlocksRewritten += edits.length;
  }

  return { rewrittenFiles, skipped, totalJoins, totalBlocksRewritten };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--write") ? "write" : args.includes("--check") ? "check" : "dry-run";
  const verbose = args.includes("--verbose");
  const posArgs = args.filter((a) => !a.startsWith("--"));

  if (mode === "write") {
    const classFlagIdx = args.indexOf("--class");
    const classArg = classFlagIdx !== -1 ? args[classFlagIdx + 1] : null;
    // classArg, if present, is a positional-looking token consumed by
    // --class — strip it out of posArgs so it isn't mistaken for a root/file.
    const posArgsForWrite = posArgs.filter((a) => a !== classArg);
    const targetCls = classArg ? CLASS_MAP[classArg] : undefined;
    if (!classArg || !targetCls) {
      console.error(
        `--write requires --class <name>. Supported: ${Object.keys(CLASS_MAP).join(", ")}. Got: ${classArg ?? "(none)"}`
      );
      process.exit(1);
    }

    const explicitFiles = posArgsForWrite.filter((a) => a.endsWith(".html"));
    const root = posArgsForWrite.find((a) => !a.endsWith(".html")) || ROOT;
    const files = explicitFiles.length ? explicitFiles.map((f) => resolve(f)) : findServedDocFiles(root);

    console.log(`Writing: class "${classArg}" (${targetCls}) across ${files.length} file(s)...\n`);
    const { rewrittenFiles, skipped, totalJoins, totalBlocksRewritten } = runWrite(files, targetCls);

    for (const r of rewrittenFiles) {
      console.log(`  WROTE  ${r.file} — ${r.joins} boundary/boundaries joined across ${r.blocks} block(s)`);
    }
    if (skipped.length) {
      console.log("\nSkipped (left byte-identical) despite matching the class:");
      for (const s of skipped) console.log(`  SKIP   ${s.file} — ${s.reason}`);
    }
    console.log(
      `\n${rewrittenFiles.length} file(s) rewritten, ${totalBlocksRewritten} block(s), ${totalJoins} boundary/boundaries joined.` +
        (skipped.length ? ` ${skipped.length} block(s) skipped (see above).` : "")
    );
    return;
  }

  const explicitFiles = posArgs.filter((a) => a.endsWith(".html"));
  const root = posArgs.find((a) => !a.endsWith(".html")) || ROOT;

  const files = explicitFiles.length ? explicitFiles.map((f) => resolve(f)) : findServedDocFiles(root);

  const counts = {};
  const fileReports = [];
  let totalJoinable = 0;
  let totalBoundaries = 0;

  for (const fp of files) {
    let html;
    try {
      html = readFileSync(fp, "utf8");
    } catch {
      continue;
    }
    const blocksInFile = extractDocumentBlocks(html);
    if (blocksInFile.length === 0) {
      counts["no-document-div"] = (counts["no-document-div"] || 0) + 1;
      continue;
    }
    blocksInFile.forEach((block, idx) => {
      const decoded = decodeEntities(stripTagsKeepText(block.raw));
      const result = analyzeDocument(decoded);
      counts[result.cls] = (counts[result.cls] || 0) + 1;
      totalJoinable += result.joinableBoundaries;
      totalBoundaries += result.totalBoundaries;
      fileReports.push({
        file: relative(ROOT, fp),
        blockIndex: blocksInFile.length > 1 ? idx : null,
        ...result,
        decoded,
      });
    });
  }

  if (mode === "check") {
    console.log("Reflow check summary:");
    for (const [cls, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cls.padEnd(24)} ${n}`);
    }
    const hardWrapped = counts["hard-wrapped-prose"] || 0;
    const mixed = counts["mixed"] || 0;
    console.log(`\n${hardWrapped} document(s) classify as hard-wrapped-prose, ${mixed} as mixed.`);
    console.log("This is advisory only — not wired into `npm run check`.");
    process.exit(hardWrapped > 0 ? 1 : 0);
  }

  // --dry-run: full report
  console.log(`Scanned ${files.length} file(s), ${fileReports.length} served .document block(s).\n`);
  console.log("Classification counts:");
  for (const [cls, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cls.padEnd(24)} ${n}`);
  }
  console.log(
    `\nTotal line-boundaries inspected: ${totalBoundaries}; would join: ${totalJoinable}` +
      (totalBoundaries ? ` (${((100 * totalJoinable) / totalBoundaries).toFixed(1)}%)` : "")
  );

  console.log("\nPer-file report (files with at least one joinable boundary):");
  for (const r of fileReports) {
    if (r.joinableBoundaries === 0) continue;
    const tag = r.blockIndex === null ? "" : ` [block ${r.blockIndex}]`;
    console.log(
      `  ${r.file}${tag} — ${r.cls}, ${r.joinableBoundaries}/${r.totalBoundaries} boundaries would join (${(
        100 * r.joinableRatio
      ).toFixed(0)}%)`
    );
    if (verbose) {
      const before = r.decoded.trim().slice(0, 300).replace(/\n/g, "\\n");
      const after = applyJoins(r).trim().slice(0, 300).replace(/\n/g, "\\n");
      console.log(`      before: ${before}${r.decoded.length > 300 ? "…" : ""}`);
      console.log(`      after:  ${after}${applyJoins(r).length > 300 ? "…" : ""}`);
    }
  }

  console.log(
    "\nNo files were modified — this tool is diagnostic only. See PROPOSAL.md for the recommended fix."
  );
}

main();
