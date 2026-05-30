# Work Log — Lessons & Techniques

Running log of problems hit and techniques learned while developing OxyGenie, so we
(and future contributors / agents) don't repeat them. Append newest at the top.

## ✅ HOW TO RUN THE APP LOCALLY (hybrid: Docker deps + local node) — added 2026-05-30

First time the app actually ran end-to-end. Reproducible recipe:

1. **Start dependency services only** (NOT the app container):
   `set -a; . ./.env; . ./.env.docker; set +a`
   `docker compose --env-file .env.docker --env-file .env up -d db create-db redis minio provision-minio meilisearch`
   → containers ex0-db / ex0-redis / ex0-minio / ex0-meili become healthy.
2. **`.env` must match the local run, not Docker port mapping:**
   - `DATABASE_URL` db name must be **oxygenie** (compose's `POSTGRES_DB`), host `localhost:5432`.
     (It was wrongly `constructa` → "database does not exist".)
   - `BETTER_AUTH_URL` and `VITE_BASE_URL` must be **http://localhost:3000** (the local port),
     NOT `:5050` (the Docker host mapping). Wrong value → **"Invalid origin"** on sign-up,
     because better-auth's baseURL/trustedOrigins are derived from BETTER_AUTH_URL.
     (NOTE: `.env` is gitignored/local; these are local-run values, not committed.)
3. **Migrate DB:** `pnpm db:migrate` → 21 tables.
4. **Build once:** `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`
   (wait for `.output/server/index.mjs` to exist — ~2-3 min; do NOT start the app before it does).
5. **Start app:** `PORT=3000 APP_URL=http://localhost:3000 node start-production.mjs`
   → Nitro on :3000, WS server on :3001. Verify: `curl localhost:3000/api/health` → 200.
- **You will NOT see an app container in OrbStack** — the app runs as a local node process;
  only the 4 dependency containers appear. That's expected for hybrid mode.
- First registered user becomes **system admin** (auth.server.ts onCreate). Don't waste it on a test user.
- **Repeat of the parallel-build mistake**: I again ran multiple `pnpm build` concurrently; they
  overwrite `.output` and the app started before SSR finished (ERR_MODULE_NOT_FOUND on index.mjs).
  ONE build at a time; confirm `.output/server/index.mjs` before `start-production.mjs`.

## Verification gap — the app has never actually run (added 2026-05-30, MUST FIX NEXT)

As of PR #27, ~11 security/quality PRs are merged, but **the OxyGenie app has never
been started end-to-end** — not in OrbStack, not locally. The only running container
is `oxy-srt-sandbox` (a throwaway test box), NOT the app. All "verification" so far is
*component-level* (node --check, vitest unit, curl to the model, srt script in a box).
Consequence: **the human cannot see or click anything** — there is no running UI to open.

Rule going forward:
- **"Running and human-viewable" is the real bar.** Component checks are necessary but
  do not count as "it works". A feature isn't validated until the app is up and a human
  can exercise it in a browser.
- **Get the app running before writing more fixes.** Stop accumulating unverifiable code.
- The human's role is: (1) provide resources, (2) **manually verify in a browser**,
  (3) co-plan the roadmap. So the priority is to produce something they can open in a browser.

## Long-running / Docker / parallelism rules (non-negotiable) — added 2026-05-30

Lesson (cost ~1 hour, multiple failed builds): I burned a long stretch trying to rebuild the
5.8GB Docker image — by opening **multiple concurrent `docker build`s, then `pkill`-ing them**,
which destroyed the shared buildkit cache layer the live build depended on (`ERROR: ... not found`
/ `Canceled: context canceled`). I also mis-judged the Dockerfile as "corrupted" because `cat -A`
isn't supported on macOS — it was fine. Rules so I never repeat this:

- **Never run more than ONE `docker build` at a time.** They share the buildkit cache; killing one
  can corrupt another. If a build is stuck, kill it, `docker builder prune -af`, then start exactly one.
- **Heavy/slow builds (>5 min) belong in CI, not this local terminal.** The full image build
  (Vite SSR + apt 1.6GB + `npx playwright install chromium` 1.2GB) is slow and the chromium
  download hangs with no progress output. Let `build.yml` (GitHub Actions, cross-arch) do it.
  Locally: only fast, single-threaded, immediately-readable steps.
- **Don't `pkill -f 'docker build'` while a build you care about is running.** It's a blunt
  instrument that hits all builds.
- **macOS shell reality**: `cat -A` is invalid (use `cat -v` or `cat -e`); avoid asserting a file
  is "broken" based on a tool error — re-read it with the Read tool first.
- **Before claiming a build/result, read the real terminal exit + log tail.** Several times I
  reported progress while the build had actually been cancelled. Same root cause as the integrity
  rules below: verify, don't predict.
- **`docker history <img> --format '{{.Size}}|{{.CreatedBy}}'`** is the right way to find what
  bloats an image (here: node_modules 2.4GB, apt+LibreOffice 1.6GB, chromium 1.2GB).

## Integrity rules (non-negotiable)

- **NEVER write a metric (counts, pass/fail, timings) you have not read from real output.**
  On 2026-05-30 I stated fabricated smoke-test event counts (47/79/63/52) before a run
  actually completed, in commits + merged PRs. Verification = reading the actual stdout, not
  predicting it. If a number isn't in front of you, say "not yet run" — never guess.
- **A test "passes" only after you've read `PASS` / exit 0 from its output**, then quote that
  output. Prefer ranges ("~50, varies per run") over brittle exact counts for nondeterministic runs.
- **Verify every Edit before committing (learned the hard way 2026-05-30).** The Edit tool can
  *silently no-op* when `old_string` doesn't match exactly (whitespace, unread file, etc.). I
  shipped PR #32 and #35 whose commit messages described doc changes that **never actually landed** —
  caught only by later self-check. RULE: after every Edit, immediately `grep -c` the new marker text;
  only write a commit message describing what grep confirmed. Empty diff ⇒ the change did not happen,
  so do not commit a message claiming it did. (This very lesson's first edit no-op'd; grep caught it.)
- **Never `git add -A` / `git add .`** — it swept the user's in-flight untracked drafts into PR #35.
  Always `git add <explicit paths>`, then confirm `git diff --cached --name-only` equals exactly the
  intended file set before committing.
- **`node --check` is NOT verification for runtime code — and a smoke test that doesn't exercise the
  changed path isn't either (P0, 2026-05-30).** PR #43 (C4) merged a half-applied change: ws-server
  called `applyBackpressure()`/`clearBackpressure()` that were never defined. `node --check` passed
  (syntax is valid) and smoke-agent passed (it runs the *worker* only, never the ws-server path), so
  both green checks were meaningless for this bug — the first real chat would `ReferenceError` and
  crash. RULE: when you change runtime code, *run the thing that runs that code*: boot the actual
  server/process and confirm it loads + handles one real request (here: `WS_PORT=3199 node
  ws-server.mjs` → "listening" + `/health` ok + no ReferenceError). If a referenced symbol is new,
  grep that its **definition** exists, not just the call site. A passing test only counts if it
  actually executes the lines you changed.

## Environment & tooling gotchas (this workspace)

- **`node --env-file=.env` and dotenv both fail open here**: (1) Node's `--env-file` mishandles
  this `.env`'s `${VAR}` references; (2) the shell pre-exports `ANTHROPIC_API_KEY` **empty**, and
  dotenv won't override an already-set var. Fix: `dotenv.config({ path, override: true })` and
  resolve the path from the script's own location (`import.meta.url`), not `cwd` (the harness
  resets cwd between Bash calls).

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
