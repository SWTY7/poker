// Runs a TypeScript entry point outside the browser and outside vitest.
//
// The repo has no ts-node or tsx, and Node's own type stripping wants file
// extensions on every import, which the source does not use. Vite already
// resolves those imports for the app and for the tests, so this borrows its
// module loader rather than adding a dependency or rewriting every import.
import { createServer } from 'vite'

const entry = process.argv[2]
if (!entry) {
  console.error('usage: node scripts/run.mjs <entry.ts> [args...]')
  process.exit(1)
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'warn' })
try {
  const module = await server.ssrLoadModule(entry)
  const main = module.default ?? module.main
  if (typeof main !== 'function') throw new Error(`${entry} has no default export to run`)
  await main(process.argv.slice(3))
} finally {
  await server.close()
}
