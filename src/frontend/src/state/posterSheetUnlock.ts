const REQUIRED_CLICKS = 7
const WINDOW_MS = 5000

let clicks = 0
let timer: ReturnType<typeof setTimeout> | null = null

export function registerPosterViewClick(): boolean {
  clicks++
  if (timer) clearTimeout(timer)
  if (clicks >= REQUIRED_CLICKS) {
    clicks = 0
    localStorage.setItem('jr-poster-unlocked', '1')
    return true
  }
  timer = setTimeout(() => { clicks = 0 }, WINDOW_MS)
  return false
}

export function isPosterUnlocked(): boolean {
  return localStorage.getItem('jr-poster-unlocked') === '1'
}
