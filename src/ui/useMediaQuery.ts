import { useEffect, useState } from 'react'

/**
 * Subscribes to a CSS media query from JS. Used where a phone layout isn't
 * just "the same controls, smaller" but a genuinely different arrangement —
 * CSS alone can restyle a row of buttons, it can't move them into a sheet.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}
