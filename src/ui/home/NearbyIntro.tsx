import { Frame } from './HomeEntry'
import { CHECKLIST, NEARBY_LINE, TRUST_NOTICE } from './nearby-copy'

/** Before hosting or joining without internet: what has to be true, and who to trust. */
export function NearbyIntro({ onHost, onJoin, onBack }: { onHost: () => void; onJoin: () => void; onBack: () => void }) {
  return (
    <Frame title="Nearby" subtitle={NEARBY_LINE} onBack={onBack}>
      <section>
        <h2 className="menu-section">Before you start</h2>
        <ol className="nearby-checklist">
          {CHECKLIST.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
      <div className="menu-divider" />
      <p className="nearby-trust">{TRUST_NOTICE}</p>
      <div className="nearby-actions">
        <button type="button" className="btn menu-start nearby-btn" onClick={onHost}>
          Host nearby
        </button>
        <button type="button" className="btn btn-secondary nearby-btn" onClick={onJoin}>
          Join nearby
        </button>
      </div>
    </Frame>
  )
}
