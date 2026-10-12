#!/usr/bin/env python3
"""robots_ewbot — the one robots.txt evaluator for the museum's crawler identity EWMuseumBot.

Born 2026-10-08 (lane CRAWLER-IDENTITY; the Janitor: our crawler page promises we obey the '*' group AND our own name).
Until now each tool asked urllib.robotparser about the archive-identity token or about '*' alone, so a site that wrote
`User-agent: EWMuseumBot / Disallow: /` was never heard. This module is the shared fix; every tool that evaluates a
robots.txt imports it instead of urllib.robotparser.

The rules (RFC 9309, the robots standard):
  * a group is one or more User-agent lines followed by rules; groups naming the same agent are MERGED;
  * the group that applies to us is the one whose agent token equals our product token ("EWMuseumBot", case-insensitive,
    exact — not a substring); if there is none, the '*' group; if there is neither, everything is allowed;
  * within the chosen group the MOST SPECIFIC (longest) matching Allow/Disallow path wins; on a tie, Allow wins;
    '*' matches any run of characters and a trailing '$' anchors the end of the path;
  * an empty Disallow allows everything; an empty Allow is ignored;
  * Crawl-delay is read from the chosen group only.
A group that names another bot (GPTBot, CCBot, ...) says nothing about us.

    from robots_ewbot import Robots
    rp = Robots(); rp.parse(text.splitlines())
    rp.can_fetch(url)        # True/False
    rp.crawl_delay()         # seconds or None
    rp.allow_all = True      # a 404 / non-robots answer: no rules (same attribute the old callers set)
"""
import re
import urllib.error
import urllib.parse
import urllib.request

TOKEN = "EWMuseumBot"
UA = "EWMuseumBot/1.0 (+https://crawler.ewmuseum.org/)"


class Robots:
    def __init__(self, token=TOKEN):
        self.token = token.lower()
        self.groups = {}          # agent (lowercase) -> {"rules": [(allow:bool, path)], "delay": float|None}
        self.allow_all = False
        self.disallow_all = False

    def parse(self, lines):
        agents, in_rules = [], False
        for raw in lines:
            line = raw.split("#", 1)[0].strip()
            if not line or ":" not in line:
                continue
            field, _, value = line.partition(":")
            field, value = field.strip().lower(), value.strip()
            if field == "user-agent":
                if in_rules:                      # a User-agent line after rules opens a new group
                    agents, in_rules = [], False
                a = value.lower()
                agents.append(a)
                self.groups.setdefault(a, {"rules": [], "delay": None})
            elif field in ("allow", "disallow"):
                in_rules = True
                for a in agents:
                    if value == "" and field == "allow":
                        continue
                    self.groups[a]["rules"].append((field == "allow", value))
            elif field == "crawl-delay":
                in_rules = True
                try:
                    d = float(value)
                except ValueError:
                    continue
                for a in agents:
                    self.groups[a]["delay"] = d
            else:
                pass                              # sitemap and unknown fields do not open or close a group

    def read(self, url, ua=UA, timeout=20):
        """Fetch + parse a robots.txt with OUR User-Agent (urllib.robotparser.read() sends Python-urllib's). 401/403 = disallow
        all and 5xx = disallow all (as robotparser and RFC 9309 treat an unreachable file); other 4xx = no rules. A network
        error propagates to the caller (who decides; the old callers treated it as 'no robots info')."""
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                self.parse(r.read().decode("utf-8", "replace").splitlines())
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) or e.code >= 500:
                self.disallow_all = True
            else:
                self.allow_all = True

    def _group(self):
        return self.groups.get(self.token) or self.groups.get("*")

    @staticmethod
    def _matches(pattern, path):
        """RFC 9309 path match: prefix match with '*' wildcards and a trailing '$' end anchor."""
        end = pattern.endswith("$")
        if end:
            pattern = pattern[:-1]
        rx = ".*".join(re.escape(part) for part in pattern.split("*")) + ("$" if end else "")
        return re.match(rx, path, re.S) is not None

    def can_fetch(self, url):
        if self.allow_all:
            return True
        if self.disallow_all:
            return False
        g = self._group()
        if not g:
            return True
        sp = urllib.parse.urlsplit(url)
        path = urllib.parse.unquote(sp.path or "/") + (("?" + sp.query) if sp.query else "")
        best_len, best_allow = -1, True
        for allow, pat in g["rules"]:
            pat = urllib.parse.unquote(pat)
            if pat == "":
                continue                          # empty Disallow: nothing disallowed
            if self._matches(pat, path):
                n = len(pat.rstrip("$"))
                if n > best_len or (n == best_len and allow):
                    best_len, best_allow = n, allow
        return best_allow

    def crawl_delay(self):
        g = self._group()
        return g["delay"] if g else None

    def which_group(self):
        """'EWMuseumBot', '*' or None — which group speaks for us (for logs and tests)."""
        if self.token in self.groups:
            return self.token
        return "*" if "*" in self.groups else None
