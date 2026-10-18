# Run charter: offline phone play, two themes, phone-hosted rooms

Branch `claude/offline-themes-p2p`. Run folder `C:\Users\sunwoo\Poker` (repo root). Started 2026-10-19. Owner: sunwoo.
Only the main agent (integrator) writes this file and PLAN.md. Subagents write only their own output files.

## Goal and success check
- Goal: the app installs as a PWA and plays offline on a phone, Settings is only Theme (Classic or Realistic) plus Light/Dark, and two phones with no internet can play a hosted room via WebRTC.
- Success check (a command or observable test, not an agent's report): `bash scripts/check.sh` green; `node scripts/check-pwa.mjs` green on a fresh `npm run build`; WebRTC loopback tests green; reviewer says ready.

## Pre-granted permissions (this run only)
One explicit yes from the owner, in chat, on 2026-10-19: "C-C and R-B ... then do autopilot" after the settings listed below were approved ("Do you say yes to the whole run?" followed by the theme pick). Nothing else is granted.
| Permission | Granted |
|---|---|
| Push `claude/*` feature branches, and open a PR with `gh` (hand-off option A only) | push branch only, NO PR |
| Browser on public pages (no login, no forms) | no (localhost preview only) |
| Project-level settings change for the compaction fallback (never global) | yes (autoCompactWindow ~200k, `.claude/settings.json`) |
| Anything else | no |

## Advisor
Model: off.

## Decisions made up front
| Topic | Decision |
|---|---|
| Order | PWA, then UI (themes + fixes), then WebRTC, then final gate |
| Make `SWTY7/poker` private | CLOSED LANE. Queued in NEXT.md for the end, run together with the public repo. GitHub Pages usually needs a paid plan for private repos, so the site would go down |
| New clean public repo | CLOSED LANE. Queued in NEXT.md, last |
| Settings | Only two controls: Theme and Light/Dark. Fonts, layout, buttons, corners, colour choices, presets removed. Broadcast and Neon dropped |
| Classic theme | "C-C Slate and paper" from `design/theme-options.html`: cool grey-blue, dashed outline seats, soft rounded buttons, standard layout. Replaces the old Classic look (owner chose it on 2026-10-19; overrides the earlier "Classic stays intact" note) |
| Realistic theme | "R-B Casino" from `design/theme-options.html`: textured baize, black padded rail with gold inlay, red casino-chip seats, dark leather action bar, round table layout. Owner added: more textures for realism (felt weave, leather grain, chip edge marks, rail padding), generated with CSS/SVG, no downloaded images |
| 8-10 players on a short phone | Table scrolls vertically, all seats kept |
| PWA tooling | No new runtime dependency; small custom Vite plugin writes the precache list. Fonts self-hosted (Google Fonts link breaks offline) |
| Update behaviour | New service worker waits; banner "New version ready, tap to reload" posts SKIP_WAITING; otherwise applies at next full close |
| WebRTC | Phone-only, no server. Offer/answer exchanged by copy-paste code (mandatory) and QR (best effort). Reuses `src/home/room.ts` as the host logic |
| Phone tests | Real two-phone, no-internet behaviour cannot be tested here; reported as unverified |
May decide alone: anything reversible (file names, texture details, CSS values, test structure, which npm packages for fonts and QR if small and MIT), each with a short decision record. Anything else: stop and report.

## Stop and report (never work around these)
- Closed lane: deploys, pushes to main, publishing, repo visibility, logins, forms, purchases, secrets, migrations. Queue it, never execute it.
- The same check fails 5 times in a row for the same reason (first attempt plus 4 retries).
- A node is out of retries: phases are sequential, so its gate cannot pass.
- Anything not granted above.
- A source needs a login or blocks access: skip it, note it, don't evade it.
- A legal or defamation doubt about a specific item: mark it `hold`, leave it unpublished.
- A file named `STOP` exists in the repo root. Checked at every gate and before every dispatch.
- Any hard cap below is reached.

## Hard caps (counted across all phases, not per phase)
| Cap | Value |
|---|---|
| Agents at once | 1 main + at most 5 subagents |
| Retries per node | 4 after the first attempt (failed node only, with the failure reason) |
| Cumulative subagent spawns | 40 |
| Phases | 4 |
| Token ceiling | 8M (estimate; session budget 15M) |
| Wall-clock ceiling | 12 h (from log timestamps) |
Excess ready nodes are queued, not started.
On a cap: write the record, list unfinished items, exit with a recap.

## Phases (sequential; the gate check decides "done", never a subagent's report)
| # | Phase | Gate check (command or test) |
|---|---|---|
| 1 | PWA: self-hosted fonts, manifest, icons, service worker, update banner | `bash scripts/check.sh` and `node scripts/check-pwa.mjs` |
| 2 | UI: Settings = Theme + Light/Dark; Classic (C-C) and Realistic (R-B + textures); scroll on crowded tables | `bash scripts/check.sh`; settings tests; screenshots at 375x667, 390x844, 430x932, both themes, both modes |
| 3 | WebRTC phone-hosted rooms | `bash scripts/check.sh`; codec and loopback tests; two-tab local check |
| 4 | Final gate: full check, fresh reviewer on merged diff, recap | `bash scripts/check.sh` and reviewer "ready" |

## Rules for the work
- Facts only, each with a source and the date checked; unchecked means unknown.
- `npm test` and `npm run lint` pass before every commit (AGENTS.md). No LLM or backend at runtime. Bots see the game only through `AIObservation`.
- Do not change bot behaviour or the solver files.
- Keep `design.md` rules: poker-native decoration, few containers, spatial table.

## State on disk (the run survives a compaction or a crash)
- `RUN.md` (this file): charter, caps used, progress log.
- `PLAN.md`: graph per phase, node status, attempts per node.
- `NEXT.md`: current phase, next action, blockers, queued closed-lane items.
- Each subagent's output file under `out/<node>.md`.
- Decision records in `docs/decisions/` or a "Run decisions" list in this file.
- Commits on `claude/offline-themes-p2p` after each passed gate.

## Compaction hand-off (refreshed by the main agent at every gate, before compacting)
- Goal: PWA offline, two themes + light/dark, WebRTC phone rooms; current phase: 1, PWA
- Open nodes: p1a, p1b (0 attempts)
- Decisions in force: see "Decisions made up front"
- Caps used so far: spawns 0/40, phases 0/4, tokens ~0.2M, hours ~0
- STOP file present: no
- Next action: dispatch p1a
After compaction: reread this file, PLAN.md and NEXT.md before doing anything.

## Progress log (main agent only, append-only)
| Date/time | Phase | Event | Gate result | Caps used |
|---|---|---|---|---|
| 2026-10-19 | 0 | Charter written, baseline `scripts/check.sh` green on claude/workflow-setup, branch claude/offline-themes-p2p cut | pass | 0/40, 0/4 |

## Retrospective (written at the end)
