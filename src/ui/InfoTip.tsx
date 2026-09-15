import { useEffect, useId, useRef, useState } from 'react'

interface InfoTipProps {
  /** The setting this explains, for the accessible name ("What is Blinds?"). */
  label: string
  children: React.ReactNode
}

/**
 * The explanation behind a setting, rather than under it.
 *
 * Eight settings each with a sentence beneath them turned the setup form into
 * something you had to scroll past to reach the button that starts a game.
 * The text is still worth having — every option here changes how a session
 * plays — but it is worth having *on demand*.
 *
 * Hover opens it where there's a pointer to hover with; that's pure CSS (see
 * `@media (hover: hover)` in menu.css), so it costs no state. The click
 * toggle exists for touch, where there is no hover at all, and doubles as a
 * way to pin the bubble open with a mouse.
 */
export function InfoTip({ label, children }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const [flipUp, setFlipUp] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)

  /**
   * Which side of the button the bubble opens on is a question about this
   * button's position in the window, which no media query can answer — so it
   * is measured. The bubble is hidden with visibility, not display, so it
   * still has a height to measure before it is shown. Below the phone
   * breakpoint it is pinned to the bottom of the screen instead and this is
   * skipped.
   */
  const toggle = () => {
    if (!open) {
      const bubble = bubbleRef.current
      const button = ref.current
      if (bubble && button && getComputedStyle(bubble).position !== 'fixed') {
        const spaceNeeded = button.getBoundingClientRect().bottom + bubble.offsetHeight + 12
        setFlipUp(spaceNeeded > window.innerHeight)
      } else {
        setFlipUp(false)
      }
    }
    setOpen((v) => !v)
  }

  // Escape closes it; so does a tap anywhere else, which on a phone is the
  // only dismissal gesture anyone will look for.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <span className={`infotip ${open ? 'infotip-open' : ''} ${flipUp ? 'infotip-up' : ''}`} ref={ref}>
      <button
        type="button"
        className="infotip-btn"
        aria-label={`What is ${label}?`}
        aria-expanded={open}
        aria-describedby={id}
        onClick={toggle}
      >
        i
      </button>
      <span className="infotip-bubble" id={id} role="tooltip" ref={bubbleRef}>
        {children}
      </span>
    </span>
  )
}
