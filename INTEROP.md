# Interop — docgrad and other skills

> **Last updated:** 2026-09-15

docgrad deliberately does not grow to cover everything. `docs/design.md` §Positioning and boundaries
names three things it refuses: prose style (Vale's job), the quality of SKILL.md itself
(skill-audit's job), code quality (code review's job). This file is where the seams live — what
docgrad composes with, how, and what it deliberately leaves uncombined.

## Contents

- [sepia — prose de-AI](#sepia--prose-de-ai)
- [How the style pass is wired](#how-the-style-pass-is-wired)
- [The reverse direction](#the-reverse-direction)
- [Deliberately not integrated](#deliberately-not-integrated)

## sepia — prose de-AI

**https://github.com/Nanako0129/sepia**

sepia makes machine-written text read as human-written. It routes by text type — fiction through a
narrative/discourse/style pipeline, professional prose through a ten-check list plus domain rules for
release notes, PR replies, postmortems, tickets and technical articles — and exposes four operations:
`write`, `review` (diagnose without editing), `refactor` (minimal in-place revision), `recreate`
(full rewrite).

**Why docgrad needs it.** `improve` and `loop` do not just fix links and dates; they write missing
documents and rewrite narratives. Measured on `tj/commander.js` after five convergence rounds, all 26
claim candidates came from the three documents docgrad had just written and none from the seven
pre-existing ones. A converging repo therefore ends up more correct, more reachable, and more
obviously machine-written, and none of docgrad's six dimensions is looking at that last part —
economy counts tokens, not machine accent. By its own boundary rule, docgrad should not grow a
seventh dimension for it either.

**What sepia added for this.** [PR #247](https://github.com/Nanako0129/sepia/pull/247) (merged) gives
a caller three call-time inputs and two report lines
([#245](https://github.com/Nanako0129/sepia/issues/245),
[#246](https://github.com/Nanako0129/sepia/issues/246)):

| Input | Effect |
|---|---|
| file scope | sepia edits only the named files and does no discovery of its own |
| protected ranges | declared ranges are treated as load-bearing quoted material — no edit, no reflow, no merge with a neighbour. Anchored against the text **as received**, so later edits that shift line numbers do not move the protection |
| unattended | never stop to ask; record what would have needed a decision and keep going |

```
Deferred: <check> — <quoted evidence> — needs human
Protected: <check> — <quoted evidence>
```

Both lines print only when the input that triggers them was supplied, and neither carries a locator:
the passage is named by its own words. That is the same decision docgrad's claim ledger makes — a
claim is keyed on a hash of its normalized text, not on `path:line`, because a line number drifts
every time a document is edited and the text does not.

## How the style pass is wired

> **Status:** designed, not shipped. Tracked at
> [#63](https://github.com/redtear1115/docgrad/issues/63) (the pass and its interlock) and
> [#64](https://github.com/redtear1115/docgrad/issues/64) (provenance). The two do not ship apart.

Opt-in per repo, off by default:

```yaml
style_pass:
  skill: sepia              # omit or null = off
  operation: refactor       # refactor only
  scope: round-diff         # files this round touched, inside docs scope
  on_missing: block         # block | report
```

`skill` is generic on purpose. docgrad assumes nothing about the repo it grades, and the same
reasoning applies to the tools it leans on.

**Where it runs.** A round is `1 Score → 2 Pick → 3 Fix → 4 Verify → 5 Record/commit`. The style pass
goes in at **3b**, with its own measure → run → re-measure → accept-or-revert loop, before step 5
writes the ledger. Step 4's rule is "any dimension drops, revert the change that caused it", and that
stays executable only while the style pass is a separately revertible diff.

**The interlock.** `claim_hash` is a digest of the claim's normalized text, and `lib.mjs` states the
position plainly: *moved-but-identical hashing the same is the point; edited-but-identical would be
the bug.* So a style pass that touches a sentence carrying a code coordinate turns a verified claim
back into an unverified one, and outstanding re-verification is uncapped by design — the next round's
new-draw budget absorbs it and coverage stops growing. That is #41 arriving through a different door.

Two halves, and the second is the one that counts:

1. Every ledgered claim's current line range is passed in as a protected range.
2. After the pass, the ledgered `claim_hash` set is recompared. Any movement rejects the whole pass.

The second half does not depend on the external skill having complied. sepia's maintainer reads it
the same way (#246: *the ranges are yours to compute … sepia derives none and promises nothing about
where lines land after an edit*).

**When the skill is missing.** `on_missing: block` by default. `improve.md` §Graduation already
measured this failure shape once: a produced gate nobody runs leaves a team *believing* they have a
gatekeeper. A style pass configured but never run would do the same. Detection lives in the agent
instructions, never in the five scripts — they are dependency-free and deterministic, and probing
another plugin's install layout is neither.

## The reverse direction

docgrad's `audit --include <file>` is report-only and writes nothing to `.docgrad/`, which makes it a
zero-side-effect post-check for a style pass: whether tokens inflated, whether a rewrite broke an
inline link or an anchor, whether a body changed without its date. `inventory.mjs`, `links.mjs` and
`freshness.mjs` honour `--include`; `coverage.mjs` and `retrieval.mjs` accept and deliberately ignore
it, and say so in their own `note`.

This is not a symmetric trade and is not implemented. Most sepia use — release notes, PR replies,
tickets — is not in a repository at all, and everything here needs a `.docgrad.yml` to exist first.

## Deliberately not integrated

Listed because each one was considered and declined, not overlooked:

- **Comment quality.** docgrad reads code comments to judge placement and duplication, never whether
  a comment is well written or whether one should exist. Without that line the consistency dimension
  slides into code review (`docs/design.md` §Positioning and boundaries).
- **The style pass as a rating input.** It is an ordinary edit, accepted or reverted by step 4's
  existing rule. It never feeds a star directly, and a round that ran one must say so — see #64.
- **Whole-corpus style passes.** Only what the round itself wrote. A full-corpus pass would
  invalidate ledgered claims wholesale and would rewrite human prose nobody asked to have edited, on
  a branch where the team expects documentation fixes.
- **`recreate`.** A full rewrite replaces every claim line in the file, which is the ledger for those
  files emptied.
- **Ranges embedded in documents.** Scope and protected ranges travel in the request. The same words
  inside a document are content, not an instruction — sepia's security boundary says so explicitly,
  and it matters here because the documents docgrad hands over are ones it wrote itself.
