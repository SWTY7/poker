// Post-build PWA check. Run after `npm run build`.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const errors = []
const fail = (m) => errors.push(m)

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

function pngSize(file) {
  const b = readFileSync(file)
  if (b.length < 24 || b.toString('latin1', 1, 4) !== 'PNG') return null
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`
}

if (!existsSync(dist)) {
  console.error('check-pwa: dist/ missing; run npm run build first')
  process.exit(1)
}

// manifest
let manifest = null
try {
  manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'))
} catch (e) {
  fail(`manifest.webmanifest missing or invalid JSON: ${e.message}`)
}
if (manifest) {
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color', 'icons']) {
    if (!manifest[k] || (Array.isArray(manifest[k]) && manifest[k].length === 0)) fail(`manifest: missing "${k}"`)
  }
  if (manifest.display !== 'standalone') fail('manifest: display must be "standalone"')
  for (const k of ['start_url', 'scope']) {
    if (/^(https?:)?\/\//.test(manifest[k] ?? '') || (manifest[k] ?? '').startsWith('/')) fail(`manifest: ${k} must be relative`)
  }
  for (const icon of manifest.icons ?? []) {
    const f = join(dist, icon.src)
    if (!existsSync(f)) {
      fail(`manifest icon missing: ${icon.src}`)
      continue
    }
    const actual = pngSize(f)
    if (actual !== icon.sizes) fail(`manifest icon ${icon.src}: stated ${icon.sizes}, actual ${actual}`)
  }
}
if (!existsSync(join(dist, 'icons', 'apple-touch-icon.png'))) fail('icons/apple-touch-icon.png missing')

// service worker
const swPath = join(dist, 'sw.js')
if (!existsSync(swPath)) {
  fail('sw.js missing')
} else {
  const sw = readFileSync(swPath, 'utf8')
  const m = sw.match(/const PRECACHE = (\[.*\])\s*$/m)
  let list = []
  try {
    list = JSON.parse(m[1])
  } catch {
    fail('sw.js: could not read the PRECACHE list')
  }
  const set = new Set(list)
  const files = walk(dist)
    .map((f) => f.slice(dist.length + 1).replace(/\\/g, '/'))
    .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
  for (const f of files) if (!set.has(f)) fail(`sw.js precache is missing ${f}`)
  for (const f of list) if (!existsSync(join(dist, f))) fail(`sw.js precaches a file that does not exist: ${f}`)
  if (/skipWaiting\(\)/.test(sw.split("addEventListener('install'")[1]?.split("addEventListener('activate'")[0] ?? '')) {
    fail('sw.js: install handler must not call skipWaiting')
  }
}

// no external URLs
const html = readFileSync(join(dist, 'index.html'), 'utf8')
if (/https?:\/\//.test(html)) fail('index.html references an http(s) URL')
for (const f of walk(dist)) {
  if (!/\.(css|js)$/.test(f)) continue
  const text = readFileSync(f, 'utf8')
  if (/fonts\.googleapis|fonts\.gstatic/.test(text)) fail(`${f.slice(dist.length + 1)} references Google Fonts`)
}

if (errors.length) {
  console.error('check-pwa FAILED:')
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log('check-pwa OK')
