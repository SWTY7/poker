/* Poker service worker. Generated into dist/sw.js at build time. */
const CACHE = '__CACHE_NAME__'
const PRECACHE = __PRECACHE__

const scope = self.registration.scope
const abs = (p) => new URL(p, scope).href
const PRECACHED = new Set(PRECACHE.map(abs))

// No skipWaiting here: a new version waits until the page asks for it.
self.addEventListener('install', (event) => {
  // cache: 'reload' skips the HTTP cache, so a fresh deploy never installs a stale index.html.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(abs(p), { cache: 'reload' })))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    // Network first; offline falls back to this version's own precached index.html.
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(abs('./index.html')).then((hit) => hit || caches.match(abs('./'))),
      ),
    )
    return
  }

  const key = url.origin + url.pathname
  if (!PRECACHED.has(key)) return
  event.respondWith(caches.match(key).then((hit) => hit || fetch(req)))
})
