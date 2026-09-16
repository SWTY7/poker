/**
 * The switch that decides whether the psychological bots are at the table.
 *
 * They are off by default. This layer is an experiment — its bots are meant
 * to be recognisably human rather than good, which means some of them are
 * meant to play badly, and a few of the biases they model produce behaviour
 * that looks like a bug until you know what it is. That is fine in a study
 * of psychology and not fine in the game somebody opens expecting a game.
 *
 * Turn them on by adding ?psych=1 to the URL, which also remembers the
 * choice; ?psych=0 turns them off again. Nothing else in the app reads this,
 * so removing the flag later is one call site.
 */
const STORAGE_KEY = 'poker.psychBots'

export function psychBotsEnabled(): boolean {
  let fromUrl: string | null = null
  try {
    fromUrl = new URLSearchParams(window.location.search).get('psych')
  } catch {
    fromUrl = null
  }

  if (fromUrl !== null) {
    const on = fromUrl === '1' || fromUrl === 'true'
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
    } catch {
      // A blocked store just means the choice does not outlive the tab.
    }
    return on
  }

  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}
