import { useState } from 'react'
import { CODE_INPUT_MAX, groupCode, P2P_MESSAGES, qrScanSupported, type Invite } from '../../home/p2p'
import { QrCode } from './QrCode'
import { NearbyScan } from './NearbyScan'
import { HOST_CODE_HINT, inviteStatusText } from './nearby-copy'

interface InviteSheetProps {
  /** The code on show: the newest invite nobody has answered yet. */
  invite: Invite | null
  /** Every invite, for the status lines. */
  invites: Invite[]
  busy: boolean
  problem: string | null
  onNew: () => void
  /** The reply code, scanned or typed. */
  onReply: (code: string) => void
  /** Asks for camera permission, so this phone shows a real address instead of a `.local` name. */
  onAllowCamera: () => void
  onClose: () => void
}

/** "Add a player": the host's code to scan or type, and a place to put the reply back. */
export function InviteSheet({ invite, invites, busy, problem, onNew, onReply, onAllowCamera, onClose }: InviteSheetProps) {
  const [mode, setMode] = useState<'none' | 'type' | 'scan'>('none')
  const [text, setText] = useState('')
  const canScan = qrScanSupported()

  return (
    <section className="nearby-sheet" aria-labelledby="nearby-add">
      <div className="nearby-sheet-head">
        <h2 id="nearby-add" className="menu-section">
          Add a player
        </h2>
        <button type="button" className="menu-back-link" onClick={onClose}>
          Done
        </button>
      </div>

      {invite ? (
        <>
          <div className="nearby-invite">
            <QrCode text={invite.code} label="Code for the next player to scan" />
            <div className="nearby-invite-side">
              <p className="nearby-code" aria-label="Code to type">
                {groupCode(invite.code)}
              </p>
              <p className="menu-hint nearby-hint">{HOST_CODE_HINT}</p>
            </div>
          </div>

          {invite.mdnsOnly && (
            <div className="nearby-mdns">
              <p className="menu-hint nearby-hint">{P2P_MESSAGES.mdnsOnly}</p>
              <button type="button" className="btn btn-secondary nearby-btn" disabled={busy} onClick={onAllowCamera}>
                Allow camera
              </button>
            </div>
          )}

          {mode === 'scan' ? (
            <NearbyScan
              onCode={(code) => {
                setMode('none')
                onReply(code)
              }}
              onCancel={() => setMode('none')}
            />
          ) : (
            <div className="nearby-actions">
              {canScan && (
                <button type="button" className="btn nearby-btn" disabled={busy} onClick={() => setMode('scan')}>
                  Scan their reply
                </button>
              )}
              <button type="button" className={`btn nearby-btn ${canScan ? 'btn-secondary' : ''}`} disabled={busy} onClick={() => setMode('type')}>
                Type their reply
              </button>
            </div>
          )}

          {mode === 'type' && (
            <div className="nearby-type">
              <textarea
                className="nearby-textarea"
                value={text}
                rows={4}
                maxLength={CODE_INPUT_MAX}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Their reply code"
                aria-label="Their reply code"
                onChange={(e) => setText(e.target.value)}
              />
              <button
                type="button"
                className="btn nearby-btn"
                disabled={busy || text.trim() === ''}
                onClick={() => {
                  onReply(text)
                  setText('')
                  setMode('none')
                }}
              >
                Connect
              </button>
            </div>
          )}
        </>
      ) : (
        <button type="button" className="btn nearby-btn" disabled={busy} onClick={onNew}>
          {busy ? 'Making a code…' : 'Make a code'}
        </button>
      )}

      {problem && <p className="nearby-problem">{problem}</p>}

      {invites.length > 0 && (
        <ul className="nearby-invites">
          {invites.map((item, i) => (
            <li key={item.id} className={`nearby-invite-row nearby-${item.status}`}>
              <span>Invite {i + 1}</span>
              <span>{inviteStatusText(item)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
