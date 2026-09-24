# Poker

A client-side, No-Limit Texas Hold'em web app — React, TypeScript, Vite. No backend, no LLM. The
distinguishing part isn't the poker engine, it's the AI opponent layer: every bot seat draws one of four
genuinely different kinds of opponent, mixed and randomized fresh each game, from a plain hand-strength
calculator up to a full psychological model (prospect theory, tilt, level-k opponent reasoning, per-session
learned reads on specific opponents) and a from-scratch CFR-solved "GTO" bot for heads-up spots.

**Read [`docs/PROGRESS.md`](./docs/PROGRESS.md) for the current state of the project and a map of the other
docs** — it's the accurate, up-to-date entry point; this file is just how to run it.

## Running it

```sh
npm install
npm run dev       # local dev server with HMR
npm run build     # typecheck + production build
npm run preview   # serve the production build locally
npm test          # vitest, full suite
npm run lint      # oxlint
```

## Offline solver scripts

The CFR/GTO layer (`src/gto/`) is trained offline and shipped as static JSON — nothing in the browser
solves anything at runtime. These regenerate that data:

```sh
npm run train:blueprint -- [iterations] [stack] [buckets] [outFile]   # train one stack depth's blueprint
npm run pilot:exact -- [iterations] [stack]                            # measure exact vs. bucketed CFR keying
npm run chart:pushfold                                                 # print the solved heads-up push/fold chart
npm run generate:preflop-equity                                        # regenerate preflop equity data
```

See `docs/PROGRESS.md` for what each piece of the solver actually does, and `docs/cfr-distillation-plan.md`
for the initiative `pilot:exact` exists to support.
