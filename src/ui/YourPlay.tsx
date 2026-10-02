import { useMemo, useState } from 'react'
import { clearReview, exportReview, loadReview, type ActionKind, type HandRecord } from '../review/log'
import { styleProfile, BIG_LOSS_BB, TILT_WINDOW, type Stat } from '../review/style'
import { findLeaks } from '../review/leaks'
import { SUIT_PATH } from './suit-icons'

interface YourPlayProps {
  onBack: () => void
}

const KIND_WORDS: Record<ActionKind, string> = { fold: 'fold', passive: 'check or call', aggressive: 'bet or raise' }

/** A stat as a percentage, or a dash with nothing to measure it over. */
function percent(stat: Stat): string {
  return stat.rate === null ? '—' : `${Math.round(stat.rate * 100)}%`
}

/**
 * The player's own style, from their hand history (review/): the numbers
 * players describe each other with, where the play departs from the solve,
 * and whether it changes after a big loss. Every number shows what it was
 * measured over; one from a dozen chances is a rumour, not a style.
 */
export function YourPlay({ onBack }: YourPlayProps) {
  const [hands, setHands] = useState<HandRecord[]>(() => loadReview().hands)
  const [scope, setScope] = useState<'all' | 'last'>('all')
  const [confirmingClear, setConfirmingClear] = useState(false)

  const lastSession = hands.length > 0 ? hands[hands.length - 1].session : null
  const shown = useMemo(
    () => (scope === 'last' && lastSession ? hands.filter((h) => h.session === lastSession) : hands),
    [hands, scope, lastSession],
  )
  const profile = useMemo(() => styleProfile(shown), [shown])
  const leaks = useMemo(() => findLeaks(shown), [shown])

  const download = () => {
    const blob = new Blob([exportReview()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `poker-hands-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const stats: { label: string; value: string; detail: string }[] = [
    { label: 'VPIP', value: percent(profile.vpip), detail: `${profile.vpip.count}/${profile.vpip.of} hands` },
    { label: 'PFR', value: percent(profile.pfr), detail: `${profile.pfr.count}/${profile.pfr.of} hands` },
    { label: '3-bet', value: percent(profile.threeBet), detail: `${profile.threeBet.count}/${profile.threeBet.of} chances` },
    {
      label: 'Aggression',
      value: profile.aggressionFactor.value === null ? '—' : profile.aggressionFactor.value.toFixed(1),
      detail: `${profile.aggressionFactor.aggressive} bets / ${profile.aggressionFactor.calls} calls`,
    },
    { label: 'C-bet', value: percent(profile.cbet), detail: `${profile.cbet.count}/${profile.cbet.of} chances` },
    { label: 'Fold to c-bet', value: percent(profile.foldToCbet), detail: `${profile.foldToCbet.count}/${profile.foldToCbet.of} faced` },
    { label: 'Showdown', value: percent(profile.wtsd), detail: `${profile.wtsd.count}/${profile.wtsd.of} flops seen` },
    { label: 'Won at showdown', value: percent(profile.wsd), detail: `${profile.wsd.count}/${profile.wsd.of} showdowns` },
  ]

  const { tilt } = profile

  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.hearts} />
      </svg>
      <svg className="menu-watermark menu-watermark-b" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.spades} />
      </svg>

      <div className="menu-content">
        <div className="menu-wordmark-row">
          <div className="menu-wordmark">
            <span className="menu-wordmark-text">Your play</span>
          </div>
          <div className="menu-subtitle">From your own hand history. Every number shows what it was measured over.</div>
          <div className="menu-bankroll-row">
            <button type="button" className="menu-back-link" onClick={onBack}>
              ← Back to the lobby
            </button>
          </div>
        </div>

        <div className="menu-card lobby-card your-play-card">
          {hands.length === 0 ? (
            <p className="your-play-empty">
              No hands yet. Play a solo cash game or tournament and every hand you're dealt is kept here, on this
              device only.
            </p>
          ) : (
            <>
              <div className="menu-options your-play-scope" role="group" aria-label="Which hands">
                <button
                  type="button"
                  className={`menu-option ${scope === 'all' ? 'menu-option-on' : ''}`}
                  onClick={() => setScope('all')}
                >
                  All hands ({hands.length})
                </button>
                <button
                  type="button"
                  className={`menu-option ${scope === 'last' ? 'menu-option-on' : ''}`}
                  onClick={() => setScope('last')}
                >
                  Last session
                </button>
              </div>

              <section className="your-play-headline">
                <span className="lobby-stat-value">{profile.hands.toLocaleString()} hands</span>
                {profile.bbPer100 !== null && (
                  <span className={profile.bbPer100 >= 0 ? 'cashout-up' : 'cashout-down'}>
                    {profile.bbPer100 >= 0 ? '+' : '−'}
                    {Math.abs(profile.bbPer100).toFixed(1)} big blinds per 100 hands
                  </span>
                )}
                {profile.hands < 100 && (
                  <span className="your-play-note">Under 100 hands: even VPIP and PFR are still settling.</span>
                )}
              </section>

              <div className="menu-divider" />

              <section>
                <h2 className="menu-section">Style</h2>
                <div className="your-play-stats">
                  {stats.map((s) => (
                    <div key={s.label} className="lobby-stat">
                      <span className="lobby-stat-value">{s.value}</span>
                      <span className="lobby-stat-label">{s.label}</span>
                      <span className="your-play-detail">{s.detail}</span>
                    </div>
                  ))}
                </div>
              </section>

              <div className="menu-divider" />

              <section className="your-play-section">
                <h2 className="menu-section">Against the solved strategy</h2>
                {leaks.covered === 0 ? (
                  <p className="your-play-note">
                    None of these decisions had a solve to compare with. The solve covers heads-up pots at the trained
                    depths and preflop with three or more players.
                  </p>
                ) : (
                  <>
                    <p className="your-play-note">
                      {leaks.onBook} of {leaks.covered} decisions ({Math.round((leaks.onBook / leaks.covered) * 100)}%)
                      were something the solve does at least 10% of the time in that spot. A rare play once isn't a
                      mistake; a habit is.
                    </p>
                    {leaks.leaks.length > 0 && (
                      <ul className="your-play-leaks">
                        {leaks.leaks.map((leak) => (
                          <li key={`${leak.spot}-${leak.did}`}>
                            <strong>{leak.spot}:</strong> you {KIND_WORDS[leak.did]} where the solve mostly{' '}
                            {pluralVerb(KIND_WORDS[leak.bookPrefers])} — {leak.count} of {leak.of} times.
                          </li>
                        ))}
                      </ul>
                    )}
                    {leaks.oneOffs > 0 && (
                      <p className="your-play-note">
                        {leaks.oneOffs} other off-book {leaks.oneOffs === 1 ? 'play hasn’t' : 'plays haven’t'} repeated
                        in the same spot yet, so {leaks.oneOffs === 1 ? 'it isn’t' : 'they aren’t'} listed.
                      </p>
                    )}
                  </>
                )}
              </section>

              <div className="menu-divider" />

              <section className="your-play-section">
                <h2 className="menu-section">After a big loss</h2>
                {tilt.bigLosses === 0 ? (
                  <p className="your-play-note">No pot of {BIG_LOSS_BB} big blinds or more lost yet.</p>
                ) : tilt.after.vpip.of === 0 ? (
                  <p className="your-play-note">
                    {tilt.bigLosses === 1 ? 'One pot' : `${tilt.bigLosses} pots`} of {BIG_LOSS_BB}+ big blinds lost, but no
                    hands played straight after one in the same sitting yet.
                  </p>
                ) : (
                  <p className="your-play-note">
                    In the {TILT_WINDOW} hands after losing {BIG_LOSS_BB}+ big blinds ({tilt.bigLosses}{' '}
                    {tilt.bigLosses === 1 ? 'time' : 'times'}, {tilt.after.vpip.of} hands), you played{' '}
                    <strong>{percent(tilt.after.vpip)}</strong> of hands and raised <strong>{percent(tilt.after.pfr)}</strong>.
                    Otherwise: {percent(tilt.otherwise.vpip)} and {percent(tilt.otherwise.pfr)}.
                  </p>
                )}
              </section>

              <div className="menu-divider" />

              <div className="your-play-actions">
                <button type="button" className="btn btn-secondary" onClick={download}>
                  Download hand history (JSON)
                </button>
                {confirmingClear ? (
                  <span className="lobby-reset-confirm">
                    Delete every logged hand?
                    <button
                      type="button"
                      className="lobby-reset-link"
                      onClick={() => {
                        clearReview()
                        setHands([])
                        setConfirmingClear(false)
                      }}
                    >
                      Yes, delete
                    </button>
                    <button type="button" className="lobby-reset-link" onClick={() => setConfirmingClear(false)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="lobby-reset-link" onClick={() => setConfirmingClear(true)}>
                    Delete hand history
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** "check or call" → "checks or calls". */
function pluralVerb(words: string): string {
  return words
    .split(' ')
    .map((w) => (w === 'or' ? w : `${w}s`))
    .join(' ')
}
