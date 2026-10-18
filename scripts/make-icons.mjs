// Renders the PWA icons from public/favicon.svg into public/icons/.
// Dev-only: uses `sharp`, which is already installed (transitively, via wrangler).
// Run: node scripts/make-icons.mjs
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'icons')
mkdirSync(out, { recursive: true })

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.error('make-icons: `sharp` is not installed (it comes with wrangler). Run npm install.')
  process.exit(1)
}

const svg = readFileSync(join(root, 'public', 'favicon.svg'))
const BG = '#100e0c'

// "any": the chip fills the square (the favicon is already a round chip).
async function plain(size, name) {
  await sharp(svg, { density: (72 * size) / 32 }).resize(size, size).png().toFile(join(out, name))
}

// Maskable / apple: chip on the solid UI background with a safe margin (chip = 70% of the side).
async function padded(size, name, ratio) {
  const inner = Math.round(size * ratio)
  const chip = await sharp(svg, { density: (72 * inner) / 32 }).resize(inner, inner).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: chip, gravity: 'centre' }])
    .png()
    .toFile(join(out, name))
}

await plain(192, 'icon-192.png')
await plain(512, 'icon-512.png')
await padded(512, 'icon-maskable-512.png', 0.7)
await padded(180, 'apple-touch-icon.png', 0.86)
console.log('icons written to', out)
