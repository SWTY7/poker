import { encode } from 'uqr'
import { P2PError } from './contract'

/** The code as a QR picture, and a camera loop that reads one back where the browser can. */

/** The modules of a QR code for `text` (true is dark), error correction L, no quiet zone. */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: 'L', border: 0 }).data
}

/** The shape of the browser's BarcodeDetector, which TypeScript's DOM types don't include yet. */
interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
type DetectorConstructor = new (options: { formats: string[] }) => Detector

function detectorConstructor(): DetectorConstructor | undefined {
  return (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
}

/** True where the browser can read QR codes from a camera (Chrome on Android; not Safari or Firefox). */
export function qrScanSupported(): boolean {
  return detectorConstructor() !== undefined && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia !== undefined
}

const SCAN_MS = 200

/**
 * Opens the back camera into `video` and calls `onCode` with the text of each
 * QR code it sees (it keeps looking until stopped). Call it from a tap: the
 * browser asks for the camera then. Rejects P2PError camera if there is no
 * scanner or no permission. Resolves to a function that stops the scan and
 * releases the camera.
 */
export async function startQrScan(video: HTMLVideoElement, onCode: (text: string) => void): Promise<() => void> {
  const Detector = detectorConstructor()
  if (!Detector || !qrScanSupported()) throw new P2PError('camera')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  } catch {
    throw new P2PError('camera')
  }
  const detector = new Detector({ formats: ['qr_code'] })
  video.srcObject = stream
  video.muted = true
  video.setAttribute('playsinline', '')
  await video.play().catch(() => {})

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const stop = () => {
    stopped = true
    if (timer) clearTimeout(timer)
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }
  const look = async () => {
    const found = await detector.detect(video).catch(() => [])
    if (stopped) return
    if (found[0]) onCode(found[0].rawValue)
    if (!stopped) timer = setTimeout(look, SCAN_MS)
  }
  void look()
  return stop
}
