# OxyGenie — Project Memory

This folder is the **single source of truth** for where this project is going and
where it currently stands. It exists so that **anyone** (a new contributor, or a
future maintainer with no prior context) can pick up the repo and know what to
do, what *not* to do, and the direction to push in.

## The four documents

| File | What it is | How often it changes |
|---|---|---|
| [`VISION.md`](./VISION.md) | The big picture: what OxyGenie is, the end goal, our architectural identity, and the do/don't principles. | Rarely (only on strategic shifts) |
| [`ROADMAP.md`](./ROADMAP.md) | The phased plan from foundation → surpassing Deep Agents, with exit criteria per phase. | Occasionally (when a phase completes or is re-scoped) |
| [`STATUS.md`](./STATUS.md) | **The living memory.** Current phase, what's done / in progress / next, and the backlog with difficulty tags. | **Continuously** — update it whenever state changes |
| [`research/2026-05-architecture-review.md`](./research/2026-05-architecture-review.md) | The adversarial architecture review and the **Deep Agents comparison** that grounds the whole plan. | Frozen snapshot (re-run as a new dated file if redone) |

## Rules for keeping this memory useful

1. **Update `STATUS.md` as part of finishing any task** — treat it like updating a
   changelog. A stale STATUS is worse than none.
2. **Every claim about the codebase should cite files** (path + symbol), so the
   reasoning can be re-verified. The architecture review models this.
3. **Decisions go in `STATUS.md` → Decision log** with a one-line rationale, so we
   don't re-litigate settled choices.
4. This is the canonical project memory for the **code repo**. Internal
   role/process docs may live elsewhere, but direction + state live here.
