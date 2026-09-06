/**
 * Small stroke-based icons shared across the table and menu screens. Kept
 * inline (not an icon package) since the set is tiny and every icon needs to
 * inherit `currentColor` for hover/active/theme states.
 */
interface IconProps {
  className?: string
}

export function ChipIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <line x1="12" y1="1.5" x2="12" y2="4.5" strokeLinecap="round" />
      <line x1="12" y1="19.5" x2="12" y2="22.5" strokeLinecap="round" />
      <line x1="1.5" y1="12" x2="4.5" y2="12" strokeLinecap="round" />
      <line x1="19.5" y1="12" x2="22.5" y2="12" strokeLinecap="round" />
    </svg>
  )
}

export function BlindsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="9" r="6" />
      <circle cx="16" cy="15" r="6" />
    </svg>
  )
}

export function AnteIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path
        d="M12 7.5v9M9.3 15.3c0 1.1 1.1 1.7 2.7 1.7s2.7-.7 2.7-1.9c0-2.6-5.4-1.2-5.4-3.7 0-1.2 1.1-1.9 2.7-1.9s2.7.6 2.7 1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function PeopleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M15.5 14.2c2.6.3 4.5 2.4 4.5 5.8" />
    </svg>
  )
}

export function PersonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20c0-4 3-6.6 7-6.6s7 2.6 7 6.6" />
    </svg>
  )
}

export function DealIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="13" height="17" rx="2" transform="rotate(-8 9 13)" />
      <rect x="8" y="4" width="13" height="17" rx="2" />
    </svg>
  )
}

export function FoldIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
      <path d="M6 6 L18 18" />
      <path d="M18 6 L6 18" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 13 L9.5 18.5 L20 6" />
    </svg>
  )
}

export function RaiseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 15 L12 8 L18 15" />
    </svg>
  )
}
