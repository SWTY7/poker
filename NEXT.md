# Next

Run finished (claude/offline-themes-p2p, pushed, no PR). Next: your decisions below, then the closed-lane items.

## Test on real devices (nothing here could be checked in the build environment)
1. Install the PWA on your phone from the deployed site (needs a deploy, see below), turn on airplane mode, open it: solo play should work. Check the "New version ready" banner by deploying a second version.
2. Nearby rooms: one Android phone hosts (airplane mode on, then hotspot on), another joins its hotspot, swap codes by typing or QR (scan works on Android Chrome only). Report what happens; iPhone as host cannot work in airplane mode (Personal Hotspot needs cellular).

## Decisions for sunwoo
- Add a QR decoder (jsQR, Apache-2.0, about 40 KB gzipped) so iPhones can scan codes? Not added; iPhones type about 120 characters now.
- The room server allows a friend to flood `hello` or join with many playerIds (existing behaviour, same in nearby rooms); fine under the trust notice, or add a rate limit?
- 8-10 players in landscape phones and short desktop windows still use the old fixed oval (unsolved).
- Keep `design/theme-options.html`, `plans/`, `RUN.md`, `NEXT.md`, `.claude/launch.json` in the repo, or drop them from the clean public repo.

## Queued closed-lane items (autopilot never runs these; run together, in this order)
1. Open the PR for `claude/offline-themes-p2p` (branch is pushed) and merge it.
2. Deploy a version tag so the PWA reaches swty7.github.io/poker (a deploy; never run by autopilot).
3. Make `SWTY7/poker` private. Warning: GitHub Pages on a private repo usually needs a paid plan, so swty7.github.io/poker would go down until step 4.
4. Create the new public repo with clean files only (no `lab-data/`, `lab-gen-*.log`, `design/` mockups, `poker-ui-directions.html`, run files, agent files unless wanted) and deploy Pages from it.

## Blockers
None.
