# Poker Psychology — Coding & Architecture Plan (v2)

## 0. Project Definition

Build a **single-player, browser-based Texas Hold'em poker game** that runs on both laptop and iPhone.

```text
React
TypeScript
Vite
```

No backend, database, authentication, API, or server-side/LLM AI.

**v1 scope is deliberately narrower than the original plan.** The priority is a correct, well-designed,
fully playable Texas Hold'em game first. The "psychological AI opponent" system (personality, emotion,
memory, cognitive biases, theory of mind) described later in this document is **out of scope for this
build** and will be designed and implemented separately, later, by the user. The architecture below exists
specifically so that layer can be added afterward without rewriting the engine or UI.

v1 must support:

- Texas Hold'em only (no Omaha / other variants yet)
- configurable player count (2–10)
- configurable starting stacks, blinds, antes
- human player vs AI players
- simple AI opponents (random + basic heuristic — no personality)
- responsive laptop / iPhone UI matching the reference design below
- hand history (basic)

Deferred to a later phase (not built now):

- personality/emotion/memory/bias/theory-of-mind AI layer
- AI-vs-AI simulation & experimentation framework
- Omaha and other variants
- dialogue/analysis mode

---

## 1. Core Engineering Principle

Separate the project into independent layers, so the future AI-psychology layer can be dropped in later
without touching the engine or UI:

```text
┌───────────────────────────────┐
│              UI                │
└──────────────┬────────────────┘
               │
┌──────────────▼────────────────┐
│        Game Controller         │
└──────────────┬────────────────┘
               │
┌──────────────▼────────────────┐
│         Poker Engine           │
│  cards / rules / pots / bets   │
└──────────────┬────────────────┘
               │
┌──────────────▼────────────────┐
│           AI Agents            │
│   (v1: random / heuristic)     │
└───────────────────────────────┘
```

Rules to hold to throughout:

- The poker engine must not know anything about AI internals (personality, etc. later).
- The AI never mutates `GameState` directly — it requests an action (`{ type: "raise", amount: 60 }`),
  and the engine validates and applies it. Never trust the AI to enforce poker rules.
- The AI receives a restricted `AIObservation`, not the full `GameState` (see §8, the information
  boundary). This is what makes the future psychology layer (subjective/imperfect beliefs) possible
  without cheating.

---

## 2. Technology

- TypeScript
- React
- Vite
- Plain CSS (CSS Modules or similar) — flat, minimal visual style, no UI kit needed
- No framework beyond React unless a compelling need arises

Recommended structure:

```text
poker/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
│
├── src/
│   ├── main.tsx
│   │
│   ├── poker/                 # pure game logic, no React/UI imports
│   │   ├── card.ts
│   │   ├── deck.ts
│   │   ├── hand-evaluator.ts
│   │   ├── player.ts
│   │   ├── pot.ts
│   │   ├── betting.ts
│   │   ├── game-state.ts
│   │   ├── game-engine.ts
│   │   └── holdem.ts
│   │
│   ├── ai/
│   │   ├── agent.ts            # Agent interface: observation -> action
│   │   ├── observation.ts      # ObservationBuilder (GameState -> AIObservation)
│   │   ├── random-bot.ts
│   │   └── heuristic-bot.ts    # hand strength / pot odds / simple equity
│   │
│   ├── ui/
│   │   ├── Table.tsx
│   │   ├── Seat.tsx
│   │   ├── Card.tsx
│   │   ├── PotDisplay.tsx
│   │   ├── Controls.tsx
│   │   └── Settings.tsx
│   │
│   └── utils/
│       ├── random.ts            # seeded RNG
│       └── math.ts
│
└── tests/
    ├── poker/
    └── ai/
```

Do not create a backend.

---

## 3. Rules Source of Truth

