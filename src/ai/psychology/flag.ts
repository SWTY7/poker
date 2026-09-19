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
  return flagEnabled('psych', STORAGE_KEY)
}

/**
 * The solved bot, which is a separate switch because it is a separate claim.
 *
 * The psychological bots are meant to be human; this one is meant to be
 * right, and only in the game it was solved for — heads-up, around the stack
 * depth it was trained at. Add ?gto=1 to the URL.
 */
export function blueprintBotsEnabled(): boolean {
  return flagEnabled('gto', 'poker.blueprintBots')
}

function flagEnabled(parameter: string, storageKey: string): boolean {
  let fromUrl: string | null = null
  try {
    fromUrl = new URLSearchParams(window.location.search).get(parameter)
  } catch {
    fromUrl = null
  }

  if (fromUrl !== null) {
    const on = fromUrl === '1' || fromUrl === 'true'
    try {
      localStorage.setItem(storageKey, on ? 'on' : 'off')
    } catch {
      // A blocked store just means the choice does not outlive the tab.
    }
    return on
  }

  try {
    return localStorage.getItem(storageKey) === 'on'
  } catch {
    return false
  }
}
