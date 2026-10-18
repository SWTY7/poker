# QR code generator for nearby rooms: uqr

Date: 2026-10-19. Status: accepted (made inside the offline/themes/p2p run; reversible).

## Decision
Draw the join code as a QR picture with `uqr` 0.1.3, added as a normal dependency and wrapped in `src/home/p2p/qr.ts` (`qrMatrix`). The screens render the matrix as SVG themselves.

## Facts (checked with `npm view` on 2026-10-19)
| Package | License | Unpacked size | Notes |
|---|---|---|---|
| `uqr` 0.1.3 | MIT | 79 KB | ESM, no dependencies, picks numeric/alphanumeric/byte mode by itself, tree-shakable |
| `qrcode-generator` 2.0.4 | MIT | 556 KB | the fallback in the plan; seven times larger |

`uqr` is used only for `encode()`; its renderers are not imported, so only the encoder ships. A test confirms the codes use alphanumeric mode: a 117-character code gives a 37-module (version 5) matrix, a 197-character one 45 modules (version 7).

## Why
- The plan's first choice, MIT, small, and the code is built to fit QR alphanumeric mode (upper-case letters and digits), which `uqr` selects without being told.
- A hand-written encoder was rejected in the plan: Reed-Solomon and mask selection are easy to get subtly wrong and cannot be checked against a phone here.

## Not decided here
Scanning. Chrome on Android has `BarcodeDetector`, so no library is needed there. iPhone Safari and Firefox do not, and a pure-JS decoder (jsQR, Apache-2.0, about 40 KB gzipped) is not added: that is the owner's call (queued in NEXT.md). Without it an iPhone guest types about 120 characters.
