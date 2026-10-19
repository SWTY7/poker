import { describe, expect, it } from 'vitest'
import { buildPrecacheList, cacheNameFor, renderSw } from '../../src/pwa/precache'

describe('buildPrecacheList', () => {
  it('keeps every file except sw.js and maps, normalised and sorted', () => {
    const list = buildPrecacheList([
      'index.html',
      'sw.js',
      'assets\\index-abc.js',
      'assets/index-abc.js.map',
      './favicon.svg',
      'assets/index-abc.js',
      'icons/icon-192.png',
    ])
    expect(list).toEqual(['assets/index-abc.js', 'favicon.svg', 'icons/icon-192.png', 'index.html'])
  })
})

describe('cacheNameFor', () => {
  it('changes with the list and is stable otherwise', () => {
    expect(cacheNameFor(['a', 'b'])).toBe(cacheNameFor(['a', 'b']))
    expect(cacheNameFor(['a', 'b'])).not.toBe(cacheNameFor(['a', 'c']))
    expect(cacheNameFor(['a'])).toMatch(/^poker-[0-9a-f]{12}$/)
  })

  it('changes when the salt (contents of unhashed files) changes', () => {
    expect(cacheNameFor(['a'], 'one')).not.toBe(cacheNameFor(['a'], 'two'))
  })
})

describe('renderSw', () => {
  it('embeds the name and the list', () => {
    const out = renderSw("const CACHE = '__CACHE_NAME__'\nconst PRECACHE = __PRECACHE__\n", ['x.js', 'index.html'])
    expect(out).toContain(`const CACHE = '${cacheNameFor(['x.js', 'index.html'])}'`)
    expect(out).toContain('const PRECACHE = ["x.js","index.html"]')
  })
})
