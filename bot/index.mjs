#!/usr/bin/env node
/**
 * THE E-WRESTLING MUSEUM — the community bot.
 *
 * The Discord layer's one moving part (phase-3 design, Janitor-gaveled):
 * a single forum channel, one thread per held promotion keyed to the
 * registry, registry lookups anyone can run, and a consented intake
 * pointer — never an archive of its own. The museum's registry is the
 * only source of truth: this bot runs beside a checkout of the museum
 * repository and reads data/*.json straight off disk; refreshing it is
 * `git pull`, the same way the site itself deploys.
 *
 * It deliberately requires NO privileged intents: slash commands and
 * thread management only. It never reads member messages; community
 * material enters the museum through the consented intake path
 * (CONTRIBUTING.md), not through scraping its own server — the door
 * policy, applied to ourselves.
 *
 * Config (environment):
 *   DISCORD_TOKEN      the bot token (Developer Portal -> Bot)
 *   GUILD_ID           the server id
 *   FORUM_CHANNEL_ID   the single forum channel's id
 *   MUSEUM_ROOT        path to the museum checkout (default: parent dir)
 *
 * Run: node bot/index.mjs   (deps: `npm install` inside bot/)
 */
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } from "discord.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MUSEUM_ROOT ? resolve(process.env.MUSEUM_ROOT) : resolve(HERE, "..");
const SITE = "https://ewmuseum.org";
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID;
if (!TOKEN || !GUILD_ID) {
  console.error("bot: DISCORD_TOKEN and GUILD_ID are required (see the header comment).");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Registry, read cold at startup and on demand — the bot holds no state the
// repo doesn't. THREADS_FILE is the one exception: the promotion->thread
// mapping it created itself (bot/threads.json, gitignored).
// ---------------------------------------------------------------------------
function loadArray(name) {
  const p = resolve(ROOT, "data", `${name}.json`);
  if (!existsSync(p)) return [];
  const raw = JSON.parse(readFileSync(p, "utf8"));
  if (Array.isArray(raw)) return raw;
  const key = Object.keys(raw).find((k) => k[0] !== "_" && Array.isArray(raw[k]));
  return key ? raw[key] : [];
}
let registry = {};
function refreshRegistry() {
  registry = {
    promotions: loadArray("promotions"),
    characters: loadArray("characters"),
    units: loadArray("units"),
    titles: loadArray("titles"),
  };
  console.log(`bot: registry loaded — ${registry.promotions.length} promotions, ${registry.characters.length} characters, ${registry.units.length} units, ${registry.titles.length} titles.`);
}
refreshRegistry();

const THREADS_FILE = resolve(HERE, "threads.json");
const threadMap = existsSync(THREADS_FILE) ? JSON.parse(readFileSync(THREADS_FILE, "utf8")) : {};

function nameMatches(entity, q) {
  const needle = q.toLowerCase();
  if ((entity.name || "").toLowerCase().includes(needle)) return true;
  if ((entity.full_name || "").toLowerCase().includes(needle)) return true;
  for (const a of entity.aka ?? []) if (String(a).toLowerCase().includes(needle)) return true;
  return (entity.id || "").includes(needle.replace(/\s+/g, "-"));
}
function findAll(q, limit = 6) {
  const out = [];
  for (const [kind, list, page] of [
    ["promotion", registry.promotions, (e) => e.page],
    ["character", registry.characters, (e) => `/characters/${e.id}.html`],
    ["unit", registry.units, (e) => `/characters/${e.id}.html`],
    ["title", registry.titles, (e) => e.page],
  ]) {
    for (const e of list) {
      if (nameMatches(e, q)) out.push({ kind, e, url: SITE + page(e) });
      if (out.length >= limit * 4) break;
    }
  }
  // exact-name matches first, then shortest name (closest match heuristic)
  out.sort((a, b) => {
    const ax = (a.e.name || "").toLowerCase() === q.toLowerCase() ? 0 : 1;
    const bx = (b.e.name || "").toLowerCase() === q.toLowerCase() ? 0 : 1;
    return ax - bx || (a.e.name || "").length - (b.e.name || "").length;
  });
  return out.slice(0, limit);
}
function capsule(hit) {
  const { kind, e, url } = hit;
  const label = kind === "promotion" ? (e.full_name ? `${e.name} — ${e.full_name}` : e.name) : e.name;
  const line = e.caption ? `\n> ${e.caption}` : "";
  return `**${label}** *(${kind})*${line}\n<${url}>`;
}

// ---------------------------------------------------------------------------
// Commands — lookups for everyone, thread bootstrap for admins, and the
// intake pointer. No message reading anywhere.
// ---------------------------------------------------------------------------
const commands = [
  new SlashCommandBuilder().setName("find")
    .setDescription("Look anything up in the museum's registry")
    .addStringOption((o) => o.setName("query").setDescription("a name — character, promotion, unit, or title").setRequired(true)),
  new SlashCommandBuilder().setName("promotion")
    .setDescription("A promotion's own placard and links")
    .addStringOption((o) => o.setName("name").setDescription("acronym, name, or id").setRequired(true)),
  new SlashCommandBuilder().setName("contribute")
    .setDescription("How to bring material or memories into the museum"),
  new SlashCommandBuilder().setName("bootstrap-threads")
    .setDescription("(admin) Create one forum thread per held promotion")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),
].map((c) => c.toJSON());

