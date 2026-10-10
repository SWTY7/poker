# Design

Tokens live in `src/styles/*.css`. Use the variables; don't hard-code values.
Mockups: `design/` and `poker-ui-directions.html`.

## Color
- bg `--bg` #100e0c; panel `--panel` #17140f; felt `--felt` #163a28
- text `--text` #f2efe6; dim `--text-dim` #a8a293
- accent `--accent` #cdae70 (deep `--accent-deep` #8a6a3c)
- positive `--green` #6fae7f; negative `--red` #c9707f
- lines `--line` #38321f, `--line-soft` #2f2a1c
- Dark only.

## Type
- Heading/display `--font-display`: Source Serif 4, Georgia, serif
- Mono (numbers, labels) `--font-mono`: Space Mono
- Scale `--fs-2xs` .58rem to `--fs-3xl` 2.2rem

## Spacing/layout
- `--sp-1` .25rem to `--sp-7` 2.2rem
- Radius `--r-sm` .4rem, `--r-md` .6rem

## How to redesign (process)
- Theme first, then detail. Order: tokens (color, type, radius, shadow, motion) -> shared pieces (button, panel, chip, playing card) -> table screen -> lobby and menus -> home game on a phone -> motion polish. One commit per stage.
- Design phone and desktop together, not one after the other. Decide tokens and shared pieces for both at once; build the phone layout first (it is the tighter one, and the home game is phone-only), then widen.
- After every stage, look at it at 390px and at 1280px in the browser before committing. A change that only works at one width is not done.
- Visual direction comes from one chosen mockup in `design/`. Don't blend directions.

## Rules
- No value written inline: colors, sizes, radii, shadows and durations come from the tokens in `src/styles/tokens.css`. Add a token before adding a one-off value.
- One accent color. Positive and negative colors only mean won/lost or good/bad, never decoration.
- Type: one display face for headings, one text face for everything else, tabular numerals for chips, pots and stacks. No more than three sizes on one screen.
- The table is the hero: the pot, the board, your cards and your decision get the most space and contrast. Chrome (HUD, menus, logs) stays quiet.
- Avoid the template look: no row of identical rounded cards as a layout, no gradient-on-everything, no emoji as icons, no decoration that carries no information.
- Motion explains something (a card dealt, chips moving to the pot, a winner). Keep it under 300ms, and respect `prefers-reduced-motion`.
- Touch targets are at least 44px. Nothing important sits under the phone's notch or home bar (use the safe-area insets).
- Contrast: body text at least 4.5:1 against its background.

## Direction from sunwoo (2026-10-03)
Not a "premium AI dashboard". It should read as made by a designer with a specific taste.
- Avoid: excessive rounded cards, centered layouts, gold-on-brown gradients, generic line icons, glassmorphism, symmetrical card grids.
- One strong visual metaphor, and the UI derives from it. The lobby is a poker room, not a SaaS dashboard.
- Far fewer containers. Not every piece of information needs a card: use whitespace, type, dividers and spatial hierarchy instead of nested rounded rectangles.
- Use poker-native elements where they communicate something: chips, table silhouettes, cards, the dealer button, tournament boards, seating, stakes. No decorative suits or symbols that say nothing. Every decorative element communicates or reinforces the game's world; cut anything that only looks premium.
- The table is spatial, not symmetrical. Players sit around it and their information orients toward their seat and stays tied to that player.
- A player is one seat presentation: name, stack, position, hole cards, current action and chips committed together, not a dashboard card. Borders and backgrounds only where they improve grouping or readability.
