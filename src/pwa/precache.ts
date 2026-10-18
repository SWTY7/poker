/** Files in dist that must not be precached. */
export function isPrecachable(file: string): boolean {
  return file !== 'sw.js' && !file.endsWith('.map')
}

/** Normalise to forward slashes, sorted, no sw.js / source maps, no duplicates. */
export function buildPrecacheList(files: readonly string[]): string[] {
  const out = new Set<string>()
  for (const f of files) {
    const n = f.replace(/\\/g, '/').replace(/^\.?\//, '')
    if (n && isPrecachable(n)) out.add(n)
  }
  return [...out].sort()
}

/** Cache name that changes whenever the file list (names include content hashes) changes. */
export function cacheNameFor(list: readonly string[]): string {
  // Two 32-bit FNV-1a style passes (different seeds) -> 12 hex chars. No node deps.
  const s = list.join('\n')
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0
    b ^= b >>> 13
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return `poker-${(hex(a) + hex(b)).slice(0, 12)}`
}

/** Fill the template placeholders. */
export function renderSw(template: string, list: readonly string[]): string {
  return template
    .replace('__CACHE_NAME__', () => cacheNameFor(list))
    .replace('__PRECACHE__', () => JSON.stringify(list))
}