const CONTRIBUTE_TEXT = [
  "**Bringing something to the museum** — material, memory, or correction:",
  "• If you played, ran, or archived an e-fed: the museum wants it, on your terms. What gets shown, what stays sealed, and how you're credited are all your call — a handle, a role description, or nothing at all.",
  "• You don't need to organize anything. Old drives, saved shows, screenshots, half-remembered fed names with rough years — all of it counts.",
  `• The door: <${SITE}/> → the repository's CONTRIBUTING.md, or just say so in this server's own threads and a curator will follow up.`,
  "• Anything you post here stays here unless you explicitly hand it to the museum — the archive never scrapes its own community. And anyone with a stake in held material can have it removed or de-identified, no questions: the Takedown & Privacy Policy is honored without argument.",
].join("\n");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;
  try {
    if (i.commandName === "find") {
      const q = i.options.getString("query", true);
      const hits = findAll(q);
      await i.reply(hits.length ? hits.map(capsule).join("\n\n") : `Nothing in the registry matches **${q}** — which itself is worth knowing: if it existed, the frontier wants it. \`/contribute\``);
    } else if (i.commandName === "promotion") {
      const q = i.options.getString("name", true);
      const hits = findAll(q).filter((h) => h.kind === "promotion");
      await i.reply(hits.length ? capsule(hits[0]) : `No held promotion matches **${q}**. The frontier ledger may still know it: <${SITE}/frontier.html>`);
    } else if (i.commandName === "contribute") {
      await i.reply({ content: CONTRIBUTE_TEXT });
    } else if (i.commandName === "bootstrap-threads") {
      if (!FORUM_CHANNEL_ID) { await i.reply({ content: "FORUM_CHANNEL_ID isn't configured.", ephemeral: true }); return; }
      await i.deferReply({ ephemeral: true });
      const forum = await client.channels.fetch(FORUM_CHANNEL_ID);
      if (!forum || forum.type !== ChannelType.GuildForum) { await i.editReply("FORUM_CHANNEL_ID is not a forum channel."); return; }
      let made = 0, kept = 0;
      for (const p of registry.promotions) {
        if (threadMap[p.id]) { kept++; continue; }
        const title = p.full_name ? `${p.name} — ${p.full_name}` : p.name;
        const thread = await forum.threads.create({
          name: title.slice(0, 100),
          message: { content: `${p.caption ? `> ${p.caption}\n` : ""}<${SITE}${p.page}>\n\nThis thread is for memories of ${p.name} — stories, names, corrections, material. Nothing posted here enters the museum unless you hand it over: \`/contribute\`` },
        });
        threadMap[p.id] = thread.id;
        made++;
      }
      writeFileSync(THREADS_FILE, JSON.stringify(threadMap, null, 2));
      await i.editReply(`Threads: ${made} created, ${kept} already existed. Mapping saved to bot/threads.json.`);
    }
  } catch (err) {
    console.error("bot: interaction failed —", err);
    if (i.deferred || i.replied) await i.editReply("Something broke — the curator's logs have it.").catch(() => {});
    else await i.reply({ content: "Something broke — the curator's logs have it.", ephemeral: true }).catch(() => {});
  }
});

client.once("ready", async () => {
  const rest = new REST().setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log(`bot: ready as ${client.user.tag}; ${commands.length} commands registered to guild ${GUILD_ID}.`);
});

client.login(TOKEN);