Standard poker rules, no wild cards (per Bicycle's official rules: standard 52-card deck, no five-of-a-kind).

Hand rankings, highest to lowest:

```text
Royal Flush
Straight Flush
Four of a Kind
Full House
Flush
Straight
Three of a Kind
Two Pair
One Pair
High Card
```

- Wheel straight (A-2-3-4-5) counts as a straight, ace plays low.
- Ties split the pot; kickers resolve ties within a category exactly per standard rules.
- Standard No-Limit Texas Hold'em structure: dealer button, small blind, big blind, optional ante,
  preflop → flop → turn → river → showdown, with check/bet/call/raise/fold/all-in.

---

## 4. Reference UI Design

Modeled on the classic "Apple Texas Hold'em"-style table, but flat/minimal — no player photos, no
wood/felt textures, no heavy color skin.

```text
                 [Seat]  [Seat]  [Seat]  [Seat]
              [Seat]                       [Seat]
                        ── oval table ──
                         (pot / board)
              [Seat]                       [Seat]
                 [Seat]  [Seat]  [Seat]  [Seat]

                                        [Your cards, large]
```

Each seat plate shows: player name, stack size, last action taken (e.g. "Raise $200", "Call $40",
"Fold"). Dealer button (D), small blind (S) and big blind (B) markers sit near the relevant seats.
Small chip markers sit in front of a seat when it has money in the pot this street, and in the middle
for the pot total. Community cards sit in the center of the table.

Key behaviors:

- Opponents' hole cards render as small face-down card backs.
- A folded seat dims (reduced opacity / desaturation) — the seat, cards, and chips all dim together.
- The human player's own two hole cards render large, face-up, in the bottom corner — big enough that
  rank and suit are clearly legible.
- Layout must adapt to player count (2–10) and to laptop and iPhone-portrait screens without horizontal
  scrolling.

---

## 5. Information Boundary (carried over — still essential)

The engine knows all hole cards, the deck, and future RNG state. The AI must not.

```text
GameState
      ↓
ObservationBuilder
      ↓
AIObservation
```

```typescript
interface AIObservation {
    ownCards: Card[];
    communityCards: Card[];
    potSize: number;
    stackSizes: number[];
    position: number;
    actionHistory: VisibleAction[];
    legalActions: Action[];
}
```

The AI cannot access opponent hole cards, the undealt deck, or future cards. This boundary is what
lets the future subjective/psychological AI layer be built without ever "cheating."

---

## 6. Milestones

### Milestone 1 — Project Setup
Vite + React + TypeScript scaffold. `npm run dev` and `npm run build` both work. No backend, no
external AI APIs.

### Milestone 2 — Card System
`Suit`, `Rank`, `Card`, `Deck`. Deck: exactly 52 cards, shuffle, draw, no duplicates within a hand,
seedable RNG for deterministic tests.

### Milestone 3 — Hand Evaluator
Implement and thoroughly test hand evaluation per §3. Return a comparable structure
(`{ category, rank, tiebreakers }`). Do not proceed until this is trustworthy — test wheel straights,
broadway straights, flush vs straight, full house/quad comparisons, kickers, ties.

### Milestone 4 — Game State & Hold'em Rules
`GameState`, `PlayerState`, dealer button rotation, blinds, optional ante, streets
(preflop/flop/turn/river), legal-action computation, 2–10 players.

### Milestone 5 — Betting Engine & Pots
`PokerAction` (`fold/check/call/bet/raise/all-in`), legality validation, main pot + side pots for
unequal all-ins, folded-player contributions, correct showdown eligibility. Extensive tests for
all-in edge cases.

### Milestone 6 — Static UI
Build the table layout from §4 with static/mock data first: oval table, `Seat` component reused per
player, dealer/blind markers, pot display, hero's large cards, responsive laptop/iPhone layout, fold
dimming.

### Milestone 7 — Wire UI to Engine
Connect the real `GameState` to the UI. Human player can act through the UI (fold/check/call/bet/raise)
via the engine's validated-action path. Full hand plays out correctly end to end.

### Milestone 8 — Basic AI
`RandomBot` (chooses a legal action at random) to exercise the full game loop, then a `HeuristicBot`
using hand strength / pot odds / basic equity (no personality, no memory, no bias) so a complete solo
game against several bots is playable.

### Milestone 9 — Polish
Deal/chip animations, fold-dim transition, settings screen (players, stacks, blinds, ante) persisted to
`localStorage`, save/resume of in-progress game state, basic hand history.

### Milestone 10 — (Future, not part of this build)
Personality, emotion, memory, cognitive biases, theory of mind, AI-vs-AI simulation/experiments, Omaha
and other variants. To be designed and implemented later, plugged in behind the existing
`AIObservation` → action interface from §5 without modifying the poker engine.

---

## 7. Testing Strategy

- **Poker tests**: deck integrity, shuffling, hand evaluation (incl. ties), betting legality, raises,
  all-ins, side pots, blinds, dealer rotation, player elimination.
- **Engine invariants** (run over many simulated hands with `RandomBot`/`HeuristicBot`): chip
  conservation, correct game termination, no impossible/duplicate cards, no negative stacks.
- Prefer deterministic seeded simulations during testing.

---

## 8. Rules For Any Coding Agent Working On This

1. Never rewrite unrelated components when implementing a feature.
2. Keep poker rules independent from AI logic.
3. Never give an AI access to hidden game information.
4. Never let an AI directly mutate `GameState`.
5. Every poker rule needs tests.
6. Do not add an LLM.
7. Do not add a backend unless explicitly requested.
8. Do not prematurely optimize (no Web Workers etc. until profiling shows a need).
9. Keep the `AIObservation` / action-request interfaces stable — the future psychology layer depends
   on them not changing shape later.
10. After each milestone, `npm test` and `npm run build` must succeed.

---

## 9. Definition of Success (v1)

You can open the app on a laptop or iPhone and play a complete, rules-correct No-Limit Texas Hold'em
game against several simple AI opponents, in a clean flat-design UI matching §4, with no backend and
no LLM involved.
