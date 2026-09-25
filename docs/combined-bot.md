# One bot: instinct, anchored to the solve

*Design and measurement record for how PsychBot and the CFR blueprint were combined (2026-09-25). Read this
before changing `psych-bot.ts`'s `anchoredChoice`, a profile's `discipline`, or anything that feeds either.*

## What changed

Tables used to seat four separate kinds of bot, drawn at random per seat: a pot-odds calculator
(`HeuristicBot`), the same calculator with personality dials (`PersonalityBot`), the psychological model
(`PsychBot`), and a "solved" seat that played the pure blueprint heads-up and PsychBot otherwise. Nothing
blended. A seat was one of them, and the solved seat *switched* between two strategies per decision.

Now every seat is a `PsychBot`. Once the blueprint downloads, each bot gets it (`useFundamentals`). Where the
blueprint has an answer (heads-up, a trained depth), the bot *blends* it with its own valuation. What makes a
table varied is the character each seat draws (`profile.ts`'s `CAST`), which now includes how much that
character has studied: `discipline`. `PersonalityBot` was deleted. `HeuristicBot` stays only as the engine
tests' cheap driver and the benchmarks' floor.

## The mechanism

A professional has a studied default and moves off it when their own read of the spot says moving pays.
The published form of exactly that is KL-regularized play ("piKL", Jacob et al. 2022). It was built to
model players who are strong *and* recognisably human:

    pi(a)  ∝  anchor(a) · exp( q(a) / temperature )

    anchor(a)    = discipline · solve(a)  +  (1 − discipline) · [a is instinct's favourite]
    q(a)         = PsychBot's own subjective value of a, in pots, relative to its best action
    temperature  = 0.25 · discipline / (1 − discipline)
    discipline   = profile.discipline · (1 − 0.8 · tiltIntensity)

- Discipline 0 is exactly the old PsychBot: argmax of its own valuation. `RATIONAL` stays at 0, so every
  bias test still compares against the unmodified model.
- Discipline 1 is exactly the solve.
- Tilt wears discipline down. The studied default is the first thing that goes when a player steams.
- Where the solve has no answer (multiway, untrained depth), nothing changes: pure instinct.

`BlueprintBot.strategyFor` / `BlueprintSetBot.strategyFor` expose the solve's whole mixed strategy as legal
table actions, instead of one sampled action, which is what the blend needs.

## What was measured, and what it changed

`npm run benchmark:pro -- [pairs] [discipline] [dealSet]`: heads-up at 20bb, duplicate-scored (every deal
played both ways). Three matchups: pure solve vs a recreational bot (`AVERAGE_HUMAN`, which also gets the
solve, at its own discipline of 0.15); the pro vs that same recreational bot; the pro vs the pure solve.
Error bars are one standard error.

### Round 1: reads also loosened discipline — rejected

The first version also divided discipline by `1 + 4 · |aggression read|`, meaning "a pro deviates when they
have a read". Deal set 0, 4,000 pairs:

| pro discipline | pro vs rec | pure solve vs rec | gain from blending | pro vs pure solve |
|---|---|---|---|---|
| 0.85 | +21.2 ± 9.6 | +38.7 ± 9.4 | −17.5 | −9.6 ± 8.4 |
| 0.95 | +22.6 ± 10.7 | +38.7 ± 9.4 | −16.1 | −14.6 ± 8.4 |
| 0.99 | +50.5 ± 10.8 | +38.7 ± 9.4 | +11.8 | −0.6 ± 8.4 |
| 0.85, read term removed | +42.9 ± 10.2 | +26.5 ± 9.5 | +16.4 | −1.5 ± 8.4 |

**Root cause:** `OpponentModel.aggressionBias` measures aggression against a fixed 35% "balanced" baseline,
which is a full-table number. Heads-up, the only place the solve applies, nearly every player bets more than
that, so the "read" fired against everyone and dissolved discipline every hand. Reads still reach the
decision through PsychBot's own valuation (`bluffBeliefFor`); they no longer get a second lever.
(`human-strategy-gaps.md` item 5 suggests calibrating the baseline.)

### Round 2: fresh deals, read term removed

Deal set 1, 4,000 pairs:

| pro discipline | pro vs rec | pure solve vs rec | gain from blending | pro vs pure solve |
|---|---|---|---|---|
| 0.70 | +36.0 ± 10.3 | +43.6 ± 9.4 | −7.6 | −23.8 ± 8.7 |
| 0.85 | +50.8 ± 10.3 | +43.6 ± 9.4 | +7.2 | −22.1 ± 8.4 |
| 0.95 | +30.0 ± 9.8 | +43.6 ± 9.4 | −13.6 | +16.7 ± 8.0 |

These don't agree with round 1. d = 0.85 against the solve went from −1.5 to −22.1. At 4,000 pairs the error
bars are as large as the effects. There is also a structural reason to expect the blend to leak (below).

### Round 3: 12,000 pairs, shared fresh deals

Deal set 2, 12,000 pairs, both disciplines on the same deals, so their difference is less noisy than either
number alone:

| pro discipline | pro vs rec | pure solve vs rec | gain from blending | pro vs pure solve |
|---|---|---|---|---|
| 0.85 | +47.9 ± 5.9 | +39.0 ± 5.4 | **+8.9** | −2.9 ± 4.9 |
| 0.95 | +50.1 ± 5.6 | +39.0 ± 5.4 | **+11.1** | −4.2 ± 4.8 |

**Reading it:** this is the shape piKL is supposed to produce. Against a recreational player the pro wins
more than pure GTO does, and against GTO itself it's a statistical draw. At d = 0.85 the gain over pure GTO
came out positive on every deal set tried (+16.4, +7.2, +8.9). The one alarming number, −22.1 against the
solve in round 2, didn't reproduce at three times the sample, so it reads as the tail of a noisy 4,000-pair
run. It's still honest to call the gain *suggestive* (about 1.5–2 standard errors per run), not proven. 0.85
and 0.95 can't be told apart at this precision. `PRO` stays at 0.85, which leaves more room for its human
side (tilt, instinct) to show.

**What this doesn't claim:** that the blend beats GTO. It doesn't, measurably, and it isn't designed to. A
balanced opponent can't be exploited, only matched. The claim is narrower: leaning on the solve while still
listening to instinct costs nothing measurable against a strong player and earns more against a weak one.

## Why the blend can cost EV, and what would fix it

The exp term doesn't only act on the instinct share. It re-weights *every* frequency in the solve's mix
toward PsychBot's valuation. piKL assumes that valuation is a good estimate of value (in the original work
it comes from search). PsychBot's is deliberately a *human* one: prospect-theory distorted, one street
deep, "flatters aggression" by its own header. So even without a read, a moderately disciplined bot gets
nudged off balance in every spot, and a balanced opponent (the solve) can punish that.

That's fine, and intended, for recreational characters: their instinct is supposed to be flawed. For a
professional, deviations should come from information that's actually reliable. That points at the gaps doc
rather than more tuning here: calibrated reads and exploits applied directly to the solved mix (item 5),
and a valuation that stops flattering aggression (items 1–2).
