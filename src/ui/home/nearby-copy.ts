import { P2PError, P2P_MESSAGES, type Invite, type P2PErrorCode } from '../../home/p2p'

export const NEARBY_LINE = 'Play without internet. One phone hosts, the others join over a hotspot. Works best with an Android host; hotspot behaviour varies by phone.'
export const TRUST_NOTICE = 'The host’s phone holds the deck and everyone’s cards. Play nearby only with people you trust.'
export const HOST_CODE_HINT = 'Have them scan this, or type it.'

export const CHECKLIST: readonly string[] = [
  'Every phone has opened this app once with internet, and has the same version.',
  'All phones need one shared network. An Android hotspot may work in airplane mode (untested on most phones): turn on airplane mode, then the hotspot. An iPhone hotspot needs mobile data, so iPhones join someone else’s hotspot. Plane Wi-Fi usually stops phones seeing each other.',
  'Join that network before opening the room.',
  'Keep the host’s screen on and the app open.',
]

/** What to tell a person about something that went wrong in the nearby flow. */
export function nearbyMessage(error: unknown): string {
  if (error instanceof P2PError) return error.code === 'wrong-kind' ? error.message : P2P_MESSAGES[error.code]
  return 'Something went wrong. Try again.'
}

export function messageForCode(code: P2PErrorCode): string {
  return P2P_MESSAGES[code]
}

export function inviteStatusText(invite: Pick<Invite, 'status' | 'error'>): string {
  switch (invite.status) {
    case 'waiting':
      return 'Waiting for their reply'
    case 'connecting':
      return 'Connecting…'
    case 'connected':
      return 'Connected'
    case 'failed':
      return `Failed. ${invite.error ? P2P_MESSAGES[invite.error] : P2P_MESSAGES.unreachable}`
  }
}
