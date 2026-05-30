# Human Review Checklist — for when you return (~2 weeks)

Everything I could NOT do autonomously, or that needs your decision / verification /
external resource. Grouped by urgency. (Living — I append as I hit blockers.)

## 🔴 Blocks live functionality — please action
- [ ] **Renew the GLM Coding Plan** (key in `.env`; endpoint `open.bigmodel.cn/api/anthropic`,
  model `glm-5.1`). It returned `1309 套餐已到期`, so **no live agent run has been tested
  end-to-end**. Wiring is correct; should work on renewal. → then re-run an actual chat.
- [ ] **Rotate the shared LLM key** if it was ever exposed: `ANTHROPIC/OPENAI/ZHIPU` all used one
  proxy value. (No git leak found, but it's reused widely.)

## 🟠 Decisions only you can make (I implemented sane defaults / left flagged)
- [ ] **Billing/metering model** (Workstream D2): what one run costs, free tier, per-token vs per-run.
  I wired `spendOneCredit`/usage plumbing with a placeholder policy — confirm or change.
- [ ] **Data retention & audit scope** (D3): what to log, how long, compliance constraints.
- [ ] **Sandbox scale backend** (A5): Modal vs Daytona vs E2B vs self-hosted Docker/K8s. Needs an
  account + budget for the 100→1000 bake-off. I implemented local + container backends only.
- [ ] **Design checkpoint for the execution-layer re-platform** (A5): review the proposed typed
  `ExecutionRuntime` + per-session sandbox pool + queue/worker model BEFORE I build it (1-way door).

## 🟡 Implemented but NOT verified by me (please verify / run)
- [ ] **Deploy fix (Risk #8)** — I corrected the compose/ports so the WS server boots, but I have no
  Dokploy access and did not deploy. Verify a real deploy serves web + a working `/ws/agent`.
- [ ] **`security_opt: [seccomp=unconfined]` on the `app` service** — required for the srt sandbox in
  containers. Confirm your prod/Dokploy runtime allows it (or set the equivalent).
- [ ] **DB migrations** (D1/D3 add tables) — I tested against a local Postgres only; review + run
  against staging/prod with care.
- [ ] **srt sandbox on your prod Linux host** — verified on OrbStack (Debian/arm64, seccomp=unconfined).
  Confirm bubblewrap user-namespaces work on the prod host kernel (Ubuntu 24 may restrict userns).

## 🟢 Review the merged PRs (I self-merged after CI; your eyes still valuable)
- [ ] PR #3 — srt Python sandbox + secret env-strip (security-critical; see verified test output).
- [ ] _other merged PRs listed in `SPRINT-2026-06.md` → PR ledger_

## ℹ️ Notes
- `oxy-srt-sandbox` container is left running in OrbStack as the sandbox verification harness.
- The 5.78GB full `oxygenie:latest` app image build was NOT exercised end-to-end (GLM-blocked); I
  used lightweight containers + local Postgres for verification instead.
- Skipped (out of scope without you): anything needing external accounts, real load testing, prod deploy.
