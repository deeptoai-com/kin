# S5 — Capacity load-test harness

Local tooling to drive concurrent `/ws/agent` sessions, measure latency + memory,
and (on a real host) calibrate the single-host concurrency knobs.

> ⚠️ **Local numbers are NOT a calibration baseline.** A dev Mac (ARM64) is not a
> 16 GB / 8-core AMD64 VPS. Locally this harness only proves the tooling works
> and the protocol is driven correctly. Real default-value calibration must run on
> a representative host with the full stack (see `docs/project/research/2026-05-s5-capacity-loadtest-design.md`).

> ⚠️ **Real LLM cost.** This harness talks to the real model (per the S5 decision —
> no mock). Keep `USERS` small and `PROMPT` short locally to limit token spend and
> avoid provider rate limits.

## Files
- `auth-setup.mjs` — provisions throwaway users via the real Better Auth sign-up
  endpoint and harvests session cookies (no runtime auth code touched).
- `metrics.mjs` — samples ws-server main + worker RSS via `ps`; latency percentiles.
- `load-client.mjs` — orchestrator: N virtual users, drives create_session → chat →
  await done → think-time; emits a summary + CSVs to `loadtest-results/` (gitignored).

## Prerequisites
1. The app + ws-server running locally with the full stack (DB etc.), e.g. `./scripts/dev-up.sh`.
   - App (auth) on `:3000`, WS on `:3001` by default (adjust `APP_URL` / `WS_URL` otherwise).
2. **Email verification OFF**: `ENABLE_EMAIL_VERIFICATION` unset or `false`, so sign-up
   returns an active session cookie.
3. A working model config in `.env` (real Ark).

## Run (small, cheap smoke)
```bash
LOADTEST=1 \
APP_URL=http://localhost:3000 \
WS_URL=ws://localhost:3001/ws/agent \
USERS=3 DURATION_MS=60000 THINK_MS=2000 PROMPT="say hi in 3 words" \
node scripts/loadtest/load-client.mjs
```

### Knobs (env)
| Var | Default | Meaning |
|---|---|---|
| `USERS` | 3 | concurrent virtual users (= ws connections) |
| `DURATION_MS` | 60000 | total run length |
| `THINK_MS` | 2000 | pause between a user's messages |
| `RAMP_MS` | 0 | stagger between connection starts |
| `PROMPT` | "say hi in 3 words" | chat content (keep short for cost) |
| `SAMPLE_MS` | 1000 | memory sampling interval |
| `OUT_DIR` | loadtest-results | where CSV/JSON land |

## Output
- `loadtest-results/summary-<ts>.json` — latency p50/p95/p99, throughput, errors,
  queue depth (S1), idle reaps (S3), **peak RSS** + peak worker count.
- `loadtest-results/memory-<ts>.csv` — memory/worker-count time series.

## What each scenario validates (Phase B, on a real host)
- Sweep `MAX_CONCURRENT_WORKERS ∈ {4,6,8,10,12}` → peak RSS vs p95 latency curve.
- Thundering herd (all send at once) → S1 queueing + S4 backpressure.
- Runaway worker → S2 `WORKER_MAX_OLD_SPACE_MB` caps it (worker dies, host survives).
- Idle connections → S3 reaps them, memory/slots recover.

The harness is safe to re-run; test users are reused on subsequent runs.
