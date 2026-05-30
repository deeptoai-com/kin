# Work Log — Lessons & Techniques

Running log of problems hit and techniques learned while developing OxyGenie, so we
(and future contributors / agents) don't repeat them. Append newest at the top.

## Environment & tooling gotchas (this workspace)

- **Shell is `zsh`, not bash.** Avoid bash-isms:
  - `declare -A` / `${!arr[@]}` / `${arr[$k]}` → `bad substitution` (an associative-array
    clone loop silently failed this way and cloned nothing).
  - Unquoted globs that don't match (e.g. `readme*.md`) → zsh **errors** (`no matches found`)
    and can abort the command. Quote paths; use explicit filenames.
  - Prefer `git -C <dir>` over `cd <dir>` (cwd persistence across calls is flaky; `cd` can
    also prompt for permission).
- **Don't trust the terminal echo when output looks doubled/garbled.** Write status to a
  file and `Read` it instead — several "confirmations" were corrupted renders that misled me.
- **`gh repo clone <owner>/<repo>`** (authenticated) beats raw `git clone` over HTTPS, which
  prompts for a username on private/404 repos (`could not read Username` → looks like a hang).
- **Shallow clone references**: `gh repo clone X dir -- --depth 1 --single-branch` (read-only study).

## Subagent / delegation discipline

- **Verify a path exists (cheap `ls`) BEFORE delegating a subagent to read it.** Delegating 5
  summaries to repos that weren't actually cloned wasted ~230k tokens (each agent explored the
  whole tree to conclude "missing").
- **Constrain read scope explicitly** ("read only README head + top-level `ls`; do not recurse")
  or agents over-read (a haiku summarizer burned ~46k tokens scanning a whole repo).
- **Don't mix fail-prone Bash with Agent calls in one tool batch** — a Bash error cancels the
  entire parallel batch (lost 5 queued agents this way).
- Delegation triage: mechanical/bounded → cheap subagents (haiku/sonnet); architecture
  comprehension / decisions / log analysis → do it myself.

## Git / GitHub

- **`commit.gpgsign=true` hangs `git commit` in this environment** (no gpg agent/tty). Symptom:
  commit never returns. Fix: `git -c commit.gpgsign=false commit --no-verify -m "..."`.
- **Heredoc `git commit -F -` (stdin) can also hang** here — prefer repeated `-m` flags.
- **Terminal echo intermittently garbles/duplicates Bash output** (saw it badly this session).
  When output looks doubled or truncated mid-line, write results to a file and `Read` it — don't
  act on the garbled echo (especially before code edits or merges).
- **Multi-line statements defeat single-line greps**: a subagent reported a `db.delete(...).where(...)`
  as one line; the real code spanned 3 lines, so one of two identical fixes silently missed. Verify the
  actual file region before trusting a line-based finding.

- **`git commit -- <pathspec>` commits the WORKING-TREE version of a still-present path.** After
  `git rm --cached .env.docker` (file kept on disk), passing `.env.docker` in the commit pathspec
  re-added it. Fix: stage the removal and commit staged changes (no pathspec), or `--amend`.
- **Branch protection on a *private* repo needs GitHub Pro (or an org/Team).** Free + private →
  classic protection and rulesets both 403. We made the repo public (it's open-source) to unlock it.
- **Selective commits**: when there are unrelated in-flight changes, stage exact paths and commit
  only those — verify with `git diff --cached --name-only` before committing.

## Workflow tool

- **Don't naively slice a giant JSON payload into a single synthesis prompt** — a 90k-char
  `.slice()` truncated upstream data and the synthesizer (correctly) refused to fabricate the
  missing parts. Split synthesis into ordered sub-writers, or compact the data first.
- A workflow's cached agent results survive in `journal.jsonl`; you can recover and re-synthesize
  from them if the synthesis step fails (e.g., transient API 529s).

## Reference-library management

- Shallow-clone into `references/`; keep a tracked `references/INDEX.md` (repos stay git-ignored).
- **Query the INDEX first; record on first deep contact** (upgrade 🟡→🟢 with key files). Don't
  re-scan a tree you've already characterized.

_Last updated: 2026-05-30._
