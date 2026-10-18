# Plan

## Autopilot run (2026-10-19, branch `claude/offline-themes-p2p`, charter in RUN.md)
Order set by sunwoo: (1) PWA, (2) UI: Settings reduced to Theme + Light/Dark, Classic = C-C, Realistic = R-B with textures, (3) WebRTC host-phone rooms, (4) final gate. Make-private and publish-new-public-repo are queued in NEXT.md, last.
Every node: model Sonnet unless stated; edit nodes run in a worktree; plan tier `light` unless stated. Check = the node's command plus `bash scripts/check.sh --fast`.

### Phase 1: PWA
Graph:
- p1a (sonnet, plan: light): job: self-host the fonts that remain after Phase 2 will use (Source Serif 4, Space Mono, Fraunces, IBM Plex Mono, Barlow Condensed, JetBrains Mono, Bricolage Grotesque, DM Mono are all referenced today; keep all for now) via `@fontsource` packages or vendored woff2 in `public/`, remove the Google Fonts links, fix `href="/favicon.svg"` to a relative path. input: index.html, src/styles/*.css `font-family` uses. output: no external URLs in dist. tools: Read, Edit, Write, Bash. check: `npm run build` and `grep -c "fonts.googleapis" dist/index.html` is 0, fonts load from dist assets. scope: index.html, package.json, package-lock.json, src/main.tsx, src/styles/fonts.css (new). attempts: 0
- p1b (sonnet, plan: standard, edge p1a -> p1b: index.html and fonts settled): job: manifest (`public/manifest.webmanifest`, name, short_name, display standalone, theme/background colour, relative start_url and scope), icons 192/512/maskable (generated from the SVG with a script, PNG output committed), custom Vite plugin writing `sw.js` with a precache list of every file in dist (hashed JS/CSS/JSON/fonts/icons) at build time, cache-first for hashed assets, network-first with cache fallback for `index.html`, versioned cache name from the build hash, old caches deleted on activate, no skipWaiting on install; `src/pwa/register.ts` registers on load and exposes an update-ready flag; `src/ui/UpdateBanner.tsx` "New version ready, tap to reload" posts SKIP_WAITING then reloads on `controllerchange`; `scripts/check-pwa.mjs` verifies the built output. input: p1a output, vite.config.ts, src/main.tsx. output: installable offline build. tools: Read, Edit, Write, Bash. check: `npm run build && node scripts/check-pwa.mjs` (manifest valid, icons exist, sw.js precache lists every file in dist/, no external URLs) and a Vitest for the register/update logic. scope: vite.config.ts, public/manifest.webmanifest, public/icons/**, scripts/check-pwa.mjs, scripts/make-icons.mjs, src/pwa/**, src/ui/UpdateBanner.tsx, src/main.tsx, index.html, tests/pwa/**, src/styles/overlays.css (banner style only). attempts: 0
Gate: `bash scripts/check.sh` (full) and `node scripts/check-pwa.mjs`; fresh reviewer on the diff; browser localhost check that the SW registers and the app loads with the network blocked after one visit. Retry cap 4.
- [x] p1a passed (attempt 1, merged 07f8ae0)
- [x] p1b passed (attempt 1, merged 2a12e09); reviewer: ready, major (HTTP cache on install) and two minors fixed by integrator
- [x] Phase 1 gate passed 2026-10-19: check.sh green (4 steps), SW active + 47 files cached in the browser pane, app loaded with the server stopped. Unverified: update banner in a real browser, install on a real phone. Open for Phase 2: banner position at 375px, theme_color follows theme, fontsource packages in dependencies, unused fonts precached after Phase 2.

### Phase 2: UI
Graph:
- u0 (haiku, explorer, read-only): job: inventory how Settings reaches the DOM (attributes/classes/CSS variables), which CSS files each of colour, layout, font, buttons, corners touches, which screens use the standard vs round layout, where Broadcast/Neon/presets live. output: `out/u0.md`. check: file:line evidence for every claim. scope: read-only.
- u1 (sonnet, plan: standard, edge u0 -> u1: inventory): job: collapse the look model to `theme: 'classic' | 'realistic'` and `mode: 'light' | 'dark'` (default theme classic, mode dark, migrate any saved old settings to the nearest equivalent), apply as `data-theme` and `data-mode` on the root, delete presets/colour/layout/font/button/corner choices from `src/game/settings.ts`, rewrite `src/ui/Settings.tsx` to two controls with a small preview each; classic uses the standard layout, realistic uses the round (card-room) layout. check: `tests/game/settings.test.ts` updated and green, `npm run lint`. scope: src/game/settings.ts, src/ui/Settings.tsx, wherever u0 says the attributes are applied, tests/game/settings.test.ts, tests/ui/**. attempts: 0
- u2 (sonnet, plan: standard, edge u1 -> u2: attribute contract): job: Classic theme = C-C "Slate and paper" for dark and light, as tokens in `src/styles/theme-classic.css`; all screens (menu, lobby, table, overlays, settings) read well at 375x667. check: screenshots both modes via localhost preview, contrast >= 4.5:1 for body text, `bash scripts/check.sh --fast`. scope: src/styles/theme-classic.css (new), src/styles/tokens.css, src/styles/base.css. attempts: 0
- u3 (sonnet, plan: heavy for textures, edge u1 -> u3): job: Realistic theme = R-B "Casino" dark and light with textures: felt weave, padded leather rail with stitch/gold inlay, leather action bar grain, red chip seats with edge marks, chip stacks; made with CSS gradients and inline SVG (feTurbulence), no downloaded images, perf-safe on phones (no huge repaint layers). check: screenshots both modes at 375x667 and 430x932, `bash scripts/check.sh --fast`. scope: src/styles/theme-realistic.css (new), src/styles/layout-round.css, src/styles/layout-round-screens.css, src/ui/ChipIcon.tsx, src/ui/Seat.tsx (visual only). attempts: 0
- u4 (sonnet, plan: light, edges u2,u3 -> u4): job: delete dead CSS and code for Broadcast, Neon, old Classic look, font/button/corner variants, old presets; no behaviour change. check: `bash scripts/check.sh`, grep for removed ids returns nothing. scope: src/styles/themes.css, src/styles/table.css (dead rules only), src/game/settings.ts leftovers, tests. attempts: 0
- u5 (sonnet, plan: light, edge u4 -> u5): job: 8-10 players on a short phone: table area scrolls vertically, all seats kept, hero controls stay reachable; check 667px-tall at 8, 9, 10 players in both themes. scope: src/ui/Table.tsx, src/ui/TableSeating.tsx, src/styles/table.css, src/styles/layout-round.css. attempts: 0
- u6 (sonnet, reviewer, edge u5 -> u6): fresh-context review of the Phase 2 diff against design.md, DECISIONS.md and RUN.md decisions, plus screenshots at 375x667, 390x844, 430x932 for both themes and both modes. read-only.
Gate: `bash scripts/check.sh` (full), `grep` shows no `broadcast|neon|data-font|data-buttons|data-corners`, u6 says ready. Retry cap 4.
- [x] u0
- [x] u1
- [x] u2
- [x] u3
- [x] u4
- [x] u5
- [x] u6
- [x] Phase 2 gate passed 2026-10-19: check.sh green; reviewer u6 ready (2 majors + minors fixed in u8); browser checks at 375x667/390x844: classic dark+light, realistic dark+light, 10-player scroll, Settings no overflow, first-paint attrs. Extra nodes: u3b (tame light textures), u7 (Settings overflow), u8 (review fixes). Unverified: iOS Safari, real phone, 8-10 players in landscape (still old layout), update banner position at 375.

### Phase 3: WebRTC phone-hosted rooms
Graph:
- w0 (haiku, explorer, read-only): job: map the transport seam: how `src/home/room.ts` is driven by `src/home/socket.ts` and `server/src/worker.ts`, message types, reconnect/seat-resume, what a host-in-browser transport must implement. output: `out/w0.md`. scope: read-only.
- w1 (opus, read-only planner, heavy, edge w0 -> w1): job: write `plans/w-p2p.md`: signalling codec (compressed offer/answer, no trickle ICE, host candidates only, SDP size budget for a QR), the transport interface, host/join flow screens, failure messages (no shared network), test plan. output: plan file.
- w2 (sonnet, plan: heavy via w1, edge w1 -> w2): job: `src/home/p2p/` codec, `PeerHost` (runs Room, multiple data channels), `PeerGuest`, same `Transport` interface the WebSocket client uses; tests with a fake RTCPeerConnection and a loopback pair running a hand through the real Room. scope: src/home/p2p/**, tests/home/p2p/**, src/home/room.ts (additive only if the plan requires). attempts: 0
- w3 (sonnet, plan: standard, edge w2 -> w3): job: UI "Nearby (no internet)" in the home game flow: host shows code + QR, guest pastes or scans, shows connection state and plain-language failures; works in both themes. scope: src/ui/home/**, src/ui/RoomLobby.tsx (additive), src/styles/room-lobby.css, tests/ui/**. QR: small MIT library or hand-written encoder; scan only via `BarcodeDetector` where present, else paste. attempts: 0
- w4 (sonnet, reviewer, edge w3 -> w4): fresh review; list what is untested on real phones. read-only.
Gate: `bash scripts/check.sh`; codec round trip and loopback game tests green; two-tab localhost check (host in one tab, guest in another, play a hand) if the browser pane allows, else stated unverified. Phones, hotspot and plane Wi-Fi: unverified. Retry cap 4.
- [ ] w0
- [ ] w1
- [ ] w2
- [ ] w3
- [ ] w4
- [ ] Phase 3 gate passed

### Phase 4: final gate
- [ ] Full `bash scripts/check.sh`, `node scripts/check-pwa.mjs`
- [ ] Fresh reviewer on the merged diff (`claude/offline-themes-p2p` vs `claude/workflow-setup`)
- [ ] `docs/PROGRESS.md` line, RUN.md retrospective, NEXT.md closed-lane list
- [ ] Push branch (no PR, no main)

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
  - [x] 8-10 players on a 667px-tall phone: scroll, all seats kept (autopilot u5, 2026-10-19; landscape still unsolved)
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
