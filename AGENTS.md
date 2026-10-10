# Poker

Client-side No-Limit Texas Hold'em web app (React, TypeScript, Vite). The point is the AI opponent layer: each bot is a psychological model anchored to an offline CFR-solved "GTO" strategy. Current state: `docs/PROGRESS.md`.

## Invariants
- No backend, no LLM at runtime. Deployed to GitHub Pages.
- The CFR/GTO layer (`src/gto/`) is trained offline and shipped as static JSON. Nothing solves in the browser.
- Bots see the game only through the `AIObservation` boundary (`docs/v1-architecture-plan.md`).
- One bot kind: PsychBot blended with the solved strategy (`docs/combined-bot.md`).
- `npm test` and `npm run lint` pass before every commit.

## How to work here
- Read PLAN.md and DECISIONS.md first, then `docs/PROGRESS.md`.
- DECISIONS.md entries are settled; don't re-open them unless sunwoo asks.
- Keep PLAN.md updated; update `docs/PROGRESS.md` when a meaningful piece lands.
- Follow design.md for UI work.

## Failure recovery
- Same check fails twice on the same cause: stop, print the exact error, restate the plan and ask.
- Max 3 attempts per unit. Retry only with the failure reason in hand.
- A fix touches only the failing unit. Adjacent issues are listed, not fixed.

## Delegation
- Use explorer for searches touching >5 files; reviewer before declaring a milestone done.
- Fan out workers only when PLAN.md lists a graph for the milestone. If the work splits cleanly and there is none, write it first. Otherwise work in one session.
- Edit-nodes run in their own worktree. Return only failed units on retry.
- All checks go through `scripts/check.sh` (Stop hook, merge step, worker self-check).
