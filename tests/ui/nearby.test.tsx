import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { P2PError, P2P_MESSAGES, type Invite, type P2PErrorCode } from '../../src/home/p2p'
import { InviteSheet } from '../../src/ui/home/InviteSheet'
import { NearbyIntro } from '../../src/ui/home/NearbyIntro'
import { ReplyPanel } from '../../src/ui/home/NearbyJoin'
import { HostEntry } from '../../src/ui/home/HomeEntry'
import { inviteStatusText, messageForCode, nearbyMessage, TRUST_NOTICE } from '../../src/ui/home/nearby-copy'
import { Lobby, type LobbyProps } from '../../src/ui/Lobby'
import { RoomLobby } from '../../src/ui/RoomLobby'
import { defaultProfile } from '../../src/game/profile'

const noop = () => undefined
const invite: Invite = { id: 'a', code: 'P1H0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJKMNPQRSTVWXYZ', status: 'waiting', mdnsOnly: false }

function sheet(i: Invite): string {
  return renderToString(<InviteSheet invite={i} invites={[i]} busy={false} problem={null} onNew={noop} onReply={noop} onAllowCamera={noop} onClose={noop} />)
}

describe('nearby screens', () => {
  it('intro shows the checklist and the trust notice', () => {
    const html = renderToString(<NearbyIntro onHost={noop} onJoin={noop} onBack={noop} />)
    expect(html).toContain('Play without internet')
    expect(html).toContain('hotspot behaviour varies by phone')
    expect(html).not.toContain('Play on a plane')
    expect(html).toContain('Host nearby')
    expect(html).toContain('Join nearby')
    expect(html).toContain('opened this app once with internet')
    expect(html).toContain('Play nearby only with people you trust')
    expect(TRUST_NOTICE).toContain('holds the deck and everyone')
  })

  it('host setup shows the trust notice', () => {
    const html = renderToString(<HostEntry nearby initialName="" onOpen={async () => null} onBack={noop} />)
    expect(html).toContain('Play nearby only with people you trust')
    expect(html).toContain('Open the table')
  })

  it('invite sheet renders an SVG QR, the grouped code and the typing box', () => {
    const html = sheet(invite)
    expect(html).toContain('<svg class="nearby-qr"')
    expect(html).toContain('Have them scan this, or type it.')
    expect(html).toContain('P1H0 1234')
    expect(html).toContain('Type their reply')
    expect(html).toContain('Waiting for their reply')
  })

  it('the mDNS hint and camera button appear only when the invite needs them', () => {
    expect(sheet(invite)).not.toContain(P2P_MESSAGES.mdnsOnly)
    const html = sheet({ ...invite, mdnsOnly: true })
    expect(html).toContain(P2P_MESSAGES.mdnsOnly)
    expect(html).toContain('Allow camera')
  })

  it('the guest reply panel shows a QR and the words for the host', () => {
    const html = renderToString(<ReplyPanel reply="P1G0123456789ABCDEFGH" />)
    expect(html).toContain('<svg class="nearby-qr"')
    expect(html).toContain('Show this to the host.')
  })

  it('the guest reply panel offers the camera only when its reply is .local only', () => {
    const plain = renderToString(<ReplyPanel reply="P1G0123456789ABCDEFGH" mdnsOnly={false} onAllowCamera={noop} />)
    expect(plain).not.toContain('Allow camera')
    const local = renderToString(<ReplyPanel reply="P1G0123456789ABCDEFGH" mdnsOnly onAllowCamera={noop} />)
    expect(local).toContain('Allow camera')
    expect(local).toContain(P2P_MESSAGES.mdnsOnly)
  })

  it('has a message for every error code, and failed invites say why', () => {
    const codes: P2PErrorCode[] = ['typo', 'wrong-kind', 'version', 'no-network', 'unreachable', 'stale', 'unsupported', 'camera']
    for (const code of codes) {
      expect(messageForCode(code)).toBe(P2P_MESSAGES[code])
      expect(inviteStatusText({ status: 'failed', error: code })).toContain(P2P_MESSAGES[code])
      expect(nearbyMessage(new P2PError(code))).toBeTruthy()
    }
    expect(nearbyMessage(new P2PError('wrong-kind', 'That is a host code.'))).toBe('That is a host code.')
    expect(nearbyMessage(new Error('x'))).toBe('Something went wrong. Try again.')
  })
})

describe('lobby doors', () => {
  afterEach(() => vi.unstubAllGlobals())
  const props: LobbyProps = {
    profile: defaultProfile(),
    mode: 'home',
    onModeChange: noop,
    onChooseQuick: noop,
    onClaimDailyStake: noop,
    onResetProfile: noop,
    onChooseCash: noop,
    onChooseTournament: noop,
    career: { tier: 0, season: 1, eventIndex: 0, lastSeason: null } as unknown as LobbyProps['career'],
    onChooseCareer: noop,
    savedRoom: null,
    onHostGame: noop,
    onResumeRoom: noop,
    onJoinGame: noop,
    onOpenYourPlay: noop,
    onOpenSettings: noop,
    onNearby: noop,
  }

  for (const [name, View] of [
    ['classic', Lobby],
    ['realistic', RoomLobby],
  ] as const) {
    it(`${name} lobby has the Nearby door where WebRTC exists`, () => {
      vi.stubGlobal('RTCPeerConnection', class {})
      expect(renderToString(<View {...props} />)).toContain('Nearby (no internet)')
    })
    it(`${name} lobby hides it without WebRTC`, () => {
      expect(renderToString(<View {...props} />)).not.toContain('Nearby (no internet)')
    })
  }
})

describe('QR tile colours', () => {
  const css = readFileSync(resolve(__dirname, '../../src/styles/room-lobby.css'), 'utf8')
  it('is white with dark modules, and no theme or mode overrides it', () => {
    const rule = css.match(/\.nearby-qr\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/background:\s*#fff\s*;/)
    expect(rule).toMatch(/color:\s*#000\s*;/)
    expect(css).not.toMatch(/data-(theme|mode)[^{]*\.nearby-qr/)
    for (const file of ['theme-classic.css', 'theme-realistic.css']) {
      expect(readFileSync(resolve(__dirname, '../../src/styles', file), 'utf8')).not.toContain('nearby-qr')
    }
  })
})
