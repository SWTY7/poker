import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { buildPrecacheList, renderSw } from './src/pwa/precache.ts'

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

/** Writes dist/sw.js listing every built file for offline use. */
function serviceWorker(): Plugin {
  let outDir = 'dist'
  let root = process.cwd()
  return {
    name: 'poker-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir
      root = c.root
    },
    closeBundle() {
      const dist = join(root, outDir)
      const files = walk(dist).map((f) => relative(dist, f))
      const list = buildPrecacheList(files)
      const template = readFileSync(join(root, 'src/pwa/sw-template.js'), 'utf8')
      writeFileSync(join(dist, 'sw.js'), renderSw(template, list))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
})
