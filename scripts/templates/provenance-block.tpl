<!--
  provenance-block.tpl — THE MUSEUM structured provenance block.

  The Janitor's gavel (2026-09-13): the source block on served documents must
  stop being "a massive, unstructured blob where random text is being
  smuggled in" and become fixed rows: collection, url source if possible,
  number of redactions, things like that. This file is the ONLY place the
  markup for those rows is written; fix-provenance-block.py (the standing
  fixer) and any future stamp-time renderer read this file, pick the row
  shapes a given document's museum/data/documents.json row calls for, fill
  in {{TOKENS}}, and concatenate. No row here ever carries hand-authored,
  per-document prose — that is the entire point of the gavel.

  Same styling class as the old free-form paragraph ("muted small
  provenance") so page CSS holds unchanged; data-doc-class carries the
  same value the old <p data-doc-class="..."> attribute did, so
  privacy-check.mjs's disclosure-zone match (which accepts the class with
  or without a data-doc-class attribute) keeps working untouched.
-->
<!-- OPEN -->
<dl class="muted small provenance" data-doc-class="{{DOC_CLASS}}">
</dl>
<!-- /OPEN -->

<!-- THE AUTHOR IS CREDITED (hook c237; CURATION v135, #author-credit): a served document of a single-author wing
     names its author, from the wing's own registry row (`author` in data/promotions.json), never from the page.
     The renderer escapes {{AUTHOR}} like every other value here. -->
<!-- ROW:written-by -->
  <dt>Written by</dt><dd>{{AUTHOR}}</dd>
<!-- /ROW:written-by -->

<!-- ROW:collection -->
  <dt>Collection</dt><dd><a href="/collections/{{LOT}}.html">Accession {{LOT}}</a></dd>
<!-- /ROW:collection -->

<!-- ROW:source-newsgroup -->
  <dt>Source</dt><dd><a href="{{URL}}">{{NEWSGROUP}}, message {{MSGID}}</a></dd>
<!-- /ROW:source-newsgroup -->

<!-- ROW:source-newsgroup-nourl -->
  <dt>Source</dt><dd>{{NEWSGROUP}}, message {{MSGID}}</dd>
<!-- /ROW:source-newsgroup-nourl -->

<!-- ROW:source-newsgroup-noid -->
  <dt>Source</dt><dd>{{NEWSGROUP}}</dd>
<!-- /ROW:source-newsgroup-noid -->

<!-- ROW:source-wayback -->
  <dt>Source</dt><dd><a href="{{URL}}">Wayback Machine capture, {{DATE_LONG}}</a></dd>
<!-- /ROW:source-wayback -->

<!-- ROW:source-wayback-nourl -->
  <dt>Source</dt><dd>Wayback Machine capture, {{DATE_LONG}}</dd>
<!-- /ROW:source-wayback-nourl -->

<!-- ROW:source-wayback-nodate -->
  <dt>Source</dt><dd><a href="{{URL}}">Wayback Machine capture</a></dd>
<!-- /ROW:source-wayback-nodate -->

<!-- ROW:source-wayback-bare -->
  <dt>Source</dt><dd>Wayback Machine capture</dd>
<!-- /ROW:source-wayback-bare -->

<!-- ROW:source-arquivo -->
  <dt>Source</dt><dd><a href="{{URL}}">Arquivo.pt capture, {{DATE_LONG}}</a></dd>
<!-- /ROW:source-arquivo -->

<!-- ROW:source-arquivo-bare -->
  <dt>Source</dt><dd>Arquivo.pt capture</dd>
<!-- /ROW:source-arquivo-bare -->

<!-- ROW:source-geocities-torrent -->
  <dt>Source</dt><dd>Archive Team GeoCities torrent, {{PATH}}</dd>
<!-- /ROW:source-geocities-torrent -->

<!-- ROW:source-geocities-torrent-bare -->
  <dt>Source</dt><dd>Archive Team GeoCities torrent</dd>
<!-- /ROW:source-geocities-torrent-bare -->

<!-- ROW:source-commoncrawl -->
  <dt>Source</dt><dd><a href="{{URL}}">Common Crawl capture, {{DATE_LONG}}</a></dd>
<!-- /ROW:source-commoncrawl -->

<!-- ROW:source-commoncrawl-bare -->
  <dt>Source</dt><dd>Common Crawl capture</dd>
<!-- /ROW:source-commoncrawl-bare -->

<!-- ROW:source-direct -->
  <dt>Source</dt><dd><a href="{{URL}}">Recovered directly</a></dd>
<!-- /ROW:source-direct -->

<!-- ROW:source-direct-bare -->
  <dt>Source</dt><dd>Recovered directly (no public URL on file)</dd>
<!-- /ROW:source-direct-bare -->

<!-- A POST ON A FORUM (GAVELS 2026-09-23, source kind `forum`; the PTC forum,
     accession 0160, is the first). The row says exactly what the document's own
     sources[] entry says — its url and its `identifier` ("PTC forum, <board
     title>, post <n>") — the same way the newsgroup row says the group and the
     message id. The identifier is a citation, never a handle: the forum
     converter never lets an account name into it, and the renderer escapes it
     like every other value here. -->
<!-- ROW:source-forum -->
  <dt>Source</dt><dd><a href="{{URL}}">{{IDENTIFIER}}</a></dd>
<!-- /ROW:source-forum -->

<!-- ROW:source-forum-nourl -->
  <dt>Source</dt><dd>{{IDENTIFIER}}</dd>
<!-- /ROW:source-forum-nourl -->

<!-- ROW:source-forum-nolabel -->
  <dt>Source</dt><dd><a href="{{URL}}">Forum post</a></dd>
<!-- /ROW:source-forum-nolabel -->

<!-- ROW:source-forum-bare -->
  <dt>Source</dt><dd>Forum post</dd>
<!-- /ROW:source-forum-bare -->

<!-- ROW:source-unknown -->
  <dt>Source</dt><dd><a href="{{URL}}">Source undetermined</a></dd>
<!-- /ROW:source-unknown -->

<!-- ROW:source-unknown-bare -->
  <dt>Source</dt><dd>Source undetermined</dd>
<!-- /ROW:source-unknown-bare -->

<!-- ROW:date-exact -->
  <dt>Document date</dt><dd>{{DATE_LONG}}</dd>
<!-- /ROW:date-exact -->

<!-- ROW:date-month -->
  <dt>Document date</dt><dd>{{DATE_LONG}}</dd>
<!-- /ROW:date-month -->

<!-- ROW:date-year -->
  <dt>Document date</dt><dd>{{DATE_LONG}}</dd>
<!-- /ROW:date-year -->

<!-- ROW:date-unknown -->
  <dt>Document date</dt><dd>undated</dd>
<!-- /ROW:date-unknown -->

<!-- ROW:parts -->
  <dt>Parts</dt><dd>part {{N}} of {{OF}}</dd>
<!-- /ROW:parts -->

<!-- ROW:parts-of-only -->
  <dt>Parts</dt><dd>1 of {{OF}} parts</dd>
<!-- /ROW:parts-of-only -->

<!-- ROW:redactions -->
  <dt>Redactions</dt><dd>carries {{COUNT}} redaction{{S}}</dd>
<!-- /ROW:redactions -->

<!-- hook c152 (2026-10-08): passages withheld under the Janitor's content standard (D206), counted from the page's
     own [withheld &mdash; markers, are declared in their own phrase, which the "N redactions" sum of the privacy checks
     never matches; "carries no redactions" renders only when the page carries neither kind of marker. -->
<!-- ROW:withheld -->
  <dt>Redactions</dt><dd>{{WCOUNT}} passage{{WS}} withheld, marked in place</dd>
<!-- /ROW:withheld -->

<!-- ROW:redactions-and-withheld -->
  <dt>Redactions</dt><dd>carries {{COUNT}} redaction{{S}}; {{WCOUNT}} passage{{WS}} withheld, marked in place</dd>
<!-- /ROW:redactions-and-withheld -->

<!-- ROW:redactions-none -->
  <dt>Redactions</dt><dd>carries no redactions</dd>
<!-- /ROW:redactions-none -->

<!-- ROW:served-since -->
  <dt>Served since</dt><dd>{{DATE_LONG}}</dd>
<!-- /ROW:served-since -->

<!-- ROW:language -->
  <dt>Language</dt><dd>{{LANGUAGE_NAME}}{{MT_SUFFIX}}</dd>
<!-- /ROW:language -->

<!-- THE HOLDER'S-OWN-SITE LINK-OUT (the Janitor, 2026-09-27; CURATION.md v124,
     #holders-site-links) — this card's own page on the living site the
     promotion's holder runs, from the SHOW record's own links_out[]. Not
     hand-authored prose and not a source: nothing on the far side is evidence
     for anything on this page, which is why the row sits below Source rather
     than inside it, says "Also at", and carries rel="noopener nofollow". The
     {{LINKS}} token is filled with anchors already escaped by the renderer. -->
<!-- ROW:also-at -->
  <dt>Also at</dt><dd>{{LINKS}}</dd>
<!-- /ROW:also-at -->

<!-- CLOSE -->
</dl>
<!-- /CLOSE -->
