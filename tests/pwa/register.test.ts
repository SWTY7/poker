import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyUpdate,
  getUpdateReady,
  registerServiceWorker,
  resetForTests,
  subscribeUpdate,
} from '../../src/pwa/register'

type Handler = () => void

function makeEnv(opts: { controller: boolean; waiting: boolean }) {
  const swListeners: Record<string, Handler[]> = {}
  const regListeners: Record<string, Handler[]> = {}
  const waiting = { postMessage: vi.fn() }
  const reg = {
    waiting: opts.waiting ? waiting : null,
    installing: null as null | { state: string; addEventListener: (t: string, h: Handler) => void },
    update: vi.fn(() => Promise.resolve()),
    addEventListener: (t: string, h: Handler) => (regListeners[t] ??= []).push(h),
  }
  const serviceWorker = {
    controller: opts.controller ? {} : null,
    register: vi.fn(() => Promise.resolve(reg)),
    addEventListener: (t: string, h: Handler) => (swListeners[t] ??= []).push(h),
  }
  const docListeners: Record<string, Handler[]> = {}
  const reload = vi.fn()
  vi.stubGlobal('navigator', { serviceWorker })
  vi.stubGlobal('document', {
    readyState: 'complete',
    visibilityState: 'visible',
    addEventListener: (t: string, h: Handler) => (docListeners[t] ??= []).push(h),
  })
  vi.stubGlobal('window', { location: { reload }, addEventListener: vi.fn() })
  return { reg, serviceWorker, waiting, swListeners, regListeners, docListeners, reload }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  resetForTests()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('registerServiceWorker', () => {
  it('does nothing when disabled (dev)', () => {
    const env = makeEnv({ controller: false, waiting: false })
    expect(registerServiceWorker({ enabled: false })).toBe(false)
    expect(env.serviceWorker.register).not.toHaveBeenCalled()
  })

  it('registers ./sw.js in production', async () => {
    const env = makeEnv({ controller: false, waiting: false })
    expect(registerServiceWorker({ enabled: true })).toBe(true)
    await flush()
    expect(env.serviceWorker.register).toHaveBeenCalledWith('./sw.js')
    expect(getUpdateReady()).toBe(false)
  })

  it('a first install is not an update', async () => {
    makeEnv({ controller: false, waiting: true })
    registerServiceWorker({ enabled: true })
    await flush()
    expect(getUpdateReady()).toBe(false)
  })

  it('flags an update when a worker is already waiting under a controller', async () => {
    makeEnv({ controller: true, waiting: true })
    const seen = vi.fn()
    subscribeUpdate(seen)
    registerServiceWorker({ enabled: true })
    await flush()
    expect(getUpdateReady()).toBe(true)
    expect(seen).toHaveBeenCalled()
  })

  it('flags an update when a new worker finishes installing', async () => {
    const env = makeEnv({ controller: true, waiting: false })
    registerServiceWorker({ enabled: true })
    await flush()
    expect(getUpdateReady()).toBe(false)
    const worker = { state: 'installing', handlers: [] as Handler[], addEventListener(_t: string, h: Handler) { this.handlers.push(h) } }
    env.reg.installing = worker
    env.regListeners.updatefound.forEach((h) => h())
    worker.state = 'installed'
    env.reg.waiting = env.waiting
    worker.handlers.forEach((h) => h())
    expect(getUpdateReady()).toBe(true)
  })

  it('checks for updates on visibility and every 30 minutes', async () => {
    const env = makeEnv({ controller: true, waiting: false })
    registerServiceWorker({ enabled: true })
    await flush()
    env.docListeners.visibilitychange.forEach((h) => h())
    expect(env.reg.update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30 * 60 * 1000)
    expect(env.reg.update).toHaveBeenCalledTimes(2)
  })
})

describe('applyUpdate', () => {
  it('posts SKIP_WAITING and reloads once on controllerchange', async () => {
    const env = makeEnv({ controller: true, waiting: true })
    registerServiceWorker({ enabled: true })
    await flush()
    applyUpdate()
    expect(env.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    env.swListeners.controllerchange.forEach((h) => h())
    env.swListeners.controllerchange.forEach((h) => h())
    expect(env.reload).toHaveBeenCalledTimes(1)
  })

  it('is a no-op with no waiting worker', async () => {
    const env = makeEnv({ controller: true, waiting: false })
    registerServiceWorker({ enabled: true })
    await flush()
    applyUpdate()
    expect(env.waiting.postMessage).not.toHaveBeenCalled()
  })
})
