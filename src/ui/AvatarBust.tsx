import { bustSpec } from './avatar'

/** Character bust, drawn from the player's name. Decorative; the parent hides it from assistive tech. */
export function AvatarBust({ name }: { name: string }) {
  const { skin, hair, backdrop, style, eyewear, shades } = bustSpec(name)
  const ink = '#1c1410'
  return (
    <svg className="avatar-bust" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect width="100" height="100" fill={backdrop} />
      <circle cx="50" cy="40" r="60" fill="#fff" opacity=".08" />
      <path d="M12 100 Q14 74 50 72 Q86 74 88 100Z" fill="#14110d" />
      <path d="M42 72 L50 84 L58 72Z" fill="#f6f1e4" />
      <rect x="44" y="60" width="12" height="14" fill={skin} />
      <ellipse cx="50" cy="46" rx="21" ry="25" fill={skin} />
      {style === 0 && <path d="M28 44 Q28 18 50 18 Q72 18 72 44 Q64 32 50 32 Q36 32 28 44Z" fill={hair} />}
      {style === 1 && <path d="M26 56 Q22 16 50 16 Q78 16 74 56 Q70 34 50 34 Q30 34 26 56Z" fill={hair} />}
      {style === 3 && <path d="M28 46 Q28 24 50 24 Q72 24 72 46 Q60 36 50 36 Q40 36 28 46Z" fill={hair} />}
      {style === 4 && (
        <>
          <path d="M27 50 Q24 18 50 18 Q76 18 73 50 Q68 30 50 30 Q32 30 27 50Z" fill={hair} />
          <circle cx="50" cy="14" r="7" fill={hair} />
        </>
      )}
      {eyewear === 0 && (
        <>
          <circle cx="42" cy="50" r="2.6" fill={ink} />
          <circle cx="58" cy="50" r="2.6" fill={ink} />
        </>
      )}
      {eyewear === 1 && (
        <>
          <rect x="34" y="45" width="14" height="10" rx="3" fill={shades} />
          <rect x="52" y="45" width="14" height="10" rx="3" fill={shades} />
          <rect x="48" y="49" width="4" height="2" fill={shades} />
        </>
      )}
      {eyewear === 2 && (
        <>
          <circle cx="42" cy="50" r="6" fill="none" stroke={ink} strokeWidth="1.8" />
          <circle cx="58" cy="50" r="6" fill="none" stroke={ink} strokeWidth="1.8" />
          <circle cx="42" cy="50" r="2" fill={ink} />
          <circle cx="58" cy="50" r="2" fill={ink} />
        </>
      )}
      <path d="M43 62 Q50 67 57 62" stroke="#5a2a1a" strokeWidth="2" fill="none" strokeLinecap="round" />
      {style === 2 && (
        <>
          <path d="M24 36 Q50 22 76 36 L76 40 L24 40Z" fill="#14110d" />
          <path d="M30 38 Q50 8 70 38Z" fill="#14110d" />
          <rect x="30" y="31" width="40" height="5" fill="#b98a2e" />
        </>
      )}
      {style === 3 && (
        <>
          <path d="M28 34 Q50 14 72 34 Q60 28 50 28 Q40 28 28 34Z" fill={backdrop} />
          <path d="M24 36 L48 34 L48 38 L24 40Z" fill={backdrop} />
        </>
      )}
    </svg>
  )
}
