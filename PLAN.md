# Plan

## To do
- [ ] Table UI fixes from sunwoo's phone screenshots (2026-10-05, uncommitted on `claude/remove-timing`). Files: `src/ui/HeroZone.tsx`, `Table.tsx`, `TableHud.tsx`, `street-action.ts`, `src/styles/layout-round.css`, `table.css`, `themes.css`, `tokens.css`. Checked at 375x667, 390x844 and 430x932.
  - [x] 1. Hero panel: 2-row grid, bigger stack pill, hand chip, reserved To-call, padding above divider
  - [x] 2. Stale "Check" label (hero checked, then faced a bet, label stayed); `tests/ui/street-action.test.ts`
  - [x] 3. Bet pills and dealer puck off the board (placed from the seat, not the table centre)
  - [x] 4. Header: tournament level and field size on a second line on phones; "Bubble · 3/6"
  - [x] 5. Contrast: faint text lighter, felt text 0.82 ivory; amounts upright in the warm font
  - [x] 6. Seat tags on the felt (betting line hidden on phones)
  - [x] 7. Table height by player count (heads-up and 3-handed shorter, ring and arc by count)
  - [x] 8. Action buttons: Raise filled, equal height and radius
  - [ ] Not solved: 8-10 players on a 667px-tall phone are still crowded (see summary); decide whether to cap or scroll
  - [ ] Branch/worktree cleanup (blocked by the permission classifier; sunwoo to run or approve)
- [ ] Psychology track, Phase 3a: recover bot personality from play (branch `claude/personality-lab-3a`, spec in `docs/plans/psychology-lab.md`). Offline scripts only, no bot behaviour change.
  - [x] Session generator: bot-vs-bot sessions with parameters drawn from wide ranges (not just `CAST`), every seat logged like the human
  - [x] Per-seat summary stats per N hands (Phase 1 stats plus tilt signature, showdown bluff share, sizing)
  - [x] Recovery method 1: stats to parameters (nearest-neighbour or small regression), train/held-out split
  - [ ] Recovery method 2 (moved out of 3a's PR): likelihood fit. Needs a PsychBot seam that exposes each action's probability without changing any decision, plus full observations logged per decision. Would settle whether tilt and confidence are truly invisible or only invisible to summary statistics.
  - [x] Report per parameter: correlation and error at 50/100/200/500 hands; say which parameters are not identifiable
  - [x] `docs/PROGRESS.md` line, tests, `npx tsc -b`, `npm run lint`, `npm test`; one PR
- [ ] Future, after 3a (not started, needs sunwoo's go): offline RL adaptive exploiter, trained against 3a's opponent population, as a measuring stick (script, not a shipped bot). Shipping it would re-open the 2026-09-25 one-bot-kind decision; sunwoo decides after seeing how far it beats PsychBot. Options: Deep CFR / NFSP for scale (overlaps `docs/cfr-distillation-plan.md`), opponent-stats-conditioned policy for adapting.
- [ ] UI redesign (branch `claude/ui-redesign`, PR #33 has the theme switch). Card room first, as a real redesign, not a recolour. Design rules in `design.md`.
  - [x] Settings screen with separate choices (colours, layout, fonts, buttons, corners) and presets; Classic kept as the default (PR #33)
  - [x] Card room, table screen: oval table, seats on the rail, chip-disc avatars, paper stack tags, chip pile for the pot, hero cards straddling the rail, wood dock with brass buttons; phone and desktop
  - [x] Card room: you as a seat (no panel), seats lean and sit off the line, dealer puck (2026-10-03, per sunwoo's direction in design.md)
  - [x] Round table lobby (`RoomLobby`): ruled rows, table plans, no cards
  - [x] Round table lobby: three boxes, home game first (sunwoo picked A2, 2026-10-04); Achievements removed
  - [x] Round table: the other screens (setup, career hub with cash/tournament under it, join/host, your play, settings, home room) restyled via `layout-round-screens.css`: no card, rules between sections, flat brass button
  - [ ] Round table: per-screen detail from the mockups (join digit slots, quick-play table that follows the player count, chip-denomination stacks, home room seat plan)
  - [ ] Round table: logo/wordmark and any icons that communicate (replace generic line icons)
  - [ ] Card room, home game screens on a phone
  - [ ] Review with sunwoo, then decide what to do with Broadcast / Poster / Neon (same depth, or drop)
- [ ] Open initiative: CFR teacher/student distillation (`docs/cfr-distillation-plan.md`; Phase 1 pilot measured, no decision yet on how far to take it)
- [ ] Human strategies no bot implements yet (`docs/human-strategy-gaps.md`)

## Done
- [x] Range reading, blocker-aware fold equity, calibrated reads (2026-09-25)
- [x] PsychBot combined with solved strategy; simpler bots retired (2026-09-25)
