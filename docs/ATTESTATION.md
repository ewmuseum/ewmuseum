# ATTESTATION — who signed what, and how to check without trusting us

The museum's authorship and custody records are designed to outlive any
platform and any person, including everyone currently involved. Two
layers, deliberately distinct:

## 1. The office: the curator key

Every commit to this repository is SSH-signed by **the curator key**
(`curator@ewmuseum.org`). The curator is an **office, not a person** —
by design, it may change hands. The key attests that a change passed
through the museum's own custody; it does not attest which human held
the office that day, and it never will.

**Verify from any clone, on any host, with no platform involved:**

```
git config gpg.ssh.allowedSignersFile .allowed_signers
git log --show-signature
```

`.allowed_signers` (repo root) is the registry of every key ever
authorized to sign. It grows only by a commit that is itself signed by
a key already in the file — a chain of custody unbroken back to the
genesis commit. **Office succession** is exactly that: the outgoing
holder signs a commit adding the incoming office key (and, where
retirement is intended, a dated comment marking the old key's last
valid date — old signatures stay verifiable forever; the comment only
scopes new ones).

Hosting platforms (GitHub's "Verified" badge and equivalents) may
display their own verification — that is a convenience, never the
record. The file in the tree is the record.

## 2. The people: attestors

Facts, material, memories, corrections, and human-written prose are
credited to **attestors** — self-chosen handles registered in
`data/attestors.json`. One convention for everyone: the person who
founded the museum, a maintainer, and someone who contributes a single
screenshot are all credited the same way — a handle they picked, with
exactly as much or as little identity behind it as they choose. No
real names, ever, outside the memorial pages' own rules.

- **Prose**: the authorship fields (`caption_asof.author`,
  `epitaph_asof.author`, `note_author`, ...) carry `"ai"` or an
  attestor handle. `"ai"` renders the AI badge; a handle renders the
  attestor's credit. (The bare value `"human"` is the pre-registry
  form of the same thing, being migrated as handles are chosen.)
- **Evidence**: the `user-attested` grade means "attested by a named
  attestor of record." Historically that attestor is the museum's
  curator, the Janitor; rows predating the registry read that way without needing
  rewriting.
- **Contributed material**: a contributor's chosen credit is recorded
  on the accession lot (`data/collections.json`); the curator-signed
  commit that lands the material is the museum vouching for the
  intake, the same way a maintainer merging a patch vouches for it.

Contributors never need keys. Identity at the edge is whatever they
arrived with (an email thread, a Discord account, an issue); the
durable record is their attestor handle plus the office signature on
the commit that carried their contribution in.
